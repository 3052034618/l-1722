module.exports = (sequelize, DataTypes) => {
  const Schedule = sequelize.define('Schedule', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    movieId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    hallId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    cinemaId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    startTime: {
      type: DataTypes.DATE
    },
    endTime: {
      type: DataTypes.DATE
    },
    price: {
      type: DataTypes.FLOAT
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'showing', 'completed', 'cancelled')
    },
    locked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    lockedBy: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'Schedules'
  });

  Schedule.associate = (models) => {
    Schedule.belongsTo(models.Movie, { foreignKey: 'movieId' });
    Schedule.belongsTo(models.Hall, { foreignKey: 'hallId' });
    Schedule.belongsTo(models.Cinema, { foreignKey: 'cinemaId' });
    Schedule.hasMany(models.SeatLock, { foreignKey: 'scheduleId' });
    Schedule.hasMany(models.Order, { foreignKey: 'scheduleId' });
  };

  return Schedule;
};
