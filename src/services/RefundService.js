const { RefundRecord, Order, OrderItem, Schedule, Member, SeatLock, User, Op, Movie, Cinema } = require('../models');
const SeatLockService = require('./SeatLockService');
const MemberService = require('./MemberService');
const InventoryService = require('./InventoryService');
const NotificationService = require('./NotificationService');

class RefundService {
  async applyRefund(orderId, userId, reason) {
    const order = await Order.findByPk(orderId, { include: [OrderItem] });
    if (!order) throw new Error('订单不存在');
    if (order.status !== 'paid') throw new Error('只有已支付的订单才能申请退票');
    if (order.userId !== userId) throw new Error('只能退自己的订单');

    const schedule = await Schedule.findByPk(order.scheduleId);
    if (!schedule) throw new Error('场次不存在');
    if (new Date(schedule.startTime) <= new Date()) throw new Error('场次已开始，无法退票');

    const existingPending = await RefundRecord.findOne({
      where: { orderId, status: { [Op.in]: ['pending', 'supplement_pending'] } }
    });
    if (existingPending) throw new Error('该订单已有待处理的售后申请');

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);

    const record = await RefundRecord.create({
      orderId,
      userId,
      type: 'refund',
      status: 'pending',
      reason,
      originalScheduleId: order.scheduleId,
      originalSeatIds: seatIds.join(','),
      refundAmount: order.payAmount,
      supplementStatus: 'none'
    });

    await NotificationService.notifyUser(userId, {
      type: 'refund_apply',
      title: '退票申请已提交',
      content: `您的退票申请已提交，订单号：${orderId}，等待运营审批`
    });
    await NotificationService.notifyAdmins({
      type: 'refund_apply',
      title: '新退票申请',
      content: `会员申请退票，订单号：${orderId}，原因：${reason || '未填写'}`
    });
    await NotificationService.notifySellers({
      type: 'refund_apply',
      title: '新退票申请',
      content: `会员申请退票，订单号：${orderId}，原因：${reason || '未填写'}`
    });

    return record;
  }

  async applyReschedule(orderId, userId, reason, newScheduleId) {
    const order = await Order.findByPk(orderId, { include: [OrderItem] });
    if (!order) throw new Error('订单不存在');
    if (order.status !== 'paid') throw new Error('只有已支付的订单才能申请改签');
    if (order.userId !== userId) throw new Error('只能改签自己的订单');

    const oldSchedule = await Schedule.findByPk(order.scheduleId);
    if (!oldSchedule) throw new Error('原场次不存在');
    if (new Date(oldSchedule.startTime) <= new Date()) throw new Error('原场次已开始，无法改签');

    const newSchedule = await Schedule.findByPk(newScheduleId);
    if (!newSchedule) throw new Error('新场次不存在');
    if (newSchedule.cinemaId !== oldSchedule.cinemaId) throw new Error('只能改签到同一影院的场次');
    if (new Date(newSchedule.startTime) <= new Date()) throw new Error('新场次已开始，无法改签');

    const existingPending = await RefundRecord.findOne({
      where: { orderId, status: { [Op.in]: ['pending', 'supplement_pending'] } }
    });
    if (existingPending) throw new Error('该订单已有待处理的售后申请');

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);

    const record = await RefundRecord.create({
      orderId,
      userId,
      type: 'reschedule',
      status: 'pending',
      reason,
      originalScheduleId: order.scheduleId,
      originalSeatIds: seatIds.join(','),
      newScheduleId,
      supplementStatus: 'none'
    });

    await NotificationService.notifyUser(userId, {
      type: 'reschedule_apply',
      title: '改签申请已提交',
      content: `您的改签申请已提交，订单号：${orderId}，等待运营审批`
    });
    await NotificationService.notifyAdmins({
      type: 'reschedule_apply',
      title: '新改签申请',
      content: `会员申请改签，订单号：${orderId}，目标场次：${newScheduleId}，原因：${reason || '未填写'}`
    });
    await NotificationService.notifySellers({
      type: 'reschedule_apply',
      title: '新改签申请',
      content: `会员申请改签，订单号：${orderId}，目标场次：${newScheduleId}，原因：${reason || '未填写'}`
    });

    return record;
  }

  async approveRefund(recordId, processedBy, processedReason) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');
    if (record.type !== 'refund') throw new Error('该记录不是退票类型');

    const order = await Order.findByPk(record.orderId, { include: [OrderItem] });
    if (!order) throw new Error('关联订单不存在');

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);

    let totalPointsReturned = 0;

    if (seatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, seatIds);
    }

    const concessionItems = order.OrderItems.filter(item => item.itemType === 'concession');
    for (const item of concessionItems) {
      await InventoryService.updateStock(item.itemId, item.quantity, true);
    }

    const memberRecord = await Member.findOne({ where: { userId: order.userId } });
    if (memberRecord) {
      if (order.pointsEarned > 0) {
        await MemberService.returnPoints(
          memberRecord.id,
          order.pointsEarned,
          '退票-扣回获得积分',
          `refund_record_${recordId}`
        );
        totalPointsReturned += order.pointsEarned;
      }
      if (order.pointsUsed > 0) {
        await MemberService.returnPoints(
          memberRecord.id,
          order.pointsUsed,
          '退票-退还抵扣积分',
          `refund_record_${recordId}`
        );
        totalPointsReturned += order.pointsUsed;
      }
    }

    await order.update({ status: 'refunded' });

    await record.update({
      status: 'completed',
      action: 'refund',
      processedBy,
      processedAt: new Date(),
      processedReason,
      refundAmount: order.payAmount,
      pointsReturned: totalPointsReturned
    });

    await NotificationService.notifyUser(order.userId, {
      type: 'refund_approved',
      title: '退票申请已通过',
      content: `您的退票申请已通过，订单号：${order.id}，退款金额：${order.payAmount}元${totalPointsReturned > 0 ? `，${totalPointsReturned}积分已退回` : ''}`
    });
    await NotificationService.notifySellers({
      type: 'refund_approved',
      title: '退票申请已通过',
      content: `退票申请已通过，订单号：${order.id}，退款金额：${order.payAmount}元`
    });

    return record;
  }

  async approveReschedule(recordId, processedBy, newSeatIds, processedReason) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');
    if (record.type !== 'reschedule') throw new Error('该记录不是改签类型');
    if (!record.newScheduleId) throw new Error('缺少目标场次信息');
    if (!newSeatIds || newSeatIds.length === 0) throw new Error('请选择新座位');

    const order = await Order.findByPk(record.orderId, { include: [OrderItem] });
    if (!order) throw new Error('关联订单不存在');

    const newSchedule = await Schedule.findByPk(record.newScheduleId);

    try {
      await SeatLockService.lockSeats(record.newScheduleId, newSeatIds, order.userId);
    } catch (e) {
      await record.update({
        status: 'rejected',
        action: 'reject',
        processedBy,
        processedAt: new Date(),
        processedReason: `目标座位不可用：${e.message}`
      });
      await NotificationService.notifyUser(order.userId, {
        type: 'reschedule_rejected',
        title: '改签申请未通过',
        content: `您的改签申请未通过，原因：目标座位不可用（${e.message}），原订单不受影响`
      });
      return record;
    }

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const oldSeatIds = ticketItems.map(item => item.itemId);
    const oldSchedule = await Schedule.findByPk(order.scheduleId);
    const oldTotal = oldSeatIds.length * oldSchedule.price;
    const newTotal = newSeatIds.length * newSchedule.price;
    const priceDiff = newTotal - oldTotal;

    if (priceDiff > 0) {
      await record.update({
        status: 'supplement_pending',
        action: 'supplement',
        newSeatIds: newSeatIds.join(','),
        processedBy,
        processedAt: new Date(),
        processedReason,
        supplementAmount: priceDiff,
        supplementStatus: 'pending'
      });

      await order.update({
        supplementAmount: priceDiff,
        supplementStatus: 'pending'
      });

      await NotificationService.notifyUser(order.userId, {
        type: 'reschedule_supplement',
        title: '改签需补差价',
        content: `您的改签申请已审批，需补差价${priceDiff}元，补款后改签生效，订单号：${order.id}`
      });

      return record;
    }

    if (oldSeatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, oldSeatIds);
    }

    const newLocks = await SeatLock.findAll({
      where: {
        scheduleId: record.newScheduleId,
        seatId: { [Op.in]: newSeatIds },
        userId: order.userId,
        status: 'locked'
      }
    });
    for (const lock of newLocks) {
      await lock.update({ status: 'paid' });
    }

    await order.update({
      scheduleId: record.newScheduleId,
      totalAmount: order.totalAmount - oldTotal + newTotal,
      payAmount: order.payAmount - oldTotal + newTotal
    });

    await OrderItem.destroy({ where: { orderId: order.id, itemType: 'ticket' } });
    for (const seatId of newSeatIds) {
      await OrderItem.create({
        orderId: order.id,
        itemType: 'ticket',
        itemId: seatId,
        quantity: 1,
        unitPrice: newSchedule.price,
        totalPrice: newSchedule.price
      });
    }

    const refundAmount = oldTotal - newTotal;

    await record.update({
      status: 'completed',
      action: 'supplement',
      newSeatIds: newSeatIds.join(','),
      processedBy,
      processedAt: new Date(),
      processedReason,
      refundAmount,
      supplementAmount: 0,
      supplementStatus: 'none'
    });

    const diffMsg = refundAmount > 0 ? `退还差价${refundAmount}元` : '无差价';

    await NotificationService.notifyUser(order.userId, {
      type: 'reschedule_approved',
      title: '改签申请已通过',
      content: `您的改签申请已通过，订单号：${order.id}，${diffMsg}`
    });
    await NotificationService.notifySellers({
      type: 'reschedule_approved',
      title: '改签申请已通过',
      content: `改签申请已通过，订单号：${order.id}，${diffMsg}`
    });

    return record;
  }

  async completeReschedule(recordId) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'supplement_pending') throw new Error('该记录不在待补款状态');
    if (record.supplementStatus !== 'pending') throw new Error('补款状态不正确');

    const order = await Order.findByPk(record.orderId, { include: [OrderItem] });
    if (!order) throw new Error('关联订单不存在');

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const oldSeatIds = ticketItems.map(item => item.itemId);
    const oldSchedule = await Schedule.findByPk(order.scheduleId);
    const newSchedule = await Schedule.findByPk(record.newScheduleId);
    const newSeatIds = record.newSeatIds.split(',').map(Number);

    if (oldSeatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, oldSeatIds);
    }

    const newLocks = await SeatLock.findAll({
      where: {
        scheduleId: record.newScheduleId,
        seatId: { [Op.in]: newSeatIds },
        userId: order.userId,
        status: 'locked'
      }
    });
    for (const lock of newLocks) {
      await lock.update({ status: 'paid' });
    }

    const oldTotal = oldSeatIds.length * oldSchedule.price;
    const newTotal = newSeatIds.length * newSchedule.price;

    await order.update({
      scheduleId: record.newScheduleId,
      totalAmount: order.totalAmount - oldTotal + newTotal,
      payAmount: order.payAmount - oldTotal + newTotal,
      supplementStatus: 'paid'
    });

    await OrderItem.destroy({ where: { orderId: order.id, itemType: 'ticket' } });
    for (const seatId of newSeatIds) {
      await OrderItem.create({
        orderId: order.id,
        itemType: 'ticket',
        itemId: seatId,
        quantity: 1,
        unitPrice: newSchedule.price,
        totalPrice: newSchedule.price
      });
    }

    await record.update({
      status: 'completed',
      supplementStatus: 'paid'
    });

    await NotificationService.notifyUser(order.userId, {
      type: 'reschedule_completed',
      title: '改签完成',
      content: `您已补款${record.supplementAmount}元，改签完成，订单号：${order.id}`
    });

    return record;
  }

  async rejectRequest(recordId, processedBy, processedReason) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');

    await record.update({
      status: 'rejected',
      action: 'reject',
      processedBy,
      processedAt: new Date(),
      processedReason
    });

    const typeLabel = record.type === 'refund' ? '退票' : '改签';

    await NotificationService.notifyUser(record.userId, {
      type: `${record.type}_rejected`,
      title: `${typeLabel}申请已拒绝`,
      content: `您的${typeLabel}申请已拒绝，订单号：${record.orderId}${processedReason ? `，原因：${processedReason}` : ''}`
    });

    return record;
  }

  async getRefundRecords(query) {
    const { status, type, userId, orderId, cinemaId, movieId } = query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (userId) where.userId = userId;
    if (orderId) where.orderId = orderId;

    const include = [
      { model: Order, include: [OrderItem] },
      { model: User, as: 'Processor', attributes: ['id', 'username', 'name', 'role'] },
      { model: Schedule, as: 'OriginalSchedule', include: [{ model: Movie, attributes: ['id', 'title'] }, { model: Cinema, attributes: ['id', 'name'] }] },
      { model: Schedule, as: 'NewSchedule', include: [{ model: Movie, attributes: ['id', 'title'] }, { model: Cinema, attributes: ['id', 'name'] }] }
    ];

    let records = await RefundRecord.findAll({
      where,
      include,
      order: [['createdAt', 'DESC']]
    });

    if (cinemaId || movieId) {
      records = records.filter(r => {
        const origSchedule = r.OriginalSchedule;
        if (!origSchedule) return false;
        if (cinemaId && origSchedule.cinemaId !== parseInt(cinemaId)) return false;
        if (movieId && origSchedule.movieId !== parseInt(movieId)) return false;
        return true;
      });
    }

    return records;
  }

  async getRefundDetail(recordId) {
    const record = await RefundRecord.findByPk(recordId, {
      include: [
        { model: Order, include: [OrderItem] },
        { model: User, as: 'Processor', attributes: ['id', 'username', 'name', 'role'] },
        { model: Schedule, as: 'OriginalSchedule', include: [{ model: Movie, attributes: ['id', 'title'] }, { model: Cinema, attributes: ['id', 'name'] }] },
        { model: Schedule, as: 'NewSchedule', include: [{ model: Movie, attributes: ['id', 'title'] }, { model: Cinema, attributes: ['id', 'name'] }] }
      ]
    });
    if (!record) throw new Error('记录不存在');

    const order = record.Order;
    const ticketItems = order ? order.OrderItems.filter(i => i.itemType === 'ticket') : [];
    const concessionItems = order ? order.OrderItems.filter(i => i.itemType === 'concession') : [];

    return {
      id: record.id,
      orderId: record.orderId,
      userId: record.userId,
      type: record.type,
      status: record.status,
      action: record.action,
      reason: record.reason,
      originalSchedule: record.OriginalSchedule ? {
        id: record.OriginalSchedule.id,
        movieTitle: record.OriginalSchedule.Movie?.title,
        cinemaName: record.OriginalSchedule.Cinema?.name,
        startTime: record.OriginalSchedule.startTime,
        price: record.OriginalSchedule.price
      } : null,
      originalSeatIds: record.originalSeatIds ? record.originalSeatIds.split(',').map(Number) : [],
      newSchedule: record.NewSchedule ? {
        id: record.NewSchedule.id,
        movieTitle: record.NewSchedule.Movie?.title,
        cinemaName: record.NewSchedule.Cinema?.name,
        startTime: record.NewSchedule.startTime,
        price: record.NewSchedule.price
      } : null,
      newSeatIds: record.newSeatIds ? record.newSeatIds.split(',').map(Number) : [],
      refundAmount: record.refundAmount,
      supplementAmount: record.supplementAmount,
      supplementStatus: record.supplementStatus,
      pointsReturned: record.pointsReturned,
      processedBy: record.Processor ? {
        id: record.Processor.id,
        username: record.Processor.username,
        name: record.Processor.name
      } : null,
      processedAt: record.processedAt,
      processedReason: record.processedReason,
      orderInfo: order ? {
        totalAmount: order.totalAmount,
        payAmount: order.payAmount,
        pointsUsed: order.pointsUsed,
        pointsEarned: order.pointsEarned,
        status: order.status,
        ticketCount: ticketItems.length,
        concessionCount: concessionItems.length
      } : null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}

module.exports = new RefundService();
