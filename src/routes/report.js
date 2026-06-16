const express = require('express');
const router = express.Router();
const ReportService = require('../services/ReportService');
const path = require('path');

router.post('/generate', async (req, res) => {
  try {
    const { cinemaId, reportDate, createdBy } = req.body;
    const result = await ReportService.generateDailyReport(cinemaId, reportDate, createdBy);
    res.status(201).json({ code: 201, message: '生成报表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await ReportService.getReports(req.query);
    res.json({ code: 200, message: '获取报表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/export', async (req, res) => {
  try {
    const filePath = await ReportService.exportToExcel(req.query);
    const fileName = path.basename(filePath);
    if (req.query.format === 'json') {
      return res.json({
        code: 200,
        message: '导出成功',
        data: { filePath, fileName, downloadUrl: '/exports/' + fileName }
      });
    }
    res.download(filePath, fileName, (err) => {
      if (err) {
        res.status(500).json({ code: 500, message: '导出失败', data: { filePath, fileName } });
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/hall-detail', async (req, res) => {
  try {
    const { cinemaId, date } = req.query;
    const result = await ReportService.getHallAttendanceDetail(cinemaId, date);
    res.json({ code: 200, message: '获取影厅上座明细成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const { cinemaId } = req.query;
    const result = await ReportService.getDashboardSummary(cinemaId);
    res.json({ code: 200, message: '获取仪表盘数据成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
