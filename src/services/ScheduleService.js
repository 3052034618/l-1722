const { Op } = require('sequelize');
const { Schedule, Movie, Hall, Cinema, Seat, SeatLock, Order } = require('../models');
const NotificationService = require('./NotificationService');

class ScheduleService {
  async recommendOptimalSlots(movieId, hallId, date) {
    const movie = await Movie.findByPk(movieId);
    const hall = await Hall.findByPk(hallId);
    if (!movie || !hall) throw new Error('Movie or Hall not found');

    const durationWithBuffer = movie.duration + 15;
    const historicalAttendanceRate = await this._getHistoricalAttendanceRate(hallId, hall.capacity);
    const existingSchedules = await this._getSchedulesForHallOnDate(hallId, date);
    const hallUtilization = this._calculateHallUtilization(existingSchedules, date, durationWithBuffer);

    const candidates = [];
    const dateObj = new Date(date);
    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    for (let hour = 9; hour <= 22; hour++) {
      const startTime = new Date(dayStart);
      startTime.setHours(hour, 0, 0, 0);
      const endTime = new Date(startTime.getTime() + durationWithBuffer * 60000);

      if (endTime > dayEnd) continue;

      const conflict = existingSchedules.some(s => {
        const sStart = new Date(s.startTime);
        const sEnd = new Date(s.endTime);
        return startTime < sEnd && endTime > sStart;
      });

      const timePopularity = this._getTimePopularity(hour);
      const score = historicalAttendanceRate * 0.4 + timePopularity * 0.3 + hallUtilization * 0.3;

      candidates.push({ startTime, endTime, score, conflict });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  async _getHistoricalAttendanceRate(hallId, capacity) {
    if (!capacity) return 0.5;

    const schedules = await Schedule.findAll({
      where: { hallId, status: { [Op.in]: ['completed', 'showing'] } },
      attributes: ['id']
    });

    if (schedules.length === 0) return 0.5;

    const scheduleIds = schedules.map(s => s.id);
    const { OrderItem, Order } = require('../models');
    const { sequelize } = require('../models');

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

    const paidTicketsCount = parseInt(result.ticketCount, 10) || 0;
    const totalCapacity = schedules.length * capacity;
    return Math.min(paidTicketsCount / totalCapacity, 1);
  }

  async _getSchedulesForHallOnDate(hallId, date) {
    const dateObj = new Date(date);
    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    return Schedule.findAll({
      where: {
        hallId,
        status: { [Op.ne]: 'cancelled' },
        startTime: { [Op.gte]: dayStart, [Op.lt]: dayEnd }
      }
    });
  }

  _getTimePopularity(hour) {
    if (hour >= 18 && hour <= 21) return 1.0;
    if (hour >= 14 && hour <= 17) return 0.7;
    return 0.4;
  }

  _calculateHallUtilization(existingSchedules, date, newSlotDuration) {
    const dateObj = new Date(date);
    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    dayStart.setHours(9, 0, 0, 0);
    const dayEnd = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    dayEnd.setHours(23, 0, 0, 0);

    const totalAvailableMinutes = (dayEnd - dayStart) / 60000;

    let usedMinutes = 0;
    for (const s of existingSchedules) {
      const sStart = new Date(s.startTime);
      const sEnd = new Date(s.endTime);
      usedMinutes += (sEnd - sStart) / 60000;
    }

    usedMinutes += newSlotDuration;
    return Math.min(usedMinutes / totalAvailableMinutes, 1);
  }

  async checkConflict(hallId, startTime, endTime, excludeScheduleId = null) {
    const where = {
      hallId,
      status: { [Op.ne]: 'cancelled' },
      startTime: { [Op.lt]: new Date(endTime) },
      endTime: { [Op.gt]: new Date(startTime) }
    };

    if (excludeScheduleId) {
      where.id = { [Op.ne]: excludeScheduleId };
    }

    const conflictingSchedule = await Schedule.findOne({
      where,
      include: [Movie, Hall]
    });

    if (conflictingSchedule) {
      return { conflict: true, conflictingSchedule };
    }
    return { conflict: false, conflictingSchedule: null };
  }

  async recommendAlternativeSlots(movieId, hallId, date, conflictingStartTime) {
    const candidates = await this.recommendOptimalSlots(movieId, hallId, date);
    const conflictTime = new Date(conflictingStartTime).getTime();
    return candidates.filter(c => c.startTime.getTime() !== conflictTime && !c.conflict);
  }

  async createSchedule(data) {
    const { movieId, hallId, cinemaId, startTime, price } = data;
    const movie = await Movie.findByPk(movieId);
    const hall = await Hall.findByPk(hallId);
    if (!movie) throw new Error('Movie not found');
    if (!hall) throw new Error('Hall not found');

    const endTime = new Date(new Date(startTime).getTime() + (movie.duration + 15) * 60000);

    const conflictCheck = await this.checkConflict(hallId, startTime, endTime);
    if (conflictCheck.conflict) {
      const { Movie, Hall } = require('../models');
      const cs = conflictCheck.conflictingSchedule;
      const csMovie = cs.Movie || (cs.MovieId ? await Movie.findByPk(cs.MovieId) : null);
      const csHall = cs.Hall || (cs.HallId ? await Hall.findByPk(cs.HallId) : null);
      throw new Error(`场次冲突：${csMovie ? csMovie.title : '未知影片'} ${csHall ? '在' + csHall.name : ''} ${cs.startTime}`);
    }

    const schedule = await Schedule.create({
      movieId,
      hallId,
      cinemaId,
      startTime,
      endTime,
      price,
      status: 'scheduled',
      locked: false
    });

    const loadedSchedule = await Schedule.findByPk(schedule.id, { include: [Movie, Hall] });

    await NotificationService.notifyAllStaff({
      type: 'schedule_created',
      title: '新场次创建',
      content: `新场次已创建：${movie.title} ${loadedSchedule.Hall ? loadedSchedule.Hall.name : ''} ${new Date(startTime).toLocaleString('zh-CN')}`
    });

    return loadedSchedule;
  }

  async lockSchedule(scheduleId, lockedBy) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    await schedule.update({ locked: true, lockedBy });

    const loaded = await Schedule.findByPk(scheduleId, { include: [Movie] });
    await NotificationService.notifyAllStaff({
      type: 'schedule_locked',
      title: '场次已锁定',
      content: `场次${loaded.Movie ? '"' + loaded.Movie.title + '"' : ''}(${scheduleId})已被锁定，禁止修改`
    });

    return schedule;
  }

  async unlockSchedule(scheduleId) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    await schedule.update({ locked: false, lockedBy: null });

    const loaded = await Schedule.findByPk(scheduleId, { include: [Movie] });
    await NotificationService.notifyAllStaff({
      type: 'schedule_unlocked',
      title: '场次已解锁',
      content: `场次${loaded.Movie ? '"' + loaded.Movie.title + '"' : ''}(${scheduleId})已解锁，可以进行修改`
    });

    return schedule;
  }

  async updateSchedule(scheduleId, data) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.locked) throw new Error('Schedule is locked and cannot be modified');

    if (data.startTime || data.movieId) {
      const movieId = data.movieId || schedule.movieId;
      const movie = await Movie.findByPk(movieId);
      if (!movie) throw new Error('Movie not found');

      const startTime = data.startTime || schedule.startTime;
      const endTime = new Date(new Date(startTime).getTime() + (movie.duration + 15) * 60000);
      data.endTime = endTime;

      const hallId = data.hallId || schedule.hallId;
      const conflictCheck = await this.checkConflict(hallId, startTime, endTime, scheduleId);
      if (conflictCheck.conflict) {
        throw new Error('Updated schedule conflicts with existing schedule');
      }
    }

    const oldStartTime = schedule.startTime;
    const oldMovieId = schedule.movieId;
    await schedule.update(data);

    const loaded = await Schedule.findByPk(scheduleId, { include: [Movie, Hall] });
    const hasTimeChange = data.startTime && new Date(data.startTime).getTime() !== new Date(oldStartTime).getTime();
    const hasMovieChange = data.movieId && data.movieId !== oldMovieId;

    const changeDesc = [];
    if (hasMovieChange) changeDesc.push('影片');
    if (hasTimeChange) changeDesc.push('时间');
    if (data.hallId) changeDesc.push('影厅');

    await NotificationService.notifyAllStaff({
      type: 'schedule_updated',
      title: '场次信息变更',
      content: `场次${loaded.Movie ? '"' + loaded.Movie.title + '"' : ''}${changeDesc.length ? changeDesc.join('/') + '已' : ''}变更，${loaded.Hall ? loaded.Hall.name : ''} ${new Date(loaded.startTime).toLocaleString('zh-CN')}`
    });

    const affectedOrders = await Order.findAll({
      where: { scheduleId, status: { [Op.in]: ['pending', 'paid'] } }
    });
    if (affectedOrders.length > 0) {
      const userIds = [...new Set(affectedOrders.map(o => o.userId))];
      await NotificationService.notifyUsers(userIds, {
        type: 'schedule_updated',
        title: '场次信息变更通知',
        content: `您已购票的场次${loaded.Movie ? '"' + loaded.Movie.title + '"' : ''}已变更，请查看最新排期。${loaded.Hall ? loaded.Hall.name : ''} ${new Date(loaded.startTime).toLocaleString('zh-CN')}`
      });
    }

    return loaded;
  }

  async cancelSchedule(scheduleId) {
    const schedule = await Schedule.findByPk(scheduleId, { include: [Movie, Hall] });
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.locked) throw new Error('Schedule is locked and cannot be cancelled');

    await schedule.update({ status: 'cancelled' });

    await NotificationService.notifyAllStaff({
      type: 'schedule_cancelled',
      title: '场次已取消',
      content: `场次已取消：${schedule.Movie ? schedule.Movie.title : ''} ${schedule.Hall ? schedule.Hall.name : ''} ${new Date(schedule.startTime).toLocaleString('zh-CN')}`
    });

    const orders = await Order.findAll({
      where: { scheduleId, status: { [Op.in]: ['pending', 'paid'] } }
    });

    if (orders.length > 0) {
      const userIds = [...new Set(orders.map(o => o.userId))];
      await NotificationService.notifyUsers(userIds, {
        type: 'schedule_cancelled',
        title: '场次取消通知',
        content: `您已购票的场次"${schedule.Movie ? schedule.Movie.title : ''}"已取消，请联系影院办理退款。给您带来不便敬请谅解。`
      });
    }

    return schedule;
  }

  async getSchedules(query) {
    const { cinemaId, hallId, movieId, date, status } = query;
    const where = {};

    if (cinemaId) where.cinemaId = cinemaId;
    if (hallId) where.hallId = hallId;
    if (movieId) where.movieId = movieId;
    if (status) where.status = status;
    if (date) {
      const dateObj = new Date(date);
      const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      where.startTime = { [Op.gte]: dayStart, [Op.lt]: dayEnd };
    }

    return Schedule.findAll({
      where,
      include: [Movie, Hall],
      order: [['startTime', 'ASC']]
    });
  }
}

module.exports = new ScheduleService();
