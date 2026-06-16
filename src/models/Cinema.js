module.exports = (sequelize, DataTypes) => {
  const Cinema = sequelize.define('Cinema', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING
    },
    address: {
      type: DataTypes.STRING
    },
    phone: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'Cinemas'
  });

  Cinema.associate = (models) => {
    Cinema.hasMany(models.Hall, { foreignKey: 'cinemaId' });
    Cinema.hasMany(models.Schedule, { foreignKey: 'cinemaId' });
    Cinema.hasMany(models.Concession, { foreignKey: 'cinemaId' });
    Cinema.hasMany(models.DailyReport, { foreignKey: 'cinemaId' });
  };

  return Cinema;
};
