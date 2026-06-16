const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const sequelize = require('./config/database');
require('./models');
const routes = require('./routes');
const NotificationService = require('./services/NotificationService');
const errorHandler = require('./middleware/errorHandler');
const { startCronJobs } = require('./tasks/cron');
const config = require('./config/index');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);
app.use(errorHandler);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

NotificationService.initialize(io);

sequelize.sync().then(() => {
  server.listen(config.port, () => {
    startCronJobs();
    console.log(`智慧影院综合管理系统已启动，端口：${config.port}`);
  });
});
