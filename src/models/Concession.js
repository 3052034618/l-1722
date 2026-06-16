module.exports = (sequelize, DataTypes) => {
  const Concession = sequelize.define('Concession', {
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
    category: {
      type: DataTypes.STRING
    },
    price: {
      type: DataTypes.FLOAT
    },
    stock: {
      type: DataTypes.INTEGER
    },
    safetyStock: {
      type: DataTypes.INTEGER
    },
    status: {
      type: DataTypes.ENUM('on_sale', 'off_sale')
    }
  }, {
    tableName: 'Concessions'
  });

  Concession.associate = (models) => {
    Concession.belongsTo(models.Cinema, { foreignKey: 'cinemaId' });
    Concession.hasMany(models.RestockRequest, { foreignKey: 'concessionId' });
  };

  return Concession;
};
