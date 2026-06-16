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
    const paidOrdersCount = await Order.count({
      where: { scheduleId: { [Op.in]: scheduleIds }, status: 'paid' }
    });

    const totalCapacity = schedules.length * capacity;
    return Math.min(paidOrdersCount / totalCapacity, 1);
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

    const conflictingSchedule = await Schedule.findOne({ where });

    if (conflictingSchedule) {
      return { conflict: true, conflictingSchedule };
    }
    return { conflict: false, conflictingSchedule: null };
  }

  async recommendAlternativeSlots(movieId, hallId, date, conflictingStartTime) {
    const candidates = await this.recommendOptimalSlots(movieId, hallId, date);
    const conflictTime = new Date(conflictingStartTime).getTime();
    return candidates.filter(c => c.startTime.getTime() !== conflictTime);
  }

  async createSchedule(data) {
    const { movieId, hallId, cinemaId, startTime, price } = data;
    const movie = await Movie.findByPk(movieId);
    if (!movie) throw new Error('Movie not found');

    const endTime = new Date(new Date(startTime).getTime() + (movie.duration + 15) * 60000);

    const conflictCheck = await this.checkConflict(hallId, startTime, endTime);
    if (conflictCheck.conflict) {
      throw new Error('Schedule conflicts with existing schedule');
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

    await NotificationService.notifyAdmins({
      type: 'schedule_created',
      title: 'New Schedule Created',
      content: `New schedule created for movie "${movie.title}"`
    });

    return schedule;
  }

  async lockSchedule(scheduleId, lockedBy) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    await schedule.update({ locked: true, lockedBy });
    return schedule;
  }

  async unlockSchedule(scheduleId) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    await schedule.update({ locked: false, lockedBy: null });
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

      const conflictCheck = await this.checkConflict(schedule.hallId, startTime, endTime, scheduleId);
      if (conflictCheck.conflict) {
        throw new Error('Updated schedule conflicts with existing schedule');
      }
    }

    await schedule.update(data);

    await NotificationService.notifyAdmins({
      type: 'schedule_updated',
      title: 'Schedule Updated',
      content: `Schedule ${scheduleId} has been updated`
    });

    return schedule;
  }

  async cancelSchedule(scheduleId) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.locked) throw new Error('Schedule is locked and cannot be cancelled');

    await schedule.update({ status: 'cancelled' });

    await NotificationService.notifyAdmins({
      type: 'schedule_cancelled',
      title: 'Schedule Cancelled',
      content: `Schedule ${scheduleId} has been cancelled`
    });

    const orders = await Order.findAll({
      where: { scheduleId, status: { [Op.in]: ['pending', 'paid'] } }
    });

    if (orders.length > 0) {
      const userIds = [...new Set(orders.map(o => o.userId))];
      await NotificationService.notifyUsers(userIds, {
        type: 'schedule_cancelled',
        title: 'Schedule Cancelled',
        content: 'A movie you booked has been cancelled. Please contact us for a refund.'
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
      include: [Movie, Hall]
    });
  }
}

module.exports = new ScheduleService();
