module.exports = {
  port: process.env.PORT || 3000,
  jwt: {
    secret: process.env.JWT_SECRET || 'smart-cinema-jwt-secret-2024',
    expiresIn: '24h'
  },
  seat: {
    lockDurationMinutes: 15
  },
  inventory: {
    safetyRatio: 0.2
  },
  report: {
    cronTime: '0 0 * * *'
  }
};
