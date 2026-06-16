const { Member, PointsRecord, User, Order, Concession, Schedule } = require('../models');
const NotificationService = require('./NotificationService');

const MEMBER_LEVELS = {
  normal: { minSpend: 0, discountRate: 1.0, pointsRate: 1 },
  silver: { minSpend: 500, discountRate: 0.95, pointsRate: 1.2 },
  gold: { minSpend: 2000, discountRate: 0.9, pointsRate: 1.5 },
  platinum: { minSpend: 5000, discountRate: 0.85, pointsRate: 2.0 }
};

const LEVEL_ORDER = ['normal', 'silver', 'gold', 'platinum'];

const POINTS_TO_YUAN = 100;
const MIN_REDEMPTION_POINTS = 100;

class MemberService {
  async getMemberInfo(userId) {
    const member = await Member.findOne({ where: { userId } });
    if (!member) return null;
    const levelConfig = MEMBER_LEVELS[member.level];
    return {
      level: member.level,
      points: member.points,
      totalSpent: member.totalSpent,
      discountRate: levelConfig.discountRate
    };
  }

  async calculateDiscount(userId, originalAmount) {
    const member = await Member.findOne({ where: { userId } });
    const discountRate = member ? MEMBER_LEVELS[member.level].discountRate : MEMBER_LEVELS.normal.discountRate;
    const discountedAmount = originalAmount * discountRate;
    return {
      originalAmount,
      discountRate,
      discountedAmount,
      savedAmount: originalAmount - discountedAmount
    };
  }

  async earnPoints(memberId, amount, source, referenceId) {
    const member = await Member.findByPk(memberId);
    if (!member) throw new Error('会员不存在');

    const levelConfig = MEMBER_LEVELS[member.level];
    const points = Math.floor(amount * levelConfig.pointsRate);

    member.points += points;
    member.totalSpent += amount;
    await member.save();

    await PointsRecord.create({
      memberId,
      type: 'earn',
      points,
      source,
      referenceId,
      balance: member.points
    });

    const { upgraded, newLevel } = await this.checkAndUpgradeLevel(memberId);

    return {
      points,
      newBalance: member.points,
      levelUpgraded: upgraded,
      newLevel: upgraded ? newLevel : member.level
    };
  }

  async redeemPoints(memberId, points, itemType, itemId) {
    if (points < MIN_REDEMPTION_POINTS) {
      throw new Error(`最低兑换${MIN_REDEMPTION_POINTS}积分`);
    }

    const member = await Member.findByPk(memberId);
    if (!member) throw new Error('会员不存在');
    if (member.points < points) throw new Error('积分不足');

    member.points -= points;
    await member.save();

    const record = await PointsRecord.create({
      memberId,
      type: 'redeem',
      points: -points,
      source: `兑换${itemType}`,
      referenceId: itemId,
      balance: member.points
    });

    return {
      yuanValue: points / POINTS_TO_YUAN,
      record
    };
  }

  async getPointsRecords(memberId, query = {}) {
    const { page = 1, pageSize = 10, type } = query;
    const where = { memberId };
    if (type) where.type = type;

    const offset = (page - 1) * pageSize;
    const { count, rows } = await PointsRecord.findAndCountAll({
      where,
      offset,
      limit: pageSize,
      order: [['createdAt', 'DESC']]
    });

    return {
      total: count,
      page,
      pageSize,
      records: rows
    };
  }

  async checkAndUpgradeLevel(memberId) {
    const member = await Member.findByPk(memberId);
    if (!member) throw new Error('会员不存在');

    const currentLevelIndex = LEVEL_ORDER.indexOf(member.level);
    let newLevel = member.level;

    for (let i = LEVEL_ORDER.length - 1; i > currentLevelIndex; i--) {
      if (member.totalSpent >= MEMBER_LEVELS[LEVEL_ORDER[i]].minSpend) {
        newLevel = LEVEL_ORDER[i];
        break;
      }
    }

    if (newLevel === member.level) {
      return { upgraded: false, newLevel: member.level };
    }

    member.level = newLevel;
    member.discountRate = MEMBER_LEVELS[newLevel].discountRate;
    await member.save();

    try {
      await NotificationService.sendNotification(member.userId, {
        title: '会员等级升级',
        content: `恭喜您！您的会员等级已升级为${newLevel}，享受${MEMBER_LEVELS[newLevel].discountRate}折优惠！`
      });
    } catch (e) {}

    return { upgraded: true, newLevel };
  }

  async createMember(userId) {
    return await Member.create({
      userId,
      level: 'normal',
      points: 0,
      totalSpent: 0,
      discountRate: MEMBER_LEVELS.normal.discountRate
    });
  }

  getMemberLevels() {
    return MEMBER_LEVELS;
  }
}

module.exports = new MemberService();
