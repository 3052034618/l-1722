module.exports = (sequelize, DataTypes) => {
  const PointsRecord = sequelize.define('PointsRecord', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    memberId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('earn', 'redeem', 'expire')
    },
    points: {
      type: DataTypes.INTEGER
    },
    balance: {
      type: DataTypes.INTEGER
    },
    source: {
      type: DataTypes.STRING
    },
    referenceId: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 'PointsRecords'
  });

  PointsRecord.associate = (models) => {
    PointsRecord.belongsTo(models.Member, { foreignKey: 'memberId' });
  };

  return PointsRecord;
};
