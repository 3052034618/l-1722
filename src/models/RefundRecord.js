module.exports = (sequelize, DataTypes) => {
  const RefundRecord = sequelize.define('RefundRecord', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    orderId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('refund', 'reschedule'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'completed'),
      defaultValue: 'pending'
    },
    reason: {
      type: DataTypes.STRING
    },
    newScheduleId: {
      type: DataTypes.INTEGER
    },
    newSeatIds: {
      type: DataTypes.STRING
    },
    refundAmount: {
      type: DataTypes.FLOAT
    },
    processedBy: {
      type: DataTypes.INTEGER
    },
    processedAt: {
      type: DataTypes.DATE
    }
  }, {
    tableName: 'RefundRecords'
  });

  RefundRecord.associate = (models) => {
    RefundRecord.belongsTo(models.Order, { foreignKey: 'orderId' });
    RefundRecord.belongsTo(models.User, { foreignKey: 'userId' });
    RefundRecord.belongsTo(models.Schedule, { foreignKey: 'newScheduleId', as: 'NewSchedule' });
  };

  return RefundRecord;
};
