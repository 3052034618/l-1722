const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { Seat, SeatLock, Schedule, Order, OrderItem, User } = require('../models');
const config = require('../config/index');
const NotificationService = require('./NotificationService');

class SeatLockService {
  async _getSoldSeatIds(scheduleId) {
    const paidLocks = await SeatLock.findAll({
      where: { scheduleId, status: 'paid' },
      attributes: ['seatId'],
      raw: true
    });
    return new Set(paidLocks.map(l => l.seatId));
  }

  async _getLockedSeatIds(scheduleId) {
    const now = new Date();
    const activeLocks = await SeatLock.findAll({
      where: {
        scheduleId,
        status: 'locked',
        expireAt: { [Op.gt]: now }
      },
      attributes: ['seatId'],
      raw: true
    });
    return new Set(activeLocks.map(l => l.seatId));
  }

  async lockSeats(scheduleId, seatIds, userId) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');
    if (schedule.status === 'cancelled') throw new Error('Schedule is cancelled');

    const seats = await Seat.findAll({
      where: { id: { [Op.in]: seatIds }, hallId: schedule.hallId }
    });
    if (seats.length !== seatIds.length) throw new Error('Some seats do not exist or do not belong to this hall');

    const maintenanceSeats = seats.filter(s => s.status === 'maintenance');
    if (maintenanceSeats.length > 0) throw new Error('Some seats are under maintenance');

    const soldSeatIds = await this._getSoldSeatIds(scheduleId);
    const soldRequested = seatIds.filter(id => soldSeatIds.has(id));
    if (soldRequested.length > 0) throw new Error('Some seats are already sold for this schedule');

    const lockedSeatIds = await this._getLockedSeatIds(scheduleId);
    const lockedRequested = seatIds.filter(id => lockedSeatIds.has(id));
    if (lockedRequested.length > 0) throw new Error('Some seats are already locked for this schedule');

    const now = new Date();
    const expireAt = new Date(now.getTime() + config.seat.lockDurationMinutes * 60 * 1000);
    const lockToken = uuidv4();

    const lockRecords = [];
    for (const seatId of seatIds) {
      const lock = await SeatLock.create({
        scheduleId,
        seatId,
        userId,
        lockToken,
        lockedAt: now,
        expireAt,
        status: 'locked'
      });
      lockRecords.push(lock);
    }

    return { lockToken, locks: lockRecords };
  }

  async releaseExpiredLocks() {
    const now = new Date();

    const expiredLocks = await SeatLock.findAll({
      where: {
        status: 'locked',
        expireAt: { [Op.lt]: now }
      }
    });

    for (const lock of expiredLocks) {
      await lock.update({ status: 'released' });

      await NotificationService.notifyUsers([lock.userId], {
        type: 'seat_lock_expired',
        title: '座位锁定超时',
        content: `您的座位锁定已超时，所选座位已释放（凭证：${lock.lockToken}）`
      });
    }

    return expiredLocks.length;
  }

  async releaseLock(seatLockId, userId) {
    const lock = await SeatLock.findByPk(seatLockId);
    if (!lock) throw new Error('Seat lock not found');
    if (lock.userId !== userId) throw new Error('You can only release your own locks');

    await lock.update({ status: 'released' });

    return lock;
  }

  async releaseSeatsForOrder(scheduleId, seatIds) {
    const locks = await SeatLock.findAll({
      where: {
        scheduleId,
        seatId: { [Op.in]: seatIds },
        status: 'paid'
      }
    });

    for (const lock of locks) {
      await lock.update({ status: 'released' });
    }

    return locks;
  }

  async getUserActiveLocks(scheduleId, userId) {
    const now = new Date();
    return SeatLock.findAll({
      where: {
        scheduleId,
        userId,
        status: 'locked',
        expireAt: { [Op.gt]: now }
      }
    });
  }

  async confirmLocks(scheduleId, seatIds, userId) {
    const now = new Date();
    const locks = await SeatLock.findAll({
      where: {
        scheduleId,
        seatId: { [Op.in]: seatIds },
        userId,
        status: 'locked',
        expireAt: { [Op.gt]: now }
      }
    });

    for (const lock of locks) {
      await lock.update({ status: 'paid' });
    }

    return locks;
  }

  async confirmLocksByToken(scheduleId, lockToken, userId) {
    const now = new Date();
    const locks = await SeatLock.findAll({
      where: {
        scheduleId,
        lockToken,
        userId,
        status: 'locked',
        expireAt: { [Op.gt]: now }
      }
    });

    for (const lock of locks) {
      await lock.update({ status: 'paid' });
    }

    return locks;
  }

  async getLocksByToken(lockToken) {
    return SeatLock.findAll({
      where: { lockToken }
    });
  }

  async getLockedSeats(scheduleId) {
    const now = new Date();

    return SeatLock.findAll({
      where: {
        scheduleId,
        status: 'locked',
        expireAt: { [Op.gt]: now }
      },
      include: [Seat]
    });
  }

  async getAvailableSeats(scheduleId) {
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) throw new Error('Schedule not found');

    const seats = await Seat.findAll({
      where: { hallId: schedule.hallId }
    });

    const soldSeatIds = await this._getSoldSeatIds(scheduleId);
    const lockedSeatIds = await this._getLockedSeatIds(scheduleId);

    const layout = seats.map(seat => {
      let currentStatus = seat.status;
      if (currentStatus === 'available') {
        if (soldSeatIds.has(seat.id)) {
          currentStatus = 'sold';
        } else if (lockedSeatIds.has(seat.id)) {
          currentStatus = 'locked';
        }
      }
      return {
        id: seat.id,
        row: seat.row,
        col: seat.col,
        seatNo: seat.seatNo,
        status: currentStatus
      };
    });

    return layout;
  }
}

module.exports = new SeatLockService();
