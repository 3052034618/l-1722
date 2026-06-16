module.exports = (sequelize, DataTypes) => {
  const DailyReport = sequelize.define('DailyReport', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cinemaId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    reportDate: {
      type: DataTypes.DATEONLY
    },
    hallAttendance: {
      type: DataTypes.FLOAT
    },
    totalTickets: {
      type: DataTypes.INTEGER
    },
    totalRevenue: {
      type: DataTypes.FLOAT
    },
    boxRevenue: {
      type: DataTypes.FLOAT
    },
    concessionSales: {
      type: DataTypes.FLOAT
    },
    concessionQuantity: {
      type: DataTypes.INTEGER
    },
    newMembers: {
      type: DataTypes.INTEGER
    },
    totalMembers: {
      type: DataTypes.INTEGER
    },
    createdBy: {
      type: DataTypes.INTEGER
    }
  }, {
    tableName: 'DailyReports'
  });

  DailyReport.associate = (models) => {
    DailyReport.belongsTo(models.Cinema, { foreignKey: 'cinemaId' });
    DailyReport.belongsTo(models.User, { foreignKey: 'createdBy' });
  };

  return DailyReport;
};
