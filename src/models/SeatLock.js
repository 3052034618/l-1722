module.exports = (sequelize, DataTypes) => {
  const SeatLock = sequelize.define('SeatLock', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    scheduleId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    seatId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    lockedAt: {
      type: DataTypes.DATE
    },
    expireAt: {
      type: DataTypes.DATE
    },
    status: {
      type: DataTypes.ENUM('locked', 'released', 'paid')
    }
  }, {
    tableName: 'SeatLocks'
  });

  SeatLock.associate = (models) => {
    SeatLock.belongsTo(models.Schedule, { foreignKey: 'scheduleId' });
    SeatLock.belongsTo(models.Seat, { foreignKey: 'seatId' });
    SeatLock.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return SeatLock;
};
