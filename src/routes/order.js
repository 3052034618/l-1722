const express = require('express');
const router = express.Router();
const SeatLockService = require('../services/SeatLockService');
const MemberService = require('../services/MemberService');
const InventoryService = require('../services/InventoryService');
const NotificationService = require('../services/NotificationService');
const { Order, OrderItem, Schedule, Concession } = require('../models');
const { v4: uuidv4 } = require('uuid');

router.post('/', async (req, res) => {
  try {
    const { userId, scheduleId, seatIds, concessionItems = [], usePoints = false, pointsToUse = 0 } = req.body;

    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) {
      return res.status(400).json({ code: 400, message: '排片不存在', data: null });
    }

    const ticketTotal = seatIds.length * schedule.price;
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
    if (usePoints && pointsToUse > 0) {
      const member = await MemberService.getMemberInfo(userId);
      if (member && member.points >= pointsToUse) {
        const redeemResult = await MemberService.redeemPoints(
          (await require('../models').Member.findOne({ where: { userId } })).id,
          pointsToUse,
          'order',
          'pending'
        );
        pointsDeduction = redeemResult.yuanValue;
      }
    }

    const payAmount = Math.max(discountedAmount - pointsDeduction, 0);
    const orderId = uuidv4();

    const order = await Order.create({
      id: orderId,
      userId,
      scheduleId,
      totalAmount,
      discountAmount: totalAmount - discountedAmount,
      payAmount,
      pointsUsed: pointsToUse,
      status: 'pending'
    });

    for (const seatId of seatIds) {
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

    await SeatLockService.confirmLocks(scheduleId, seatIds, userId);

    const memberRecord = await require('../models').Member.findOne({ where: { userId } });
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
      content: `您的订单 ${orderId} 已创建，待支付金额：${payAmount}元`
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
    const order = await Order.findByPk(req.params.id);
    if (!order) {
      return res.status(404).json({ code: 404, message: '订单不存在', data: null });
    }
    await order.update({ status: 'paid', payTime: new Date() });
    await NotificationService.notifyUser(order.userId, {
      type: 'order_paid',
      title: '支付成功',
      content: `您的订单 ${order.id} 已支付成功`
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
    await order.update({ status: 'cancelled' });

    const ticketItems = order.OrderItems.filter(item => item.itemType === 'ticket');
    const seatIds = ticketItems.map(item => item.itemId);
    if (seatIds.length > 0) {
      const { SeatLock, Seat } = require('../models');
      const locks = await SeatLock.findAll({
        where: { scheduleId: order.scheduleId, seatId: seatIds, status: 'paid' }
      });
      for (const lock of locks) {
        await lock.update({ status: 'released' });
        await Seat.update({ status: 'available' }, { where: { id: lock.seatId } });
      }
    }

    const concessionItems = order.OrderItems.filter(item => item.itemType === 'concession');
    for (const item of concessionItems) {
      await InventoryService.updateStock(item.itemId, item.quantity, true);
    }

    await NotificationService.notifyUser(order.userId, {
      type: 'order_cancelled',
      title: '订单已取消',
      content: `您的订单 ${order.id} 已取消`
    });
    res.json({ code: 200, message: '取消订单成功', data: order });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
