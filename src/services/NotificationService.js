const jwt = require('jsonwebtoken');
const config = require('../config/index');
const { Notification, User } = require('../models');

class NotificationService {
  initialize(io) {
    this.io = io;

    io.use((socket, next) => {
      try {
        let token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token && socket.handshake.headers && socket.handshake.headers.authorization) {
          token = socket.handshake.headers.authorization.replace('Bearer ', '');
        }
        if (!token) {
          return next(new Error('Authentication required'));
        }

        let userId;
        let role;
        try {
          const decoded = jwt.verify(token, config.jwt.secret);
          userId = decoded.userId;
          role = decoded.role;
        } catch (e) {
          if (!isNaN(parseInt(token, 10))) {
            userId = parseInt(token, 10);
          } else {
            return next(new Error('Invalid token'));
          }
        }

        socket.userId = userId;
        socket.userRole = role;
        next();
      } catch (err) {
        next(err);
      }
    });

    io.on('connection', async (socket) => {
      try {
        let userRole = socket.userRole;
        if (!userRole && socket.userId) {
          const user = await User.findByPk(socket.userId);
          if (user) {
            userRole = user.role;
            socket.userRole = userRole;
          }
        }
        if (userRole) {
          socket.join(`role_${userRole}`);
        }
        socket.join(`user_${socket.userId}`);
        console.log(`User ${socket.userId} (${userRole || 'unknown'}) connected via socket`);
      } catch (e) {
        console.error('Socket connection error:', e);
      }

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
      try {
        const result = await this.notifyUser(userId, notification);
        results.push(result);
      } catch (e) {
        console.error(`Failed to notify user ${userId}:`, e);
      }
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

  async notifyAdmins(notification) {
    return this.notifyRole('admin', notification);
  }

  async notifySellers(notification) {
    return this.notifyRole('seller', notification);
  }

  async notifyAllStaff(notification) {
    const [admins, sellers] = await Promise.all([
      this.notifyAdmins(notification),
      this.notifySellers(notification)
    ]);
    return [...admins, ...sellers];
  }

  async notifyMembers(notification) {
    return this.notifyRole('member', notification);
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
