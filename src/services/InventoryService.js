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

    const restockRequest = await RestockRequest.create({
      concessionId,
      requestedBy: requestedBy || null,
      quantity: deficit,
      reason: '库存低于安全水位自动生成',
      status: 'pending'
    });

    await NotificationService.notifyAdmins({
      type: 'restock_auto_generated',
      title: '补货申请自动生成',
      content: `卖品[${concession.name}]库存不足（当前${concession.stock}/安全线${concession.safetyStock}），已自动生成补货申请#${restockRequest.id}`
    });
    await NotificationService.notifySellers({
      type: 'restock_auto_generated',
      title: '库存预警通知',
      content: `卖品[${concession.name}]库存不足，已自动生成补货申请#${restockRequest.id}`
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
            status: { [Op.in]: ['pending', 'purchasing'] }
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
        content: `库存扫描完成，共生成 ${requests.length} 条补货申请，请及时审批`
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
    if (request.status !== 'pending') throw new Error('Only pending requests can be approved');

    await request.update({
      status: 'purchasing',
      approvedBy,
      approvedAt: new Date()
    });

    const concessionName = request.Concession ? request.Concession.name : '';

    if (request.requestedBy) {
      await NotificationService.notifyUsers([request.requestedBy], {
        type: 'restock_approved',
        title: '补货申请已审批通过',
        content: `您发起的[${concessionName}]补货申请#${request.id}已审批通过，已进入采购流程`
      });
    }

    await NotificationService.notifyAdmins({
      type: 'restock_approved',
      title: '补货申请已审批通过',
      content: `补货申请#${request.id}[${concessionName}]已审批通过，已进入采购流程`
    });
    await NotificationService.notifySellers({
      type: 'restock_approved',
      title: '补货申请已审批通过',
      content: `补货申请#${request.id}[${concessionName}]已审批通过，已进入采购流程`
    });

    return request;
  }

  async rejectRestockRequest(requestId, approvedBy, reason) {
    const request = await RestockRequest.findByPk(requestId, { include: [Concession] });
    if (!request) throw new Error('Restock request not found');
    if (request.status !== 'pending') throw new Error('Only pending requests can be rejected');

    await request.update({
      status: 'rejected',
      approvedBy,
      approvedAt: new Date()
    });

    const concessionName = request.Concession ? request.Concession.name : '';

    if (request.requestedBy) {
      await NotificationService.notifyUsers([request.requestedBy], {
        type: 'restock_rejected',
        title: '补货申请已拒绝',
        content: `您发起的[${concessionName}]补货申请#${request.id}已被拒绝，原因：${reason || '未填写'}`
      });
    }

    await NotificationService.notifyAdmins({
      type: 'restock_rejected',
      title: '补货申请已拒绝',
      content: `补货申请#${request.id}[${concessionName}]已被拒绝`
    });

    return request;
  }

  async completePurchase(requestId, quantity) {
    const request = await RestockRequest.findByPk(requestId, { include: [Concession] });
    if (!request) throw new Error('Restock request not found');
    if (request.status !== 'purchasing') throw new Error('Only purchasing requests can be completed');

    const concession = await Concession.findByPk(request.concessionId);
    const actualQty = quantity || request.quantity;
    await concession.update({ stock: concession.stock + actualQty });

    await request.update({
      status: 'purchased',
      purchasedQuantity: actualQty,
      purchasedAt: new Date()
    });

    const concessionName = request.Concession ? request.Concession.name : '';

    await NotificationService.notifyAdmins({
      type: 'restock_completed',
      title: '补货采购完成',
      content: `补货申请#${request.id}[${concessionName}]已完成采购入库，数量：${actualQty}，当前库存：${concession.stock}`
    });
    await NotificationService.notifySellers({
      type: 'restock_completed',
      title: '卖品补货完成',
      content: `卖品[${concessionName}]已入库，数量：${actualQty}，当前库存：${concession.stock}`
    });

    if (request.purchasedBy) {
      await NotificationService.notifyUsers([request.purchasedBy], {
        type: 'restock_completed',
        title: '采购入库完成',
        content: `您采购的[${concessionName}]已完成入库，数量：${actualQty}`
      });
    }

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
        status: { [Op.in]: ['pending', 'purchasing'] }
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
