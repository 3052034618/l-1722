const express = require('express');
const router = express.Router();
const SeatLockService = require('../services/SeatLockService');
const MemberService = require('../services/MemberService');
const InventoryService = require('../services/InventoryService');
const NotificationService = require('../services/NotificationService');
const RefundService = require('../services/RefundService');
const { Order, OrderItem, Schedule, Concession, Member, SeatLock } = require('../models');
const { v4: uuidv4 } = require('uuid');

router.post('/', async (req, res) => {
  try {
    const { userId, scheduleId, seatIds, lockToken, concessionItems = [], usePoints = false, pointsToUse = 0 } = req.body;

    if (!lockToken) {
      return res.status(400).json({ code: 400, message: '缺少锁座凭证，请重新选座', data: null });
    }

    if (!seatIds || seatIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择座位', data: null });
    }

    const uniqueSeatIds = [...new Set(seatIds)];
    if (uniqueSeatIds.length !== seatIds.length) {
      return res.status(400).json({ code: 400, message: '提交的座位存在重复，请重新选择', data: null });
    }

    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) {
      return res.status(400).json({ code: 400, message: '排片不存在', data: null });
    }
    if (schedule.status === 'cancelled') {
      return res.status(400).json({ code: 400, message: '该场次已取消', data: null });
    }

    const tokenLocks = await SeatLockService.getLocksByToken(lockToken);
    if (tokenLocks.length === 0) {
      return res.status(400).json({ code: 400, message: '锁座凭证无效，请重新选座', data: null });
    }

    const wrongSchedule = tokenLocks.filter(l => l.scheduleId !== scheduleId);
    if (wrongSchedule.length > 0) {
      return res.status(400).json({ code: 400, message: '锁座凭证与场次不匹配', data: null });
    }

    const wrongUser = tokenLocks.filter(l => l.userId !== userId);
    if (wrongUser.length > 0) {
      return res.status(400).json({ code: 400, message: '锁座凭证与用户不匹配', data: null });
    }

    const now = new Date();
    const expiredOrUsed = tokenLocks.filter(l => l.status !== 'locked' || new Date(l.expireAt) <= now);
    if (expiredOrUsed.length > 0) {
      return res.status(400).json({ code: 400, message: '锁座凭证已过期或已使用，请重新选座', data: null });
    }

    const tokenSeatIds = tokenLocks.map(l => l.seatId).sort((a, b) => a - b);
    const submittedSeatIds = uniqueSeatIds.sort((a, b) => a - b);

    if (tokenSeatIds.length !== submittedSeatIds.length || !tokenSeatIds.every((id, i) => id === submittedSeatIds[i])) {
      return res.status(400).json({
        code: 400,
        message: `提交的座位与锁座凭证不一致，凭证锁定座位为 [${tokenSeatIds.join(', ')}]，请一并结算该凭证下所有座位`,
        data: { tokenSeatIds, submittedSeatIds }
      });
    }

    const ticketTotal = uniqueSeatIds.length * schedule.price;
    let concessionTotal = 0;
    const concessionDetails = [];

    for (const item of concessionItems) {
      const concession = await Concession.findByPk(item.concessionId);
      if (!concession) {
        return res.status(400).json({ code: 400, message: `卖品 ${item.concessionId} 不存在`, data: null });
      }
      if (concession.stock < item.quantity) {
        return res.status(400).json({ code: 400, message: `卖品 ${concession.name} 库存不足`, data: null });
      }
      const itemTotal = concession.price * item.quantity;
      concessionTotal += itemTotal;
      concessionDetails.push({ concession, quantity: item.quantity, unitPrice: concession.price, totalPrice: itemTotal });
    }

    const totalAmount = ticketTotal + concessionTotal;
    const discountResult = await MemberService.calculateDiscount(userId, totalAmount);
    let discountedAmount = discountResult.discountedAmount;

    let pointsDeduction = 0;
    let memberRecord = await Member.findOne({ where: { userId } });

    if (usePoints && pointsToUse > 0) {
      if (memberRecord && memberRecord.points >= pointsToUse) {
        const redeemResult = await MemberService.redeemPoints(
          memberRecord.id,
          pointsToUse,
          'order',
          'pending'
        );
        pointsDeduction = redeemResult.yuanValue;
      }
    }

    const payAmount = Math.max(discountedAmount - pointsDeduction, 0);

    const confirmedLocks = await SeatLockService.confirmLocksByToken(scheduleId, lockToken, userId);
    if (confirmedLocks.length !== tokenLocks.length) {
      for (const lock of confirmedLocks) {
        await lock.update({ status: 'locked' });
      }
      return res.status(400).json({
        code: 400,
        message: '部分座位锁已失效，请重新选座',
        data: null
      });
    }

    const orderId = uuidv4();
    const earliestExpireAt = tokenLocks.reduce((min, l) => l.expireAt < min ? l.expireAt : min, tokenLocks[0].expireAt);

    const order = await Order.create({
      id: orderId,
      userId,
      scheduleId,
      totalAmount,
      discountAmount: totalAmount - discountedAmount,
      payAmount,
      pointsUsed: pointsToUse,
      status: 'pending',
      expireAt: earliestExpireAt
    });

    for (const seatId of uniqueSeatIds) {
      await OrderItem.create({
        orderId,
        itemType: 'ticket',
        itemId: seatId,
        quantity: 1,
        unitPrice: schedule.price,
        totalPrice: schedule.price
      });
    }

    for (const detail of concessionDetails) {
      await OrderItem.create({
        orderId,
        itemType: 'concession',
        itemId: detail.concession.id,
        quantity: detail.quantity,
        unitPrice: detail.unitPrice,
        totalPrice: detail.totalPrice
      });
    }

    let pointsEarned = 0;
    if (memberRecord) {
      const earnResult = await MemberService.earnPoints(memberRecord.id, payAmount, 'order', orderId);
      pointsEarned = earnResult.points;
    }
    await order.update({ pointsEarned });

    for (const detail of concessionDetails) {
      await InventoryService.updateStock(detail.concession.id, detail.quantity, false);
    }

    await NotificationService.notifyUser(userId, {
      type: 'order_created',
      title: '订单创建成功',
      content: `您的订单 ${orderId} 已创建，待支付金额：${payAmount}元，请在 ${new Date(earliestExpireAt).toLocaleTimeString('zh-CN')} 前完成支付`
    });

    await NotificationService.notifySellers({
      type: 'order_created',
      title: '新订单通知',
      content: `有新订单创建：${orderId}，金额：${payAmount}元`
    });

    const fullOrder = await Order.findByPk(orderId, { include: [OrderItem] });
    res.status(201).json({ code: 201, message: '创建订单成功', data: fullOrder });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, { include: [OrderItem] });
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在', data: null });
    }
    res.json({ code: 200, message: '获取订单成功', data: order });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/', async (req, res) => {
  try {
    const { userId, status } = req.query;
    const where = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;
    const orders = await Order.findAll({ where, include: [OrderItem], order: [['createdAt', 'DESC']] });
    res.json({ code: 200, message: '获取订单列表成功', data: orders });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/:id/pay', async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, { include: [OrderItem] });
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在', data: null });
    }
    if (order.status === 'paid') {
      return res.status(400).json({ code: 400, message: '订单已支付', data: order });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ code: 400, message: '订单已取消，无法支付', data: null });
    }

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);
    const seatLocks = await SeatLock.findAll({
      where: { scheduleId: order.scheduleId, seatId: seatIds, status: 'paid' }
    });
    if (seatLocks.length !== seatIds.length) {
      return res.status(400).json({ code: 400, message: '座位锁已失效，无法完成支付，请重新下单', data: null });
    }

    await order.update({ status: 'paid', payTime: new Date() });
    await NotificationService.notifyUser(order.userId, {
      type: 'order_paid',
      title: '支付成功',
      content: `您的订单 ${order.id} 已支付成功，请准时观影`
    });
    await NotificationService.notifySellers({
      type: 'order_paid',
      title: '订单已支付',
      content: `订单 ${order.id} 已完成支付，金额：${order.payAmount}元`
    });
    await NotificationService.notifyAdmins({
      type: 'order_paid',
      title: '新订单支付成功',
      content: `订单 ${order.id} 已支付，金额：${order.payAmount}元`
    });
    res.json({ code: 200, message: '支付成功', data: order });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/:id/cancel', async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id, { include: [OrderItem] });
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在', data: null });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ code: 400, message: '订单已取消', data: order });
    }
    const oldStatus = order.status;
    await order.update({ status: 'cancelled' });

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);
    if (seatIds.length > 0) {
      await SeatLockService.releaseSeatsForOrder(order.scheduleId, seatIds);
    }

    const concessionItems = order.OrderItems.filter(item => item.itemType === 'concession');
    for (const item of concessionItems) {
      await InventoryService.updateStock(item.itemId, item.quantity, true);
    }

    if (oldStatus === 'paid') {
      const memberRecord = await Member.findOne({ where: { userId: order.userId } });
      if (memberRecord) {
        await MemberService.redeemPoints(memberRecord.id, order.pointsEarned, 'cancel', order.id);
      }
    }

    await NotificationService.notifyUser(order.userId, {
      type: 'order_cancelled',
      title: '订单已取消',
      content: `您的订单 ${order.id} 已取消`
    });
    await NotificationService.notifySellers({
      type: 'order_cancelled',
      title: '订单已取消',
      content: `订单 ${order.id} 已取消`
    });
    await NotificationService.notifyAdmins({
      type: 'order_cancelled',
      title: '订单取消通知',
      content: `订单 ${order.id} 已取消`
    });
    res.json({ code: 200, message: '取消订单成功', data: order });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/:id/refund', async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const record = await RefundService.applyRefund(req.params.id, userId, reason);
    res.status(201).json({ code: 201, message: '退票申请已提交', data: record });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/:id/reschedule', async (req, res) => {
  try {
    const { userId, reason, newScheduleId } = req.body;
    const record = await RefundService.applyReschedule(req.params.id, userId, reason, newScheduleId);
    res.status(201).json({ code: 201, message: '改签申请已提交', data: record });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
