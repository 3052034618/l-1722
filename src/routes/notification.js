const express = require('express');
const router = express.Router();
const NotificationService = require('../services/NotificationService');

router.get('/', async (req, res) => {
  try {
    const { userId, page, pageSize, isRead, type, startDate, endDate } = req.query;
    const result = await NotificationService.getNotifications(userId, { page, pageSize, isRead, type, startDate, endDate });
    res.json({ code: 200, message: '获取通知列表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/admin-overview', async (req, res) => {
  try {
    const { page, pageSize, isRead, type, startDate, endDate } = req.query;
    const result = await NotificationService.getAdminOverview({ page, pageSize, isRead, type, startDate, endDate });
    res.json({ code: 200, message: '获取全站通知概览成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/member/:userId', async (req, res) => {
  try {
    const { page, pageSize, isRead, type, startDate, endDate } = req.query;
    const result = await NotificationService.getMemberNotifications(req.params.userId, { page, pageSize, isRead, type, startDate, endDate });
    res.json({ code: 200, message: '获取会员通知成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    const { userId } = req.query;
    const result = await NotificationService.markAsRead(req.params.id, userId);
    if (!result) {
      return res.status(404).json({ code: 404, message: '通知不存在', data: null });
    }
    res.json({ code: 200, message: '标记已读成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    const { userId } = req.query;
    const count = await NotificationService.markAllAsRead(userId);
    res.json({ code: 200, message: '全部标记已读成功', data: { count } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const { userId } = req.query;
    const count = await NotificationService.getUnreadCount(userId);
    res.json({ code: 200, message: '获取未读数成功', data: { count } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
