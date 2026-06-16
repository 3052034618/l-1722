module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define('OrderItem', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    orderId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    itemType: {
      type: DataTypes.ENUM('ticket', 'concession')
    },
    itemId: {
      type: DataTypes.INTEGER
    },
    quantity: {
      type: DataTypes.INTEGER
    },
    unitPrice: {
      type: DataTypes.FLOAT
    },
    totalPrice: {
      type: DataTypes.FLOAT
    }
  }, {
    tableName: 'OrderItems'
  });

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order, { foreignKey: 'orderId' });
  };

  return OrderItem;
};
