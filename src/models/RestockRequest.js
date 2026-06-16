module.exports = (sequelize, DataTypes) => {
  const RestockRequest = sequelize.define('RestockRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    concessionId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    requestedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    quantity: {
      type: DataTypes.INTEGER
    },
    reason: {
      type: DataTypes.STRING
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'purchasing', 'purchased', 'rejected')
    },
    approvedBy: {
      type: DataTypes.INTEGER
    },
    approvedAt: {
      type: DataTypes.DATE
    },
    purchasedBy: {
      type: DataTypes.INTEGER
    },
    purchasedAt: {
      type: DataTypes.DATE
    },
    purchasedQuantity: {
      type: DataTypes.INTEGER
    }
  }, {
    tableName: 'RestockRequests'
  });

  RestockRequest.associate = (models) => {
    RestockRequest.belongsTo(models.Concession, { foreignKey: 'concessionId' });
    RestockRequest.belongsTo(models.User, { foreignKey: 'requestedBy', as: 'Requester' });
    RestockRequest.belongsTo(models.User, { foreignKey: 'approvedBy', as: 'Approver' });
    RestockRequest.belongsTo(models.User, { foreignKey: 'purchasedBy', as: 'Purchaser' });
  };

  return RestockRequest;
};
