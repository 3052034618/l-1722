const { Op } = require('sequelize');
const { Concession, RestockRequest, User, Notification } = require('../models');
const config = require('../config/index');
const NotificationService = require('./NotificationService');

class InventoryService {
  async checkSafetyLevel(concessionId) {
    const concession = await Concession.findByPk(concessionId);
    if (!concession) throw new Error('Concession not found');

    const isBelowSafety = concession.stock <= concession.safetyStock * config.inventory.safetyRatio || concession.stock <= concession.safetyStock;
    const deficit = isBelowSafety ? concession.safetyStock - concession.stock : 0;

    return {
      isBelowSafety,
      currentStock: concession.stock,
      safetyStock: concession.safetyStock,
      deficit
    };
  }

  async checkAllSafetyLevels(cinemaId) {
    const where = {};
    if (cinemaId) where.cinemaId = cinemaId;
    const concessions = await Concession.findAll({ where });
    const results = [];

    for (const concession of concessions) {
      const isBelowSafety = concession.stock <= concession.safetyStock * config.inventory.safetyRatio || concession.stock <= concession.safetyStock;
      const deficit = isBelowSafety ? concession.safetyStock - concession.stock : 0;

      results.push({
        concession,
        isBelowSafety,
        currentStock: concession.stock,
        safetyStock: concession.safetyStock,
        deficit
      });
    }

    return results;
  }

  async autoGenerateRestockRequest(concessionId, requestedBy) {
    const concession = await Concession.findByPk(concessionId);
    if (!concession) throw new Error('Concession not found');

    const safetyCheck = await this.checkSafetyLevel(concessionId);
    if (!safetyCheck.isBelowSafety) throw new Error('Concession stock is above safety level');

    const deficit = Math.max(concession.safetyStock * 2 - concession.stock, concession.safetyStock);
    const effectiveRequestedBy = requestedBy || null;

    const restockRequest = await RestockRequest.create({
      concessionId,
      requestedBy: effectiveRequestedBy,
      quantity: deficit,
      reason: '库存低于安全水位自动生成',
      status: 'pending'
    });

    await NotificationService.notifyAdmins({
      type: 'restock_auto_generated',
      title: '补货申请自动生成',
      content: `卖品[${concession.name}]库存不足（当前${concession.stock}/安全线${concession.safetyStock}），已自动生成补货申请`
    });
    await NotificationService.notifySellers({
      type: 'restock_auto_generated',
      title: '库存预警通知',
      content: `卖品[${concession.name}]库存不足，已自动生成补货申请`
    });

    return restockRequest;
  }

  async scanAndGenerateRestockRequests(cinemaId) {
    const safetyResults = await this.checkAllSafetyLevels(cinemaId);
    const requests = [];

    for (const item of safetyResults) {
      if (item.isBelowSafety) {
        const existingPending = await RestockRequest.count({
          where: {
            concessionId: item.concession.id,
            status: { [Op.in]: ['pending', 'approved'] }
          }
        });

        if (existingPending === 0) {
          const deficit = Math.max(item.concession.safetyStock * 2 - item.concession.stock, item.concession.safetyStock);
          const restockRequest = await RestockRequest.create({
            concessionId: item.concession.id,
            requestedBy: null,
            quantity: deficit,
            reason: '库存低于安全水位自动生成',
            status: 'pending'
          });

          requests.push(restockRequest);
        }
      }
    }

    if (requests.length > 0) {
      await NotificationService.notifyAdmins({
        type: 'restock_batch_generated',
        title: '补货申请批量生成',
        content: `库存扫描完成，共生成 ${requests.length} 条补货申请，请及时处理`
      });
      await NotificationService.notifySellers({
        type: 'inventory_alert',
        title: '库存预警通知',
        content: `库存扫描完成，共发现 ${requests.length} 种卖品库存不足`
      });
    }

    return requests;
  }

  async approveRestockRequest(requestId, approvedBy) {
    const request = await RestockRequest.findByPk(requestId, { include: [Concession] });
    if (!request) throw new Error('Restock request not found');
    if (request.status !== 'pending') throw new Error('Restock request is not in pending status');

    await request.update({
      status: 'approved',
      approvedBy,
      approvedAt: new Date()
    });

    if (request.requestedBy) {
      await NotificationService.notifyUsers([request.requestedBy], {
        type: 'restock_approved',
        title: '补货申请已审批',
        content: `您发起的[${request.Concession ? request.Concession.name : ''}]补货申请已审批通过`
      });
    }

    await NotificationService.notifyAdmins({
      type: 'restock_purchase_needed',
      title: '补货申请待采购',
      content: `有新的补货申请已审批，请及时采购`
    });
    await NotificationService.notifySellers({
      type: 'restock_approved',
      title: '补货审批通过',
      content: `补货申请已审批，${request.Concession ? request.Concession.name : ''}正在采购中`
    });

    return request;
  }

  async rejectRestockRequest(requestId, approvedBy, reason) {
    const request = await RestockRequest.findByPk(requestId, { include: [Concession] });
    if (!request) throw new Error('Restock request not found');
    if (request.status !== 'pending') throw new Error('Restock request is not in pending status');

    await request.update({
      status: 'rejected',
      approvedBy,
      approvedAt: new Date()
    });

    if (request.requestedBy) {
      await NotificationService.notifyUsers([request.requestedBy], {
        type: 'restock_rejected',
        title: '补货申请已拒绝',
        content: `您的补货申请已被拒绝，原因：${reason || '未填写'}`
      });
    }

    return request;
  }

  async completePurchase(requestId, quantity) {
    const request = await RestockRequest.findByPk(requestId, {
      include: [Concession]
    });
    if (!request) throw new Error('Restock request not found');
    if (request.status !== 'approved') throw new Error('Restock request is not in approved status');

    await request.update({ status: 'purchased' });

    const concession = await Concession.findByPk(request.concessionId);
    const actualQty = quantity || request.quantity;
    await concession.update({ stock: concession.stock + actualQty });

    await NotificationService.notifyAdmins({
      type: 'restock_completed',
      title: '补货采购完成',
      content: `卖品[${concession.name}]已完成采购入库，数量：${actualQty}，当前库存：${concession.stock}`
    });
    await NotificationService.notifySellers({
      type: 'restock_completed',
      title: '卖品补货完成',
      content: `卖品[${concession.name}]已入库，数量：${actualQty}`
    });

    return request;
  }

  async updateStock(concessionId, quantity, isAdd) {
    const concession = await Concession.findByPk(concessionId);
    if (!concession) throw new Error('Concession not found');

    const newStock = isAdd ? concession.stock + quantity : Math.max(concession.stock - quantity, 0);
    await concession.update({ stock: newStock });

    const existingPending = await RestockRequest.count({
      where: {
        concessionId,
        status: { [Op.in]: ['pending', 'approved'] }
      }
    });

    const safetyCheck = await this.checkSafetyLevel(concessionId);
    if (safetyCheck.isBelowSafety && existingPending === 0) {
      await this.autoGenerateRestockRequest(concessionId, null);
    }

    return concession;
  }

  async getConcessions(cinemaId) {
    const where = {};
    if (cinemaId) where.cinemaId = cinemaId;
    return Concession.findAll({ where });
  }

  async getRestockRequests(query) {
    const { cinemaId, status, requestedBy } = query;
    const where = {};

    if (status) where.status = status;
    if (requestedBy) where.requestedBy = requestedBy;

    if (cinemaId) {
      const concessions = await Concession.findAll({
        where: { cinemaId },
        attributes: ['id']
      });
      const concessionIds = concessions.map(c => c.id);
      if (concessionIds.length > 0) {
        where.concessionId = { [Op.in]: concessionIds };
      }
    }

    return RestockRequest.findAll({ where, include: [Concession] });
  }
}

module.exports = new InventoryService();
