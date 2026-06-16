const http = require('http');

function req(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const d = data ? JSON.stringify(data) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = d.length;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({
      hostname: 'localhost', port: 3000, path, method, headers
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, raw: body }); }
      });
    });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

let pass = 0, fail = 0;
const assert = (name, cond, info) => {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} ${info || ''}`); }
};

const SCHEDULE_DATE = '2027-06-16';

async function runTests() {
  console.log('=== 登录 ===');
  const login1 = await req('/api/auth/login', 'POST', { username: 'member1', password: '123456' });
  const login2 = await req('/api/auth/login', 'POST', { username: 'member2', password: '123456' });
  const admin = await req('/api/auth/login', 'POST', { username: 'admin', password: '123456' });
  assert('member1登录', login1.status === 200);
  assert('member2登录', login2.status === 200);
  assert('admin登录', admin.status === 200);
  const u1 = login1.body.data.user.id, u2 = login2.body.data.user.id;
  const tAdmin = admin.body.data.token;

  console.log('\n=== 创建场次 ===');
  const sA = await req('/api/schedules', 'POST', {
    movieId: 1, hallId: 1, cinemaId: 1,
    startTime: `${SCHEDULE_DATE}T10:00:00`, price: 50
  }, tAdmin);
  const sB = await req('/api/schedules', 'POST', {
    movieId: 2, hallId: 2, cinemaId: 1,
    startTime: `${SCHEDULE_DATE}T10:00:00`, price: 55
  }, tAdmin);
  assert('场次A(IMAX厅)', sA.status === 201, sA.body?.message);
  assert('场次B(3D厅)', sB.status === 201, sB.body?.message);
  const sAId = sA.body?.data?.id, sBId = sB.body?.data?.id;

  if (!sAId || !sBId) {
    console.log('❌ 场次创建失败，终止测试');
    process.exit(1);
  }

  const seatsA = await req(`/api/seats/available/${sAId}`, 'GET');
  const availA = seatsA.body.data.filter(s => s.status === 'available').map(s => s.id);
  const seatsB = await req(`/api/seats/available/${sBId}`, 'GET');
  const availB = seatsB.body.data.filter(s => s.status === 'available').map(s => s.id);
  console.log(`  A厅可用座: ${availA.length}, B厅可用座: ${availB.length}`);

  console.log('\n============ 需求1：锁座会话严格校验 ============');
  const lock3 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(0, 3), userId: u1 });
  assert('锁3座成功', lock3.status === 201);

  const lessOrder = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(0, 2) });
  assert('少交座位→400', lessOrder.status === 400);
  assert('提示锁定数量不匹配', (lessOrder.body?.message || '').includes('锁定'));

  const moreOrder = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(0, 4) });
  assert('多交座位→400', moreOrder.status === 400);

  const mixedSchedule = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: [...availA.slice(0, 2), availB[0]] });
  assert('混入其他场次座位→400', mixedSchedule.status === 400);
  assert('提示座位未锁定', (mixedSchedule.body?.message || '').includes('未被您锁定'));

  const lockOther = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: [availA[5]], userId: u2 });
  assert('member2锁1座', lockOther.status === 201);
  const mixedUser = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: [...availA.slice(0, 3), availA[5]] });
  assert('混入别人座位→400', mixedUser.status === 400);

  const order1 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(0, 3) });
  assert('正常锁3交3→201', order1.status === 201, order1.body?.message);
  const o1Id = order1.body?.data?.id;

  const pendingCheck = await req(`/api/orders?userId=${u1}&status=pending`, 'GET');
  const pendingFromFailed = (pendingCheck.body?.data || []).filter(o => o.scheduleId === sAId && o.id !== o1Id);
  assert('失败下单不留待支付订单', pendingFromFailed.length === 0);

  const pay1 = await req(`/api/orders/${o1Id}/pay`, 'PUT');
  assert('支付成功', pay1.status === 200);

  console.log('\n============ 需求2：订单超时自动取消 ============');
  const { SeatLock: SeatLockModel } = require('./src/models');
  await SeatLockModel.update({ status: 'released' }, { where: { scheduleId: sAId, userId: u2, status: 'locked' } });

  const lock4 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(3, 5), userId: u2 });
  assert('member2锁2座', lock4.status === 201);
  const order2 = await req('/api/orders', 'POST', { userId: u2, scheduleId: sAId, seatIds: availA.slice(3, 5) });
  assert('member2下单成功', order2.status === 201, order2.body?.message);
  const o2Id = order2.body?.data?.id;
  assert('订单有expireAt', order2.body?.data?.expireAt != null);

  const { Order } = require('./src/models');
  await Order.update({ expireAt: new Date(Date.now() - 60000) }, { where: { id: o2Id } });
  const OrderService = require('./src/services/OrderService');
  const cancelCount = await OrderService.cancelExpiredOrders();
  assert('超时自动取消1个', cancelCount === 1, `实际：${cancelCount}`);

  const checkOrder = await Order.findByPk(o2Id);
  assert('订单状态→cancelled', checkOrder.status === 'cancelled');

  const seatsA2 = await req(`/api/seats/available/${sAId}`, 'GET');
  const availA2 = seatsA2.body.data.filter(s => s.status === 'available').length;
  assert('座位图同步释放', availA2 === 77, `实际：${availA2}`);

  const notifM2 = await req(`/api/notifications?userId=${u2}&type=order_timeout_cancelled`, 'GET');
  assert('会员收到超时取消通知', notifM2.body?.data?.total > 0);

  console.log('\n============ 需求3：运营报表多维筛选 ============');
  const lock5 = await req('/api/seats/lock', 'POST', { scheduleId: sBId, seatIds: availB.slice(0, 2), userId: u1 });
  const order3 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sBId, seatIds: availB.slice(0, 2) });
  const pay3 = await req(`/api/orders/${order3.body?.data?.id}/pay`, 'PUT');
  assert('B场次订单支付', pay3.status === 200);

  const summary = await req(`/api/reports/summary?cinemaId=1&startDate=${SCHEDULE_DATE}&endDate=${SCHEDULE_DATE}`, 'GET');
  assert('汇总接口200', summary.status === 200);
  assert('总票数=5', summary.body?.data?.totalTickets === 5, `实际：${summary.body?.data?.totalTickets}`);
  assert('场次数=2', summary.body?.data?.totalSchedules === 2, `实际：${summary.body?.data?.totalSchedules}`);

  const summaryMovie = await req(`/api/reports/summary?cinemaId=1&movieId=1&startDate=${SCHEDULE_DATE}`, 'GET');
  assert('按影片筛选票数=3', summaryMovie.body?.data?.totalTickets === 3, `实际：${summaryMovie.body?.data?.totalTickets}`);

  const summaryHall = await req(`/api/reports/hall-summary?cinemaId=1&startDate=${SCHEDULE_DATE}`, 'GET');
  assert('影厅汇总200', summaryHall.status === 200);
  assert('影厅汇总有数据', summaryHall.body?.data?.length > 0);

  const detail = await req(`/api/reports/schedule-detail?cinemaId=1&startDate=${SCHEDULE_DATE}`, 'GET');
  assert('场次明细200', detail.status === 200);
  assert('场次明细2条', detail.body?.data?.length === 2, `实际：${detail.body?.data?.length}`);

  const movieSummary = await req(`/api/reports/movie-summary?cinemaId=1&startDate=${SCHEDULE_DATE}`, 'GET');
  assert('影片汇总200', movieSummary.status === 200);

  const exportResp = await req(`/api/reports/export?cinemaId=1&startDate=${SCHEDULE_DATE}&endDate=${SCHEDULE_DATE}&format=json`, 'GET', null, tAdmin);
  assert('Excel导出200', exportResp.status === 200);
  assert('Excel有filePath', exportResp.body?.data?.filePath != null);

  console.log('\n============ 需求4：补货审批流 ============');
  const lock6 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(5, 7), userId: u1 });
  const order4 = await req('/api/orders', 'POST', {
    userId: u1, scheduleId: sAId, seatIds: availA.slice(5, 7),
    concessionItems: [{ concessionId: 5, quantity: 55 }]
  });
  const pay4 = await req(`/api/orders/${order4.body?.data?.id}/pay`, 'PUT');
  assert('大量卖品订单支付', pay4.status === 200);

  const restockList = await req('/api/concessions/restock-requests?status=pending', 'GET');
  assert('有pending补货申请', restockList.body?.data?.length > 0, `数量：${restockList.body?.data?.length}`);
  const reqId = restockList.body?.data?.[0]?.id;

  if (reqId) {
    const approve = await req(`/api/concessions/restock-requests/${reqId}/approve`, 'PUT', { approvedBy: 1 }, tAdmin);
    assert('审批通过', approve.status === 200, approve.body?.message);
    assert('状态=approved', approve.body?.data?.status === 'approved');

    const startPurch = await req(`/api/concessions/restock-requests/${reqId}/start-purchase`, 'PUT', { purchasedBy: 2 }, tAdmin);
    assert('采购开始', startPurch.status === 200, startPurch.body?.message);
    assert('状态=purchasing', startPurch.body?.data?.status === 'purchasing');

    const completePurch = await req(`/api/concessions/restock-requests/${reqId}/purchase`, 'PUT', { quantity: 20 }, tAdmin);
    assert('采购完成', completePurch.status === 200, completePurch.body?.message);
    assert('状态=purchased', completePurch.body?.data?.status === 'purchased');
    assert('有purchasedAt', completePurch.body?.data?.purchasedAt != null);

    const notifPurch = await req(`/api/notifications?userId=2&type=restock_purchasing`, 'GET');
    assert('采购中通知', notifPurch.body?.data?.total > 0);
  } else {
    console.log('  ⚠ 跳过审批流测试（无pending补货申请）');
  }

  console.log('\n============ 需求5：通知中心筛选 ============');
  const unreadNotifs = await req(`/api/notifications?userId=${u1}&isRead=false`, 'GET');
  assert('未读通知200', unreadNotifs.status === 200);

  const typeNotifs = await req(`/api/notifications?userId=${u1}&type=order_paid`, 'GET');
  assert('按类型筛选200', typeNotifs.status === 200);
  const allPaid = (typeNotifs.body?.data?.notifications || []).every(n => n.type === 'order_paid');
  assert('全部order_paid类型', allPaid);

  const timeNotifs = await req(`/api/notifications?userId=${u1}&startDate=${SCHEDULE_DATE}&endDate=${SCHEDULE_DATE}`, 'GET');
  assert('按时间筛选200', timeNotifs.status === 200);

  const adminOverview = await req('/api/notifications/admin-overview', 'GET', null, tAdmin);
  assert('管理员概览200', adminOverview.status === 200);
  assert('管理员totalUnread', adminOverview.body?.data?.totalUnread !== undefined);
  assert('管理员有通知', adminOverview.body?.data?.total > 0);

  const memberNotifs = await req(`/api/notifications/member/${u1}`, 'GET');
  assert('会员通知200', memberNotifs.status === 200);
  assert('会员totalUnread', memberNotifs.body?.data?.totalUnread !== undefined);
  const memberTypes = (memberNotifs.body?.data?.notifications || []).map(n => n.type);
  const memberAllowed = [
    'order_created','order_paid','order_cancelled','order_timeout_cancelled',
    'seat_lock_expired','schedule_updated','schedule_cancelled',
    'restock_approved','restock_rejected','restock_completed',
    'points_earned','points_redeemed'
  ];
  const hasOnlyMemberTypes = memberTypes.every(t => memberAllowed.includes(t));
  assert('会员通知类型受限', hasOnlyMemberTypes || memberTypes.length === 0, `类型：${memberTypes.join(',')}`);

  console.log(`\n==============================`);
  console.log(`测试完成：通过 ${pass} / ${pass + fail}`);
  if (fail === 0) console.log('🎉 所有测试通过！');
  process.exit(fail === 0 ? 0 : 1);
}

setTimeout(() => {
  runTests().catch(e => { console.error('测试异常:', e); process.exit(1); });
}, 2000);
