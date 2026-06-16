module.exports = (sequelize, DataTypes) => {
  const Seat = sequelize.define('Seat', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    hallId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    row: {
      type: DataTypes.INTEGER
    },
    col: {
      type: DataTypes.INTEGER
    },
    seatNo: {
      type: DataTypes.STRING
    },
    status: {
      type: DataTypes.ENUM('available', 'locked', 'sold', 'maintenance')
    }
  }, {
    tableName: 'Seats'
  });

  Seat.associate = (models) => {
    Seat.belongsTo(models.Hall, { foreignKey: 'hallId' });
    Seat.hasMany(models.SeatLock, { foreignKey: 'seatId' });
  };

  return Seat;
};
