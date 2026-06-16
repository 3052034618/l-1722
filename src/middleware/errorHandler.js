function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      code: 400,
      message: '数据验证失败',
      errors: err.errors.map(e => e.message)
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      code: 409,
      message: '数据重复冲突'
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      code: 401,
      message: '令牌验证失败'
    });
  }

  return res.status(500).json({
    code: 500,
    message: '服务器内部错误'
  });
}

module.exports = errorHandler;
