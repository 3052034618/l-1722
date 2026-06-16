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

  async _countBoxRevenue(scheduleIds) {
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
      attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('totalPrice')), 0), 'boxRevenue']],
      replacements: scheduleIds,
      raw: true
    });
    return parseFloat(result.boxRevenue) || 0;
  }

  async _countConcessionRevenue(orderIds) {
    if (!orderIds || orderIds.length === 0) return { totalSales: 0, totalQty: 0 };
    const result = await OrderItem.findOne({
      where: { orderId: { [Op.in]: orderIds }, itemType: 'concession' },
      attributes: [
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('totalPrice')), 0), 'totalSales'],
        [sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.col('quantity')), 0), 'totalQty']
      ],
      raw: true
    });
    return {
      totalSales: parseFloat(result.totalSales) || 0,
      totalQty: parseInt(result.totalQty, 10) || 0
    };
  }

  async _countConcessionRevenueForSchedule(scheduleId) {
    const paidOrders = await Order.findAll({
      where: { scheduleId, status: 'paid' },
      attributes: ['id'],
      raw: true
    });
    const orderIds = paidOrders.map(o => o.id);
    if (orderIds.length === 0) return 0;
    const result = await this._countConcessionRevenue(orderIds);
    return result.totalSales;
  }

  async _buildScheduleWhere(query) {
    const { cinemaId, movieId, hallId, startDate, endDate, startTime, endTime } = query;
    const where = {};

    if (cinemaId) where.cinemaId = cinemaId;
    if (movieId) where.movieId = movieId;
    if (hallId) where.hallId = hallId;

    if (startDate || endDate) {
      where.startTime = where.startTime || {};
      if (startDate) {
        const s = new Date(startDate + 'T00:00:00');
        where.startTime[Op.gte] = s;
      }
      if (endDate) {
        const e = new Date(endDate + 'T23:59:59.999');
        where.startTime[Op.lte] = e;
      }
    }

    if (startTime && endTime) {
      const startHour = parseInt(startTime.split(':')[0], 10);
      const startMin = parseInt(startTime.split(':')[1] || '0', 10);
      const endHour = parseInt(endTime.split(':')[0], 10);
      const endMin = parseInt(endTime.split(':')[1] || '0', 10);

      where[Op.and] = [
        sequelize.where(
          sequelize.literal(`(CAST(strftime('%H', startTime) AS INTEGER) * 60 + CAST(strftime('%M', startTime) AS INTEGER))`),
          { [Op.gte]: startHour * 60 + startMin }
        ),
        sequelize.where(
          sequelize.literal(`(CAST(strftime('%H', startTime) AS INTEGER) * 60 + CAST(strftime('%M', startTime) AS INTEGER))`),
          { [Op.lte]: endHour * 60 + endMin }
        )
      ];
    }

    return where;
  }

  async getFilteredSchedules(query) {
    const where = await this._buildScheduleWhere(query);
    return Schedule.findAll({
      where,
      include: [Movie, Hall, Cinema],
      order: [['startTime', 'ASC']]
    });
  }

  async getSummary(query) {
    const schedules = await this.getFilteredSchedules(query);
    const scheduleIds = schedules.map(s => s.id);

    if (scheduleIds.length === 0) {
      return {
        totalSchedules: 0,
        totalTickets: 0,
        totalRevenue: 0,
        boxRevenue: 0,
        totalConcessionSales: 0,
        totalConcessionQuantity: 0,
        avgAttendance: 0
      };
    }

    const totalTickets = await this._countPaidTickets(scheduleIds);
    const boxRevenue = await this._countBoxRevenue(scheduleIds);

    const paidOrders = await Order.findAll({
      where: { scheduleId: { [Op.in]: scheduleIds }, status: 'paid' },
      attributes: ['id'],
      raw: true
    });
    const orderIds = paidOrders.map(o => o.id);

    let totalConcessionSales = 0;
    let totalConcessionQuantity = 0;

    if (orderIds.length > 0) {
      const conResult = await this._countConcessionRevenue(orderIds);
      totalConcessionSales = conResult.totalSales;
      totalConcessionQuantity = conResult.totalQty;
    }

    const totalRevenue = boxRevenue + totalConcessionSales;

    let totalRate = 0;
    let rateCount = 0;
    for (const schedule of schedules) {
      const ticketsSold = await this._countTicketsForSchedule(schedule.id);
      const capacity = schedule.Hall ? schedule.Hall.capacity : 0;
      if (capacity > 0) {
        totalRate += ticketsSold / capacity;
        rateCount++;
      }
    }
    const avgAttendance = rateCount > 0 ? totalRate / rateCount : 0;

    return {
      totalSchedules: schedules.length,
      totalTickets,
      totalRevenue,
      boxRevenue,
      totalConcessionSales,
      totalConcessionQuantity,
      avgAttendance
    };
  }

  async getScheduleDetail(query) {
    const schedules = await this.getFilteredSchedules(query);
    const details = [];

    for (const schedule of schedules) {
      const ticketsSold = await this._countTicketsForSchedule(schedule.id);
      const capacity = schedule.Hall ? schedule.Hall.capacity : 0;
      const attendanceRate = capacity > 0 ? ticketsSold / capacity : 0;

      const boxRevenue = await this._countBoxRevenue([schedule.id]);
      const concessionRevenue = await this._countConcessionRevenueForSchedule(schedule.id);

      details.push({
        scheduleId: schedule.id,
        movieTitle: schedule.Movie ? schedule.Movie.title : '',
        hallName: schedule.Hall ? schedule.Hall.name : '',
        cinemaName: schedule.Cinema ? schedule.Cinema.name : '',
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        capacity,
        ticketsSold,
        attendanceRate,
        boxRevenue,
        concessionRevenue
      });
    }

    return details;
  }

  async getHallSummary(query) {
    const schedules = await this.getFilteredSchedules(query);
    const hallMap = {};

    for (const schedule of schedules) {
      const hallId = schedule.hallId;
      if (!hallMap[hallId]) {
        hallMap[hallId] = {
          hallId,
          hallName: schedule.Hall ? schedule.Hall.name : '',
          hallType: schedule.Hall ? schedule.Hall.type : '',
          cinemaName: schedule.Cinema ? schedule.Cinema.name : '',
          capacity: schedule.Hall ? schedule.Hall.capacity : 0,
          scheduleCount: 0,
          totalTicketsSold: 0
        };
      }
      const ticketsSold = await this._countTicketsForSchedule(schedule.id);
      hallMap[hallId].scheduleCount++;
      hallMap[hallId].totalTicketsSold += ticketsSold;
    }

    return Object.values(hallMap).map(h => ({
      ...h,
      attendanceRate: h.capacity > 0 ? h.totalTicketsSold / (h.capacity * h.scheduleCount) : 0
    }));
  }

  async getMovieSummary(query) {
    const schedules = await this.getFilteredSchedules(query);
    const movieMap = {};

    for (const schedule of schedules) {
      const movieId = schedule.movieId;
      if (!movieMap[movieId]) {
        movieMap[movieId] = {
          movieId,
          movieTitle: schedule.Movie ? schedule.Movie.title : '',
          scheduleCount: 0,
          totalTicketsSold: 0,
          boxRevenue: 0,
          concessionRevenue: 0
        };
      }
      const ticketsSold = await this._countTicketsForSchedule(schedule.id);
      const scheduleBoxRevenue = await this._countBoxRevenue([schedule.id]);
      const scheduleConcessionRevenue = await this._countConcessionRevenueForSchedule(schedule.id);

      movieMap[movieId].scheduleCount++;
      movieMap[movieId].totalTicketsSold += ticketsSold;
      movieMap[movieId].boxRevenue += scheduleBoxRevenue;
      movieMap[movieId].concessionRevenue += scheduleConcessionRevenue;
    }

    return Object.values(movieMap).map(m => ({
      ...m,
      totalRevenue: m.boxRevenue
    }));
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
    const boxRevenue = await this._countBoxRevenue(scheduleIds);

    let concessionSales = 0;
    let concessionQuantity = 0;

    if (scheduleIds.length > 0) {
      const paidOrders = await Order.findAll({
        where: { scheduleId: { [Op.in]: scheduleIds }, status: 'paid' },
        attributes: ['id'],
        raw: true
      });
      const orderIds = paidOrders.map(o => o.id);

      if (orderIds.length > 0) {
        const conResult = await this._countConcessionRevenue(orderIds);
        concessionSales = conResult.totalSales;
        concessionQuantity = conResult.totalQty;
      }
    }

    const totalRevenue = boxRevenue + concessionSales;

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
      boxRevenue,
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
    const workbook = new ExcelJS.Workbook();

    const summary = await this.getSummary(query);
    const scheduleDetail = await this.getScheduleDetail(query);
    const hallSummary = await this.getHallSummary(query);
    const movieSummary = await this.getMovieSummary(query);

    const summarySheet = workbook.addWorksheet('汇总');
    summarySheet.columns = [
      { header: '指标', key: 'metric', width: 18 },
      { header: '数值', key: 'value', width: 16 }
    ];
    const summaryData = [
      { metric: '场次数', value: summary.totalSchedules },
      { metric: '总票数(张)', value: summary.totalTickets },
      { metric: '票房收入(元)', value: parseFloat(summary.boxRevenue.toFixed(2)) },
      { metric: '卖品销售额(元)', value: parseFloat(summary.totalConcessionSales.toFixed(2)) },
      { metric: '总收入(元)', value: parseFloat(summary.totalRevenue.toFixed(2)) },
      { metric: '卖品销量(件)', value: summary.totalConcessionQuantity },
      { metric: '平均上座率', value: (summary.avgAttendance * 100).toFixed(2) + '%' }
    ];
    for (const row of summaryData) {
      summarySheet.addRow(row);
    }

    const detailSheet = workbook.addWorksheet('场次明细');
    detailSheet.columns = [
      { header: '影院', key: 'cinemaName', width: 16 },
      { header: '影厅', key: 'hallName', width: 10 },
      { header: '影片', key: 'movieTitle', width: 16 },
      { header: '开始时间', key: 'startTime', width: 18 },
      { header: '结束时间', key: 'endTime', width: 18 },
      { header: '容量', key: 'capacity', width: 8 },
      { header: '售票数', key: 'ticketsSold', width: 8 },
      { header: '上座率', key: 'attendanceRate', width: 10 },
      { header: '票房收入(元)', key: 'boxRevenue', width: 12 },
      { header: '卖品收入(元)', key: 'concessionRevenue', width: 12 }
    ];
    for (const d of scheduleDetail) {
      detailSheet.addRow({
        ...d,
        startTime: new Date(d.startTime).toLocaleString('zh-CN'),
        endTime: new Date(d.endTime).toLocaleString('zh-CN'),
        attendanceRate: (d.attendanceRate * 100).toFixed(2) + '%',
        boxRevenue: parseFloat(d.boxRevenue.toFixed(2)),
        concessionRevenue: parseFloat(d.concessionRevenue.toFixed(2))
      });
    }

    const hallSheet = workbook.addWorksheet('影厅汇总');
    hallSheet.columns = [
      { header: '影院', key: 'cinemaName', width: 16 },
      { header: '影厅', key: 'hallName', width: 10 },
      { header: '类型', key: 'hallType', width: 8 },
      { header: '容量', key: 'capacity', width: 8 },
      { header: '场次数', key: 'scheduleCount', width: 8 },
      { header: '售票数', key: 'totalTicketsSold', width: 8 },
      { header: '上座率', key: 'attendanceRate', width: 10 }
    ];
    for (const h of hallSummary) {
      hallSheet.addRow({
        ...h,
        attendanceRate: (h.attendanceRate * 100).toFixed(2) + '%'
      });
    }

    const movieSheet = workbook.addWorksheet('影片汇总');
    movieSheet.columns = [
      { header: '影片', key: 'movieTitle', width: 18 },
      { header: '场次数', key: 'scheduleCount', width: 8 },
      { header: '售票数', key: 'totalTicketsSold', width: 8 },
      { header: '票房收入(元)', key: 'totalRevenue', width: 12 },
      { header: '卖品收入(元)', key: 'concessionRevenue', width: 12 }
    ];
    for (const m of movieSummary) {
      movieSheet.addRow({
        ...m,
        totalRevenue: parseFloat(m.totalRevenue.toFixed(2)),
        concessionRevenue: parseFloat(m.concessionRevenue.toFixed(2))
      });
    }

    for (const sheet of [summarySheet, detailSheet, hallSheet, movieSheet]) {
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
    }

    const exportsDir = path.resolve(__dirname, '../../exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const filePath = path.join(exportsDir, `report_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);

    return filePath;
  }

  async getHallAttendanceDetail(cinemaId, date) {
    return this.getHallSummary({ cinemaId, startDate: date, endDate: date });
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
      todayTotalRevenue = await this._countBoxRevenue(todayScheduleIds);

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
      monthTotalRevenue = await this._countBoxRevenue(monthScheduleIds);
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
