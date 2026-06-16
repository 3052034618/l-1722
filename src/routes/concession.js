const express = require('express');
const router = express.Router();
const InventoryService = require('../services/InventoryService');

router.get('/', async (req, res) => {
  try {
    const { cinemaId } = req.query;
    const result = await InventoryService.getConcessions(cinemaId);
    res.json({ code: 200, message: '获取卖品列表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/safety-check', async (req, res) => {
  try {
    const { cinemaId } = req.query;
    const result = await InventoryService.checkAllSafetyLevels(cinemaId);
    res.json({ code: 200, message: '安全水位检查完成', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/:id/restock', async (req, res) => {
  try {
    const result = await InventoryService.autoGenerateRestockRequest(req.params.id, req.body.requestedBy);
    res.status(201).json({ code: 201, message: '补货申请已生成', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.get('/restock-requests', async (req, res) => {
  try {
    const result = await InventoryService.getRestockRequests(req.query);
    res.json({ code: 200, message: '获取补货申请列表成功', data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.put('/restock-requests/:id/approve', async (req, res) => {
  try {
    const result = await InventoryService.approveRestockRequest(req.params.id, req.body.approvedBy);
    res.json({ code: 200, message: '补货申请已审批通过', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/restock-requests/:id/reject', async (req, res) => {
  try {
    const { approvedBy, reason } = req.body;
    const result = await InventoryService.rejectRestockRequest(req.params.id, approvedBy, reason);
    res.json({ code: 200, message: '补货申请已拒绝', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/restock-requests/:id/start-purchase', async (req, res) => {
  try {
    const { purchasedBy } = req.body;
    const result = await InventoryService.startPurchase(req.params.id, purchasedBy);
    res.json({ code: 200, message: '采购已开始', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/restock-requests/:id/purchase', async (req, res) => {
  try {
    const { quantity } = req.body;
    const result = await InventoryService.completePurchase(req.params.id, quantity);
    res.json({ code: 200, message: '采购完成', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

router.put('/:id/stock', async (req, res) => {
  try {
    const { quantity, isAdd } = req.body;
    const result = await InventoryService.updateStock(req.params.id, quantity, isAdd);
    res.json({ code: 200, message: '库存更新成功', data: result });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message, data: null });
  }
});

module.exports = router;
