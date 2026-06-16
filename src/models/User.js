module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes.ENUM('admin', 'seller', 'member'),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING
    },
    phone: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'Users'
  });

  User.associate = (models) => {
    User.hasMany(models.Order, { foreignKey: 'userId' });
    User.hasMany(models.SeatLock, { foreignKey: 'userId' });
    User.hasOne(models.Member, { foreignKey: 'userId' });
    User.hasMany(models.Notification, { foreignKey: 'userId' });
    User.hasMany(models.RestockRequest, { foreignKey: 'requestedBy', as: 'RequestedRestocks' });
    User.hasMany(models.RestockRequest, { foreignKey: 'approvedBy', as: 'ApprovedRestocks' });
    User.hasMany(models.DailyReport, { foreignKey: 'createdBy' });
  };

  return User;
};
