const { RefundRecord, Order, OrderItem, Schedule, Member, SeatLock, User, Op } = require('../models');
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

    const record = await RefundRecord.create({
      orderId,
      userId,
      type: 'refund',
      status: 'pending',
      reason
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

    const record = await RefundRecord.create({
      orderId,
      userId,
      type: 'reschedule',
      status: 'pending',
      reason,
      newScheduleId
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

  async approveRefund(recordId, processedBy) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');
    if (record.type !== 'refund') throw new Error('该记录不是退票类型');

    const order = await Order.findByPk(record.orderId, { include: [OrderItem] });
    if (!order) throw new Error('关联订单不存在');

    await record.update({
      status: 'completed',
      processedBy,
      processedAt: new Date(),
      refundAmount: order.payAmount
    });

    await order.update({ status: 'refunded' });

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);
    if (seatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, seatIds);
    }

    const concessionItems = order.OrderItems.filter(item => item.itemType === 'concession');
    for (const item of concessionItems) {
      await InventoryService.updateStock(item.itemId, item.quantity, true);
    }

    const memberRecord = await Member.findOne({ where: { userId: order.userId } });
    if (memberRecord && order.pointsEarned > 0) {
      await MemberService.redeemPoints(memberRecord.id, order.pointsEarned, 'refund', order.id);
    }

    await NotificationService.notifyUser(order.userId, {
      type: 'refund_approved',
      title: '退票申请已通过',
      content: `您的退票申请已通过，订单号：${order.id}，退款金额：${order.payAmount}元`
    });
    await NotificationService.notifySellers({
      type: 'refund_approved',
      title: '退票申请已通过',
      content: `退票申请已通过，订单号：${order.id}，退款金额：${order.payAmount}元`
    });
    await NotificationService.notifyAdmins({
      type: 'refund_approved',
      title: '退票申请已通过',
      content: `退票申请已通过，订单号：${order.id}，退款金额：${order.payAmount}元`
    });

    return record;
  }

  async approveReschedule(recordId, processedBy, newSeatIds) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');
    if (record.type !== 'reschedule') throw new Error('该记录不是改签类型');
    if (!record.newScheduleId) throw new Error('缺少目标场次信息');
    if (!newSeatIds || newSeatIds.length === 0) throw new Error('请选择新座位');

    const order = await Order.findByPk(record.orderId, { include: [OrderItem] });
    if (!order) throw new Error('关联订单不存在');

    const oldSchedule = await Schedule.findByPk(order.scheduleId);
    const newSchedule = await Schedule.findByPk(record.newScheduleId);

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const oldSeatIds = ticketItems.map(item => item.itemId);
    if (oldSeatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, oldSeatIds);
    }

    await SeatLockService.lockSeats(record.newScheduleId, newSeatIds, order.userId);

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

    let refundAmount = 0;
    const oldTotal = oldSeatIds.length * oldSchedule.price;
    const newTotal = newSeatIds.length * newSchedule.price;
    refundAmount = oldTotal - newTotal;

    await order.update({ scheduleId: record.newScheduleId });

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
      newSeatIds: newSeatIds.join(','),
      processedBy,
      processedAt: new Date(),
      refundAmount
    });

    const diffMsg = refundAmount > 0 ? `退还差价${refundAmount}元` : refundAmount < 0 ? `需补差价${Math.abs(refundAmount)}元` : '无差价';

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
    await NotificationService.notifyAdmins({
      type: 'reschedule_approved',
      title: '改签申请已通过',
      content: `改签申请已通过，订单号：${order.id}，${diffMsg}`
    });

    return record;
  }

  async rejectRequest(recordId, processedBy) {
    const record = await RefundRecord.findByPk(recordId);
    if (!record) throw new Error('记录不存在');
    if (record.status !== 'pending') throw new Error('只有待处理的记录才能审批');

    await record.update({
      status: 'rejected',
      processedBy,
      processedAt: new Date()
    });

    const typeLabel = record.type === 'refund' ? '退票' : '改签';

    await NotificationService.notifyUser(record.userId, {
      type: `${record.type}_rejected`,
      title: `${typeLabel}申请已拒绝`,
      content: `您的${typeLabel}申请已拒绝，订单号：${record.orderId}`
    });

    return record;
  }

  async getRefundRecords(query) {
    const { status, type, userId, orderId } = query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (userId) where.userId = userId;
    if (orderId) where.orderId = orderId;

    return RefundRecord.findAll({
      where,
      include: [Order, User],
      order: [['createdAt', 'DESC']]
    });
  }
}

module.exports = new RefundService();
