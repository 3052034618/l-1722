module.exports = (sequelize, DataTypes) => {
  const Member = sequelize.define('Member', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    level: {
      type: DataTypes.ENUM('normal', 'silver', 'gold', 'platinum')
    },
    points: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalSpent: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    discountRate: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0
    }
  }, {
    tableName: 'Members'
  });

  Member.associate = (models) => {
    Member.belongsTo(models.User, { foreignKey: 'userId' });
    Member.hasMany(models.PointsRecord, { foreignKey: 'memberId' });
  };

  return Member;
};
