const express = require('express');
const router = express.Router();
const ScheduleService = require('../services/ScheduleService');

router.get('/recommend', async (req, res) => {
  try {
    const { movieId, hallId, date } = req.query;
    const result = await ScheduleService.recommendOptimalSlots(movieId, hallId, date);
    res.json({ code: 200, message: '获取推荐场次成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/conflict', async (req, res) => {
  try {
    const { hallId, startTime, endTime } = req.query;
    const result = await ScheduleService.checkConflict(hallId, startTime, endTime);
    res.json({ code: 200, message: '冲突检查完成', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/alternatives', async (req, res) => {
  try {
    const { movieId, hallId, date, conflictingStartTime } = req.query;
    const result = await ScheduleService.recommendAlternativeSlots(movieId, hallId, date, conflictingStartTime);
    res.json({ code: 200, message: '获取备选场次成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await ScheduleService.createSchedule(req.body);
    res.status(201).json({ code: 201, message: '创建排片成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/:id/lock', async (req, res) => {
  try {
    const result = await ScheduleService.lockSchedule(req.params.id, req.body.lockedBy);
    res.json({ code: 200, message: '锁定排片成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/:id/unlock', async (req, res) => {
  try {
    const result = await ScheduleService.unlockSchedule(req.params.id);
    res.json({ code: 200, message: '解锁排片成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const result = await ScheduleService.updateSchedule(req.params.id, req.body);
    res.json({ code: 200, message: '更新排片成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await ScheduleService.cancelSchedule(req.params.id);
    res.json({ code: 200, message: '取消排片成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await ScheduleService.getSchedules(req.query);
    res.json({ code: 200, message: '获取排片列表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
