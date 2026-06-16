const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Member } = require('../models');
const config = require('../config/index');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ code: 401, message: '未提供认证令牌', data: null });
    }
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({ code: 401, message: '用户不存在', data: null });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '令牌无效或已过期', data: null });
  }
};

router.post('/register', async (req, res) => {
  try {
    const { username, password, role, name, phone } = req.body;
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ code: 400, message: '用户名已存在', data: null });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      role,
      name,
      phone
    });
    if (role === 'member') {
      await Member.create({ userId: user.id, level: 'normal', points: 0, totalSpent: 0, discountRate: 1.0 });
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    res.status(201).json({
      code: 201,
      message: '注册成功',
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, name: user.name, phone: user.phone }
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误', data: null });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误', data: null });
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, name: user.name, phone: user.phone }
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    res.json({
      code: 200,
      message: '获取成功',
      data: { id: user.id, username: user.username, role: user.role, name: user.name, phone: user.phone }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
