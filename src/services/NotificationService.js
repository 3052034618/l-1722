const { Notification, User } = require('../models');

class NotificationService {
  initialize(io) {
    this.io = io;

    io.use((socket, next) => {
      const userId = socket.handshake.auth.token;
      if (!userId) {
        return next(new Error('Authentication required'));
      }
      socket.userId = userId;
      next();
    });

    io.on('connection', (socket) => {
      User.findByPk(socket.userId).then((user) => {
        if (user) {
          socket.join(`role_${user.role}`);
        }
      });
      socket.join(`user_${socket.userId}`);

      socket.on('disconnect', () => {
        console.log(`User ${socket.userId} disconnected`);
      });
    });
  }

  async notifyUser(userId, notification) {
    const record = await Notification.create({
      userId,
      type: notification.type,
      title: notification.title,
      content: notification.content,
    });
    if (this.io) {
      this.io.to(`user_${userId}`).emit('notification', record);
    }
    return record;
  }

  async notifyUsers(userIds, notification) {
    const results = [];
    for (const userId of userIds) {
      const result = await this.notifyUser(userId, notification);
      results.push(result);
    }
    return results;
  }

  async notifyRole(role, notification) {
    const users = await User.findAll({ where: { role } });
    const records = await Notification.bulkCreate(
      users.map((user) => ({
        userId: user.id,
        type: notification.type,
        title: notification.title,
        content: notification.content,
      }))
    );
    if (this.io) {
      this.io.to(`role_${role}`).emit('notification', notification);
    }
    return records;
  }

  notifyAdmins(notification) {
    return this.notifyRole('admin', notification);
  }

  notifySellers(notification) {
    return this.notifyRole('seller', notification);
  }

  async getNotifications(userId, query = {}) {
    const { page = 1, pageSize = 10, isRead, type } = query;
    const where = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead;
    }
    if (type) {
      where.type = type;
    }
    const offset = (page - 1) * pageSize;
    const { count, rows } = await Notification.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['createdAt', 'DESC']],
    });
    return {
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
      notifications: rows,
    };
  }

  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOne({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      return null;
    }
    notification.isRead = true;
    await notification.save();
    return notification;
  }

  async markAllAsRead(userId) {
    const [updatedCount] = await Notification.update(
      { isRead: true },
      { where: { userId, isRead: false } }
    );
    return updatedCount;
  }

  async getUnreadCount(userId) {
    const count = await Notification.count({
      where: { userId, isRead: false },
    });
    return count;
  }
}

module.exports = new NotificationService();
