const { Op } = require('sequelize');
const { sequelize, DailyReport, Cinema, Hall, Schedule, Order, OrderItem, Concession, Member, User, Movie } = require('../models');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

class ReportService {
  async _countPaidTickets(scheduleIds) {
    if (!scheduleIds || scheduleIds.length === 0) return 0;
    const result = await OrderItem.findOne({
      where: {
        orderId: {
          [Op.in]: sequelize.literal(
            `(SELECT id FROM Orders WHERE scheduleId IN (${scheduleIds.map(() => '?').join(',')}) AND status = 'paid')`
          )
        },
        itemType: 'ticket'
      },
      attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('quantity')), 0), 'ticketCount']],
      replacements: scheduleIds,
      raw: true
    });
    return parseInt(result.ticketCount, 10) || 0;
  }

  async _countTicketsForSchedule(scheduleId) {
    const result = await OrderItem.findOne({
      where: {
        orderId: {
          [Op.in]: sequelize.literal(
            `(SELECT id FROM Orders WHERE scheduleId = ? AND status = 'paid')`
          )
        },
        itemType: 'ticket'
      },
      attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('quantity')), 0), 'ticketCount']],
      replacements: [scheduleId],
      raw: true
    });
    return parseInt(result.ticketCount, 10) || 0;
  }

  async generateDailyReport(cinemaId, reportDate, createdBy) {
    if (!reportDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      reportDate = yesterday.toISOString().split('T')[0];
    }

    const startOfDay = new Date(reportDate + 'T00:00:00');
    const endOfDay = new Date(reportDate + 'T23:59:59.999');

    const schedules = await Schedule.findAll({
      where: { cinemaId, startTime: { [Op.between]: [startOfDay, endOfDay] } },
      include: [{ model: Hall }]
    });

    const scheduleIds = schedules.map(s => s.id);

    let hallAttendance = 0;
    if (schedules.length > 0) {
      let totalRate = 0;
      for (const schedule of schedules) {
        const ticketsSold = await this._countTicketsForSchedule(schedule.id);
        const capacity = schedule.Hall ? schedule.Hall.capacity : 0;
        totalRate += capacity > 0 ? ticketsSold / capacity : 0;
      }
      hallAttendance = totalRate / schedules.length;
    }

    const totalTickets = await this._countPaidTickets(scheduleIds);

    let totalRevenue = 0;
    let concessionSales = 0;
    let concessionQuantity = 0;

    if (scheduleIds.length > 0) {
      const revResult = await Order.findOne({
        where: { scheduleId: { [Op.in]: scheduleIds }, status: 'paid' },
        attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('payAmount')), 0), 'totalRevenue']],
        raw: true
      });
      totalRevenue = parseFloat(revResult.totalRevenue) || 0;

      const paidOrders = await Order.findAll({
        where: { scheduleId: { [Op.in]: scheduleIds }, status: 'paid' },
        attributes: ['id'],
        raw: true
      });
      const orderIds = paidOrders.map(o => o.id);

      if (orderIds.length > 0) {
        const conResult = await OrderItem.findOne({
          where: { orderId: { [Op.in]: orderIds }, itemType: 'concession' },
          attributes: [
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('totalPrice')), 0), 'totalSales'],
            [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('quantity')), 0), 'totalQty']
          ],
          raw: true
        });
        concessionSales = parseFloat(conResult.totalSales) || 0;
        concessionQuantity = parseInt(conResult.totalQty, 10) || 0;
      }
    }

    const allScheduleIds = (await Schedule.findAll({
      where: { cinemaId },
      attributes: ['id'],
      raw: true
    })).map(s => s.id);

    let newMembers = 0;
    let totalMembers = 0;

    if (allScheduleIds.length > 0) {
      const userIds = (await Order.findAll({
        where: { scheduleId: { [Op.in]: allScheduleIds } },
        attributes: ['userId'],
        group: ['userId'],
        raw: true
      })).map(o => o.userId);

      if (userIds.length > 0) {
        newMembers = await Member.count({
          where: {
            userId: { [Op.in]: userIds },
            createdAt: { [Op.between]: [startOfDay, endOfDay] }
          }
        });
        totalMembers = await Member.count({
          where: {
            userId: { [Op.in]: userIds },
            createdAt: { [Op.lte]: endOfDay }
          }
        });
      }
    }

    const reportData = {
      cinemaId,
      reportDate,
      hallAttendance,
      totalTickets,
      totalRevenue,
      concessionSales,
      concessionQuantity,
      newMembers,
      totalMembers,
      createdBy
    };

    const existing = await DailyReport.findOne({ where: { cinemaId, reportDate } });
    if (existing) {
      await existing.update(reportData);
      return existing;
    }
    return DailyReport.create(reportData);
  }

  async generateAllCinemasDailyReport(reportDate) {
    const cinemas = await Cinema.findAll();
    const reports = [];
    for (const cinema of cinemas) {
      const report = await this.generateDailyReport(cinema.id, reportDate, null);
      reports.push(report);
    }
    return reports;
  }

  async getReports(query) {
    const { cinemaId, startDate, endDate } = query;
    const where = {};
    if (cinemaId) where.cinemaId = cinemaId;
    if (startDate || endDate) {
      where.reportDate = {};
      if (startDate) where.reportDate[Op.gte] = startDate;
      if (endDate) where.reportDate[Op.lte] = endDate;
    }
    return DailyReport.findAll({
      where,
      order: [['reportDate', 'DESC']],
      include: [{ model: Cinema }]
    });
  }

  async exportToExcel(query) {
    const reports = await this.getReports(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('运营报表');

    sheet.columns = [
      { header: '日期', key: 'reportDate', width: 12 },
      { header: '影院', key: 'cinemaName', width: 15 },
      { header: '上座率', key: 'hallAttendance', width: 12 },
      { header: '总票数(张)', key: 'totalTickets', width: 12 },
      { header: '总收入(元)', key: 'totalRevenue', width: 14 },
      { header: '卖品销售额(元)', key: 'concessionSales', width: 14 },
      { header: '卖品销量(件)', key: 'concessionQuantity', width: 12 },
      { header: '新增会员(人)', key: 'newMembers', width: 12 },
      { header: '累计会员(人)', key: 'totalMembers', width: 12 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    for (const report of reports) {
      sheet.addRow({
        reportDate: report.reportDate,
        cinemaName: report.Cinema ? report.Cinema.name : '',
        hallAttendance: report.hallAttendance ? (parseFloat(report.hallAttendance) * 100).toFixed(2) + '%' : '0.00%',
        totalTickets: report.totalTickets || 0,
        totalRevenue: report.totalRevenue ? parseFloat(report.totalRevenue).toFixed(2) : '0.00',
        concessionSales: report.concessionSales ? parseFloat(report.concessionSales).toFixed(2) : '0.00',
        concessionQuantity: report.concessionQuantity || 0,
        newMembers: report.newMembers || 0,
        totalMembers: report.totalMembers || 0
      });
    }

    sheet.columns.forEach((column) => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 0;
        if (len > maxLen) maxLen = len;
      });
      column.width = Math.max(maxLen + 2, 10);
    });

    const exportsDir = path.resolve(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const filePath = path.join(exportsDir, `report_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
  }

  async getHallAttendanceDetail(cinemaId, date) {
    const halls = await Hall.findAll({ where: { cinemaId } });
    const result = [];

    for (const hall of halls) {
      const startOfDay = new Date(date + 'T00:00:00');
      const endOfDay = new Date(date + 'T23:59:59.999');

      const schedules = await Schedule.findAll({
        where: { hallId: hall.id, startTime: { [Op.between]: [startOfDay, endOfDay] } },
        include: [{ model: Movie }]
      });

      const scheduleDetails = [];
      for (const schedule of schedules) {
        const ticketsSold = await this._countTicketsForSchedule(schedule.id);
        const capacity = hall.capacity;
        scheduleDetails.push({
          schedule,
          movieTitle: schedule.Movie ? schedule.Movie.title : '',
          ticketsSold,
          capacity,
          attendanceRate: capacity > 0 ? ticketsSold / capacity : 0
        });
      }

      result.push({ hall, schedules: scheduleDetails });
    }

    return result;
  }

  async getDashboardSummary(cinemaId) {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const todayStart = new Date(todayStr + 'T00:00:00');
    const todayEnd = new Date(todayStr + 'T23:59:59.999');

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const todaySchedules = await Schedule.findAll({
      where: { cinemaId, startTime: { [Op.between]: [todayStart, todayEnd] } },
      include: [{ model: Hall }]
    });

    const todayScheduleIds = todaySchedules.map(s => s.id);

    let todayTotalRevenue = 0;
    let todayTotalTickets = 0;
    let todayAttendance = 0;

    if (todayScheduleIds.length > 0) {
      todayTotalTickets = await this._countPaidTickets(todayScheduleIds);

      const revResult = await Order.findOne({
        where: { scheduleId: { [Op.in]: todayScheduleIds }, status: 'paid' },
        attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('payAmount')), 0), 'totalRevenue']],
        raw: true
      });
      todayTotalRevenue = parseFloat(revResult.totalRevenue) || 0;

      if (todaySchedules.length > 0) {
        let totalRate = 0;
        for (const schedule of todaySchedules) {
          const ticketsSold = await this._countTicketsForSchedule(schedule.id);
          const capacity = schedule.Hall ? schedule.Hall.capacity : 0;
          totalRate += capacity > 0 ? ticketsSold / capacity : 0;
        }
        todayAttendance = totalRate / todaySchedules.length;
      }
    }

    const monthSchedules = await Schedule.findAll({
      where: { cinemaId, startTime: { [Op.between]: [monthStart, monthEnd] } },
      attributes: ['id'],
      raw: true
    });
    const monthScheduleIds = monthSchedules.map(s => s.id);

    let monthTotalRevenue = 0;
    let monthTotalTickets = 0;

    if (monthScheduleIds.length > 0) {
      monthTotalTickets = await this._countPaidTickets(monthScheduleIds);

      const monthRevResult = await Order.findOne({
        where: { scheduleId: { [Op.in]: monthScheduleIds }, status: 'paid' },
        attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('payAmount')), 0), 'totalRevenue']],
        raw: true
      });
      monthTotalRevenue = parseFloat(monthRevResult.totalRevenue) || 0;
    }

    const lowStockCount = await Concession.count({
      where: {
        cinemaId,
        stock: { [Op.lte]: sequelize.col('safetyStock') }
      }
    });

    const allScheduleIds = (await Schedule.findAll({
      where: { cinemaId },
      attributes: ['id'],
      raw: true
    })).map(s => s.id);

    let newMembersThisMonth = 0;
    if (allScheduleIds.length > 0) {
      const userIds = (await Order.findAll({
        where: { scheduleId: { [Op.in]: allScheduleIds } },
        attributes: ['userId'],
        group: ['userId'],
        raw: true
      })).map(o => o.userId);

      if (userIds.length > 0) {
        newMembersThisMonth = await Member.count({
          where: {
            userId: { [Op.in]: userIds },
            createdAt: { [Op.between]: [monthStart, monthEnd] }
          }
        });
      }
    }

    return {
      today: { totalRevenue: todayTotalRevenue, totalTickets: todayTotalTickets, attendance: todayAttendance },
      month: { totalRevenue: monthTotalRevenue, totalTickets: monthTotalTickets },
      lowStockCount,
      newMembersThisMonth
    };
  }
}

module.exports = new ReportService();
