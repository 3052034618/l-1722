const cron = require('node-cron');
const ReportService = require('../services/ReportService');
const SeatLockService = require('../services/SeatLockService');
const InventoryService = require('../services/InventoryService');
const { User } = require('../models');

const scheduledTasks = [];

function startCronJobs() {
  const dailyReportTask = cron.schedule('0 0 * * *', async () => {
    console.log('开始生成每日运营报表...');
    try {
      await ReportService.generateAllCinemasDailyReport();
      console.log('每日运营报表生成完成');
    } catch (err) {
      console.error('每日运营报表生成失败:', err);
    }
  });
  scheduledTasks.push(dailyReportTask);

  const seatLockTask = cron.schedule('* * * * *', async () => {
    try {
      const count = await SeatLockService.releaseExpiredLocks();
      if (count > 0) {
        console.log(`已释放 ${count} 个超时座位锁`);
      }
    } catch (err) {
      console.error('座位锁释放失败:', err);
    }
  });
  scheduledTasks.push(seatLockTask);

  const inventoryTask = cron.schedule('*/30 * * * *', async () => {
    console.log('开始检查卖品库存安全水位...');
    try {
      await InventoryService.scanAndGenerateRestockRequests(null);
      console.log('卖品库存安全水位检查完成');
    } catch (err) {
      console.error('卖品库存安全水位检查失败:', err);
    }
  });
  scheduledTasks.push(inventoryTask);
}

function stopCronJobs() {
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks.length = 0;
}

module.exports = { startCronJobs, stopCronJobs };
