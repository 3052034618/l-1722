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
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'completed', 'supplement_pending'),
      defaultValue: 'pending'
    },
    action: {
      type: DataTypes.ENUM('refund', 'supplement', 'reject'),
      allowNull: true
    },
    reason: {
      type: DataTypes.STRING
    },
    originalScheduleId: {
      type: DataTypes.INTEGER
    },
    originalSeatIds: {
      type: DataTypes.STRING
    },
    newScheduleId: {
      type: DataTypes.INTEGER
    },
    newSeatIds: {
      type: DataTypes.STRING
    },
    refundAmount: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    supplementAmount: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    supplementStatus: {
      type: DataTypes.ENUM('none', 'pending', 'paid'),
      defaultValue: 'none'
    },
    pointsReturned: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    processedBy: {
      type: DataTypes.INTEGER
    },
    processedAt: {
      type: DataTypes.DATE
    },
    processedReason: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'RefundRecords'
  });

  RefundRecord.associate = (models) => {
    RefundRecord.belongsTo(models.Order, { foreignKey: 'orderId' });
    RefundRecord.belongsTo(models.User, { foreignKey: 'userId' });
    RefundRecord.belongsTo(models.Schedule, { foreignKey: 'originalScheduleId', as: 'OriginalSchedule' });
    RefundRecord.belongsTo(models.Schedule, { foreignKey: 'newScheduleId', as: 'NewSchedule' });
    RefundRecord.belongsTo(models.User, { foreignKey: 'processedBy', as: 'Processor' });
  };

  return RefundRecord;
};
