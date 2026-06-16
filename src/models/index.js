const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const User = require('./User')(sequelize, Sequelize.DataTypes);
const Cinema = require('./Cinema')(sequelize, Sequelize.DataTypes);
const Hall = require('./Hall')(sequelize, Sequelize.DataTypes);
const Movie = require('./Movie')(sequelize, Sequelize.DataTypes);
const Schedule = require('./Schedule')(sequelize, Sequelize.DataTypes);
const Seat = require('./Seat')(sequelize, Sequelize.DataTypes);
const SeatLock = require('./SeatLock')(sequelize, Sequelize.DataTypes);
const Order = require('./Order')(sequelize, Sequelize.DataTypes);
const OrderItem = require('./OrderItem')(sequelize, Sequelize.DataTypes);
const Concession = require('./Concession')(sequelize, Sequelize.DataTypes);
const RestockRequest = require('./RestockRequest')(sequelize, Sequelize.DataTypes);
const Member = require('./Member')(sequelize, Sequelize.DataTypes);
const PointsRecord = require('./PointsRecord')(sequelize, Sequelize.DataTypes);
const Notification = require('./Notification')(sequelize, Sequelize.DataTypes);
const DailyReport = require('./DailyReport')(sequelize, Sequelize.DataTypes);

const models = {
  User,
  Cinema,
  Hall,
  Movie,
  Schedule,
  Seat,
  SeatLock,
  Order,
  OrderItem,
  Concession,
  RestockRequest,
  Member,
  PointsRecord,
  Notification,
  DailyReport
};

Object.keys(models).forEach((modelName) => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

module.exports = {
  sequelize,
  Sequelize,
  ...models
};
