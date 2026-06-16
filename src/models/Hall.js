module.exports = (sequelize, DataTypes) => {
  const Hall = sequelize.define('Hall', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cinemaId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING
    },
    capacity: {
      type: DataTypes.INTEGER
    },
    type: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'Halls'
  });

  Hall.associate = (models) => {
    Hall.belongsTo(models.Cinema, { foreignKey: 'cinemaId' });
    Hall.hasMany(models.Seat, { foreignKey: 'hallId' });
    Hall.hasMany(models.Schedule, { foreignKey: 'hallId' });
  };

  return Hall;
};
