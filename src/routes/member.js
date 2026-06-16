const express = require('express');
const router = express.Router();
const MemberService = require('../services/MemberService');

router.get('/info/:userId', async (req, res) => {
  try {
    const result = await MemberService.getMemberInfo(req.params.userId);
    if (!result) {
      return res.status(404).json({ code: 404, message: '会员信息不存在', data: null });
    }
    res.json({ code: 200, message: '获取会员信息成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/discount', async (req, res) => {
  try {
    const { userId, amount } = req.query;
    const result = await MemberService.calculateDiscount(userId, parseFloat(amount));
    res.json({ code: 200, message: '计算折扣成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await MemberService.createMember(userId);
    res.status(201).json({ code: 201, message: '创建会员成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.post('/redeem', async (req, res) => {
  try {
    const { memberId, points, itemType, itemId } = req.body;
    const result = await MemberService.redeemPoints(memberId, points, itemType, itemId);
    res.json({ code: 200, message: '积分兑换成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.get('/points-records/:memberId', async (req, res) => {
  try {
    const result = await MemberService.getPointsRecords(req.params.memberId, req.query);
    res.json({ code: 200, message: '获取积分记录成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/levels', async (req, res) => {
  try {
    const result = MemberService.getMemberLevels();
    res.json({ code: 200, message: '获取会员等级定义成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
