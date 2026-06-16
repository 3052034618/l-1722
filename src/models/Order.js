module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define('Order', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    scheduleId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.FLOAT
    },
    discountAmount: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    payAmount: {
      type: DataTypes.FLOAT
    },
    pointsUsed: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    pointsEarned: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid', 'cancelled', 'refunded')
    },
    payTime: {
      type: DataTypes.DATE
    },
    expireAt: {
      type: DataTypes.DATE
    },
    supplementAmount: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    supplementStatus: {
      type: DataTypes.ENUM('none', 'pending', 'paid'),
      defaultValue: 'none'
    }
  }, {
    tableName: 'Orders'
  });

  Order.associate = (models) => {
    Order.belongsTo(models.User, { foreignKey: 'userId' });
    Order.belongsTo(models.Schedule, { foreignKey: 'scheduleId' });
    Order.hasMany(models.OrderItem, { foreignKey: 'orderId' });
  };

  return Order;
};
