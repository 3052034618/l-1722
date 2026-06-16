const express = require('express');
const router = express.Router();
const RefundService = require('../services/RefundService');
const { RefundRecord } = require('../models');

router.get('/', async (req, res) => {
  try {
    const records = await RefundService.getRefundRecords(req.query);
    res.json({ code: 200, message: '获取售后记录成功', data: records });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await RefundService.getRefundDetail(req.params.id);
    res.json({ code: 200, message: '获取售后详情成功', data: detail });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/:id/approve', async (req, res) => {
  try {
    const { processedBy, newSeatIds, processedReason } = req.body;
    const refundRecord = await RefundRecord.findByPk(req.params.id);
    if (!refundRecord) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null });
    }

    let result;
    if (refundRecord.type === 'refund') {
      result = await RefundService.approveRefund(req.params.id, processedBy, processedReason);
    } else {
      if (!newSeatIds || newSeatIds.length === 0) {
        return res.status(400).json({ code: 400, message: '改签审批需要提供新座位', data: null });
      }
      result = await RefundService.approveReschedule(req.params.id, processedBy, newSeatIds, processedReason);
    }
    res.json({ code: 200, message: '审批通过成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/:id/reject', async (req, res) => {
  try {
    const { processedBy, processedReason } = req.body;
    const result = await RefundService.rejectRequest(req.params.id, processedBy, processedReason);
    res.json({ code: 200, message: '已拒绝申请', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/:id/supplement-pay', async (req, res) => {
  try {
    const result = await RefundService.completeReschedule(req.params.id);
    res.json({ code: 200, message: '补款成功，改签完成', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
