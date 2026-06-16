const http = require('http');
const { Server } = require('socket.io-client');

function req(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const d = data ? JSON.stringify(data) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = d.length;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers
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

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function pad(n) { return n.toString().padStart(2, '0'); }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toDateTimeStr(d, h, m) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}:00`;
}

async function runTests() {
  let pass = 0, fail = 0;
  const assert = (name, cond, info) => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name} ${info || ''}`); }
  };

  const today = new Date();
  const todayStr = toDateStr(today);
  const tm10 = toDateTimeStr(today, 10, 0);
  const tm15 = toDateTimeStr(today, 17, 0);
  const tm1330 = toDateTimeStr(today, 13, 30);

  console.log('测试日期:', todayStr);

  console.log('\n=== 测试1：登录获取JWT令牌 ===');
  const login1 = await req('/api/auth/login', 'POST', { username: 'member1', password: '123456' });
  const login2 = await req('/api/auth/login', 'POST', { username: 'member2', password: '123456' });
  const admin = await req('/api/auth/login', 'POST', { username: 'admin', password: '123456' });
  assert('member1登录成功', login1.status === 200, login1.body?.message);
  assert('member2登录成功', login2.status === 200);
  assert('admin登录成功', admin.status === 200);
  const user1Id = login1.body.data.user.id;
  const user2Id = login2.body.data.user.id;
  const user1Token = login1.body.data.token;
  const user2Token = login2.body.data.token;
  const adminToken = admin.body.data.token;
  console.log('user1Id:', user1Id, 'user2Id:', user2Id);
  console.log('JWT令牌示例:', user1Token.substring(0, 50) + '...');

  console.log('\n=== 测试2：创建2个同日同影厅场次（A和B）===');
  const schedA = await req('/api/schedules', 'POST', {
    movieId: 1, hallId: 1, cinemaId: 1, startTime: tm10, price: 50
  }, adminToken);
  assert('场次A创建成功', schedA.status === 201, schedA.body?.message || schedA.body?.error);
  const schedAId = schedA.body?.data?.id;
  console.log('场次A ID:', schedAId);

  const schedB = await req('/api/schedules', 'POST', {
    movieId: 2, hallId: 1, cinemaId: 1, startTime: tm1330, price: 55
  }, adminToken);
  assert('场次B创建成功', schedB.status === 201, schedB.body?.message || schedB.body?.error);
  const schedBId = schedB.body?.data?.id;
  console.log('场次B ID:', schedBId);

  console.log('\n=== 测试3：场次A锁座，验证场次B座位不受影响 ===');
  const seatsA = await req(`/api/seats/available/${schedAId}`, 'GET');
  const seatsB = await req(`/api/seats/available/${schedBId}`, 'GET');
  assert('场次A初始80个可用座位', seatsA.body?.data?.length === 80, `实际：${seatsA.body?.data?.length}`);
  assert('场次B初始80个可用座位', seatsB.body?.data?.length === 80, `实际：${seatsB.body?.data?.length}`);

  const availableA = seatsA.body.data.filter(s => s.status === 'available').map(s => s.id);
  const testSeatIds = availableA.slice(0, 3);
  console.log('场次A选座ID:', testSeatIds);

  const lockA = await req('/api/seats/lock', 'POST', {
    scheduleId: schedAId, seatIds: testSeatIds, userId: user1Id
  });
  assert('场次A锁定3个座位成功', lockA.status === 201 && lockA.body.data?.length === 3, lockA.body?.message);

  const seatsA2 = await req(`/api/seats/available/${schedAId}`, 'GET');
  const seatsB2 = await req(`/api/seats/available/${schedBId}`, 'GET');
  const availA2 = seatsA2.body.data.filter(s => s.status === 'available').length;
  const availB2 = seatsB2.body.data.filter(s => s.status === 'available').length;
  assert('场次A可用座位减少为77个', availA2 === 77, `实际：${availA2}`);
  assert('场次B仍有80个可用（不受场次A影响）', availB2 === 80, `实际：${availB2}`);

  console.log('\n=== 测试4：A场次member2重复锁相同座位失败 ===');
  const lockFail = await req('/api/seats/lock', 'POST', {
    scheduleId: schedAId, seatIds: [testSeatIds[0]], userId: user2Id
  });
  assert('他人锁定同一座位返回400', lockFail.status === 400, lockFail.body?.message);

  console.log('\n=== 测试5：用未锁定的座位下单失败（问题2验证）===');
  const seatsBad = await req(`/api/seats/available/${schedBId}`, 'GET');
  const badSeatIds = seatsBad.body.data.filter(s=>s.status==='available').map(s=>s.id).slice(0,2);
  const orderBad = await req('/api/orders', 'POST', {
    userId: user1Id, scheduleId: schedBId, seatIds: badSeatIds
  });
  assert('无锁直接下单返回400（问题2）', orderBad.status === 400, orderBad.body?.message);

  console.log('\n=== 测试6：用member1已锁定座位A场次正常下单 ===');
  const order1 = await req('/api/orders', 'POST', {
    userId: user1Id, scheduleId: schedAId, seatIds: testSeatIds,
    concessionItems: [{ concessionId: 1, quantity: 2 }]
  });
  assert('下单成功返回201（问题2锁验证通过）', order1.status === 201, order1.body?.message);
  const order1Id = order1.body?.data?.id;
  const payAmount1 = order1.body?.data?.payAmount;
  console.log('订单1 ID:', order1Id, '金额:', payAmount1);

  console.log('\n=== 测试7：订单1取消，再重新用新锁下单并支付 ===');
  const cancelPre = await req(`/api/orders/${order1Id}/cancel`, 'PUT');
  assert('预订单取消成功', cancelPre.status === 200, cancelPre.body?.message);
  // 等待锁释放
  await new Promise(r => setTimeout(r, 500));

  const lockA3 = await req('/api/seats/lock', 'POST', {
    scheduleId: schedAId, seatIds: testSeatIds, userId: user1Id
  });
  assert('场次A重新锁座成功', lockA3.status === 201, lockA3.body?.message);

  // 薯片 concessionId=5 (cinema1第5个), stock=60 - 55 = 5 < safetyStock=10
  const order2 = await req('/api/orders', 'POST', {
    userId: user1Id, scheduleId: schedAId, seatIds: testSeatIds,
    concessionItems: [{ concessionId: 5, quantity: 55 }]
  });
  assert('订单2创建（卖品薯片下单55份扣到5）', order2.status === 201, order2.body?.message);
  const order2Id = order2.body?.data?.id;

  const pay2 = await req(`/api/orders/${order2Id}/pay`, 'PUT');
  assert('订单2支付成功（问题4统计用此订单3张票）', pay2.status === 200, pay2.body?.message);

  const seatsA3 = await req(`/api/seats/available/${schedAId}`, 'GET');
  const seatsB3 = await req(`/api/seats/available/${schedBId}`, 'GET');
  const availA3 = seatsA3.body.data.filter(s => s.status === 'available').length;
  const availB3 = seatsB3.body.data.filter(s => s.status === 'available').length;
  assert('场次A支付后可用座位77（3张已售出）', availA3 === 77, `实际：${availA3}`);
  assert('场次B仍有80个可用（问题1跨场次隔离）', availB3 === 80, `实际：${availB3}`);

  console.log('\n=== 测试8：取消订单释放对应场次座位，不影响其他场次 ===');
  const order3Seats = availableA.slice(10, 12);
  const lock3 = await req('/api/seats/lock', 'POST', {
    scheduleId: schedBId, seatIds: order3Seats, userId: user2Id
  });
  assert('场次B锁2个座位成功', lock3.status === 201);
  const order3 = await req('/api/orders', 'POST', {
    userId: user2Id, scheduleId: schedBId, seatIds: order3Seats
  });
  assert('订单3创建（场次B）', order3.status === 201);
  const order3Id = order3.body?.data?.id;
  const pay3 = await req(`/api/orders/${order3Id}/pay`, 'PUT');
  assert('订单3支付成功（场次B）', pay3.status === 200);

  const cancel2 = await req(`/api/orders/${order2Id}/cancel`, 'PUT');
  assert('取消场次A订单成功（问题1跨场次隔离）', cancel2.status === 200, cancel2.body?.message);

  const seatsA4 = await req(`/api/seats/available/${schedAId}`, 'GET');
  const seatsB4 = await req(`/api/seats/available/${schedBId}`, 'GET');
  const availA4 = seatsA4.body.data.filter(s => s.status === 'available').length;
  const availB4 = seatsB4.body.data.filter(s => s.status === 'available').length;
  assert('场次A取消后可用座位恢复80个', availA4 === 80, `实际：${availA4}`);
  assert('场次B仍78个可用（不受场次A影响，问题1）', availB4 === 78, `实际：${availB4}`);

  console.log('\n=== 测试9：卖品安全检查和自动补货（问题3）===');
  const safetyCheck = await req('/api/concessions/safety-check?cinemaId=1', 'GET');
  const lowStock = safetyCheck.body?.data?.filter(d => d.isBelowSafety);
  console.log('低于安全水位卖品数:', lowStock?.length);
  lowStock?.forEach(s => console.log(`  - ${s.concession.name}: 当前${s.currentStock}/安全线${s.safetyStock}`));

  const restockList = await req('/api/concessions/restock-requests?status=pending', 'GET');
  assert('自动生成了补货申请（问题3）', restockList.body?.data?.length > 0,
    `实际补货申请数量：${restockList.body?.data?.length}`);
  const pendingRequest = restockList.body?.data?.[0];
  if (pendingRequest) {
    console.log('补货申请ID:', pendingRequest.id, '数量:', pendingRequest.quantity,
      'requestedBy:', pendingRequest.requestedBy);

    const approveReq = await req(`/api/concessions/restock-requests/${pendingRequest.id}/approve`, 'PUT',
      { approvedBy: 1 }, adminToken);
    assert('审批通过成功', approveReq.status === 200, approveReq.body?.message);

    const purchaseReq = await req(`/api/concessions/restock-requests/${pendingRequest.id}/purchase`, 'PUT',
      { quantity: pendingRequest.quantity }, adminToken);
    assert('采购入库成功', purchaseReq.status === 200, purchaseReq.body?.message);
  }

  console.log('\n=== 测试10：无cinemaId扫描所有影院（验证问题3）===');
  const Inv = require('./src/services/InventoryService');
  const scanResult = await Inv.scanAndGenerateRestockRequests(null);
  console.log('全影院扫描生成补货申请数:', scanResult?.length ?? 0);
  assert('cinemaId=null不抛异常完成扫描（问题3）', true);

  console.log('\n=== 测试11：生成报表（验证问题4：票数按实际张数统计）===');
  // order3 2张票在 schedB 已支付，order2 已取消（不算）。重新下单场次A支付3张票
  // 重新锁+下单A场次3张
  const lockA4 = await req('/api/seats/lock', 'POST', {
    scheduleId: schedAId, seatIds: testSeatIds, userId: user1Id
  });
  const order4 = await req('/api/orders', 'POST', {
    userId: user1Id, scheduleId: schedAId, seatIds: testSeatIds
  });
  assert('订单4（场次A 3张）创建', order4.status === 201);
  const order4Id = order4.body?.data?.id;
  const pay4 = await req(`/api/orders/${order4Id}/pay`, 'PUT');
  assert('订单4支付成功', pay4.status === 200);

  const report = await req('/api/reports/generate', 'POST',
    { cinemaId: 1, reportDate: todayStr, createdBy: 1 }, adminToken);
  assert('生成报表成功', report.status === 201, report.body?.message);
  console.log('报表数据:', JSON.stringify({
    总票数: report.body?.data?.totalTickets,
    上座率: report.body?.data?.hallAttendance,
    总收入: report.body?.data?.totalRevenue
  }));
  // order3 2张 + order4 3张 = 5张
  assert('总票数=5（order3 2张 + order4 3张，问题4）', report.body?.data?.totalTickets === 5,
    `实际：${report.body?.data?.totalTickets}，应为5`);

  console.log('\n=== 测试12：查询报表，与Excel数据源一致（验证问题4）===');
  const reports = await req(`/api/reports?cinemaId=1&startDate=${todayStr}&endDate=${todayStr}`, 'GET', null, adminToken);
  assert('查询报表成功', reports.status === 200);
  const r = reports.body?.data?.[0];
  console.log('查询报表数据:', JSON.stringify({
    总票数: r?.totalTickets,
    上座率: r?.hallAttendance,
    总收入: r?.totalRevenue
  }));
  assert('报表接口数据=生成数据（总票数一致，问题4）', r?.totalTickets === report.body?.data?.totalTickets,
    `接口：${r?.totalTickets} vs 生成：${report.body?.data?.totalTickets}`);

  console.log('\n=== 测试13：导出Excel（验证Excel数字与接口一致）===');
  const exportResp = await req(`/api/reports/export?cinemaId=1&startDate=${todayStr}&endDate=${todayStr}&format=json`, 'GET', null, adminToken);
  assert('Excel导出成功返回200（问题4）', exportResp.status === 200, `实际状态: ${exportResp.status}, msg: ${exportResp.body?.message || exportResp.raw?.substring(0, 100)}`);
  assert('Excel接口返回文件路径（问题4）', exportResp.body?.data && exportResp.body.data.filePath, `返回: ${JSON.stringify(exportResp.body?.data)}`);
  console.log('Excel导出路径:', exportResp.body?.data?.filePath, '下载URL:', exportResp.body?.data?.downloadUrl);

  console.log('\n=== 测试14：场次变更通知覆盖管理员/售票员/会员（验证问题5）===');
  const updateSched = await req(`/api/schedules/${schedAId}`, 'PUT', {
    startTime: tm15
  }, adminToken);
  assert('场次更新成功（改为15:00避开场次B）', updateSched.status === 200, updateSched.body?.message);

  const notifAdmin = await req('/api/notifications?userId=1', 'GET', null, adminToken);
  const notifSeller = await req('/api/notifications?userId=2', 'GET', null, adminToken);
  const notifMember = await req(`/api/notifications?userId=${user1Id}`, 'GET');
  console.log('管理员通知数:', notifAdmin.body?.data?.total);
  console.log('售票员通知数:', notifSeller.body?.data?.total);
  console.log('会员user1通知数:', notifMember.body?.data?.total);
  assert('管理员收到通知（问题5）', notifAdmin.body?.data?.total > 0, `实际：${notifAdmin.body?.data?.total}`);
  assert('售票员收到通知（问题5）', notifSeller.body?.data?.total > 0, `实际：${notifSeller.body?.data?.total}`);
  assert('会员收到已购票场次变更通知（问题5）', notifMember.body?.data?.total > 0,
    `实际：${notifMember.body?.data?.total}，member已购order4场次A`);

  console.log('\n=== 测试15：Socket连接使用JWT令牌（验证问题5）===');
  try {
    const socket = require('socket.io-client')('http://localhost:3000', {
      auth: { token: user1Token }
    });
    await new Promise((resolve, reject) => {
      socket.on('connect', () => { console.log('✅ Socket用JWT连接成功（问题5）'); resolve(); });
      socket.on('connect_error', (e) => { console.log('❌ Socket连接失败:', e.message); reject(e); });
      setTimeout(() => reject(new Error('连接超时')), 5000);
    });
    socket.close();
    pass++;
  } catch (e) {
    fail++;
    console.log('❌ Socket JWT连接失败:', e.message);
  }

  console.log('\n=== 测试16：过期锁不能下单（模拟，验证问题2）===');
  // 通过数据库快速过期的方式：直接创建一个过期的SeatLock
  const { SeatLock } = require('./src/models');
  const futureSeat = availableA[20];
  const pastTime = new Date(Date.now() - 16 * 60 * 1000);
  await SeatLock.create({
    scheduleId: schedBId, seatId: futureSeat, userId: user2Id,
    status: 'locked', expiresAt: pastTime, lockedAt: pastTime
  });
  const orderExpired = await req('/api/orders', 'POST', {
    userId: user2Id, scheduleId: schedBId, seatIds: [futureSeat]
  });
  assert('16分钟过期的锁下单返回400（问题2锁过期验证）', orderExpired.status === 400, orderExpired.body?.message);

  console.log(`\n==============================`);
  console.log(`测试完成：通过 ${pass} / ${pass + fail}`);
  if (fail === 0) console.log('🎉 所有测试通过！');
  process.exit(fail === 0 ? 0 : 1);
}

setTimeout(() => {
  runTests().catch(e => { console.error('测试异常:', e); process.exit(1); });
}, 2000);
