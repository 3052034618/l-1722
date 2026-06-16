function pad(n) {
  return String(n).padStart(2, '0');
}

module.exports = {
  paginate(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const limit = pageSize;
    return { offset, limit };
  },

  formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  formatDateTime(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  },

  generateOrderNo() {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD${ts}${rand}`;
  },

  successResponse(data, message) {
    return {
      code: 200,
      message: message || '操作成功',
      data
    };
  },

  errorResponse(code, message, errors) {
    return {
      code,
      message,
      errors
    };
  }
};
