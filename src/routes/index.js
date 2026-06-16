const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/schedules', require('./schedule'));
router.use('/seats', require('./seat'));
router.use('/orders', require('./order'));
router.use('/concessions', require('./concession'));
router.use('/members', require('./member'));
router.use('/reports', require('./report'));
router.use('/notifications', require('./notification'));
router.use('/refunds', require('./refund'));

module.exports = router;
