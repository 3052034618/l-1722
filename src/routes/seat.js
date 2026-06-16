const express = require('express');
const router = express.Router();
const SeatLockService = require('../services/SeatLockService');

router.post('/lock', async (req, res) => {
  try {
    const { scheduleId, seatIds, userId } = req.body;
    const result = await SeatLockService.lockSeats(scheduleId, seatIds, userId);
    res.status(201).json({ code: 201, message: '锁定座位成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.delete('/lock/:lockId', async (req, res) => {
  try {
    const { userId } = req.query;
    const result = await SeatLockService.releaseLock(req.params.lockId, userId);
    res.json({ code: 200, message: '释放座位锁定成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.get('/locked/:scheduleId', async (req, res) => {
  try {
    const result = await SeatLockService.getLockedSeats(req.params.scheduleId);
    res.json({ code: 200, message: '获取已锁定座位成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/available/:scheduleId', async (req, res) => {
  try {
    const result = await SeatLockService.getAvailableSeats(req.params.scheduleId);
    res.json({ code: 200, message: '获取可用座位成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
