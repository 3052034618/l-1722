const { Op } = require('sequelize');
const { Order, OrderItem, SeatLock, Member } = require('../models');
const SeatLockService = require('./SeatLockService');
const InventoryService = require('./InventoryService');
const MemberService = require('./MemberService');
const NotificationService = require('./NotificationService');

class OrderService {
  async cancelExpiredOrders() {
    const now = new Date();

    const expiredOrders = await Order.findAll({
      where: {
        status: 'pending',
        expireAt: { [Op.lt]: now }
      },
      include: [OrderItem]
    });

    let cancelledCount = 0;

    for (const order of expiredOrders) {
      try {
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

        await NotificationService.notifyUser(order.userId, {
          type: 'order_timeout_cancelled',
          title: '订单超时自动取消',
          content: `您的订单 ${order.id} 因超时未支付已自动取消，锁定座位已释放`
        });

        await NotificationService.notifySellers({
          type: 'order_timeout_cancelled',
          title: '订单超时取消',
          content: `订单 ${order.id} 超时未支付已自动取消`
        });

        cancelledCount++;
      } catch (err) {
        console.error(`取消超时订单 ${order.id} 失败:`, err.message);
      }
    }

    return cancelledCount;
  }
}

module.exports = new OrderService();
