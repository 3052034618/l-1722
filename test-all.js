const http = require('http');

function req(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const d = data ? JSON.stringify(data) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, res => {
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

const SD = '2027-06-16';

async function lockAndOrder(scheduleId, seatIds, userId, opts = {}) {
  const lockRes = await req('/api/seats/lock', 'POST', { scheduleId, seatIds, userId });
  if (lockRes.status !== 201) return { lockStatus: lockRes.status, lockMsg: lockRes.body?.message };
  const lockToken = lockRes.body.data.lockToken;
  const orderBody = { userId, scheduleId, seatIds, lockToken };
  if (opts.concessionItems) orderBody.concessionItems = opts.concessionItems;
  const orderRes = await req('/api/orders', 'POST', orderBody);
  return { lockToken, orderId: orderRes.body?.data?.id, orderStatus: orderRes.status, orderMsg: orderRes.body?.message, orderData: orderRes.body?.data };
}

async function runTests() {
  console.log('=== 登录 ===');
  const m1 = await req('/api/auth/login', 'POST', { username: 'member1', password: '123456' });
  const m2 = await req('/api/auth/login', 'POST', { username: 'member2', password: '123456' });
  const adm = await req('/api/auth/login', 'POST', { username: 'admin', password: '123456' });
  assert('member1登录', m1.status === 200);
  assert('member2登录', m2.status === 200);
  assert('admin登录', adm.status === 200);
  const u1 = m1.body.data.user.id, u2 = m2.body.data.user.id, tA = adm.body.data.token;

  console.log('\n=== 创建场次 ===');
  const sA = await req('/api/schedules', 'POST', { movieId: 1, hallId: 1, cinemaId: 1, startTime: `${SD}T10:00:00`, price: 50 }, tA);
  const sB = await req('/api/schedules', 'POST', { movieId: 2, hallId: 2, cinemaId: 1, startTime: `${SD}T14:00:00`, price: 60 }, tA);
  const sC = await req('/api/schedules', 'POST', { movieId: 3, hallId: 3, cinemaId: 1, startTime: `${SD}T18:00:00`, price: 45 }, tA);
  assert('场次A(IMAX)', sA.status === 201, sA.body?.message);
  assert('场次B(3D厅)', sB.status === 201, sB.body?.message);
  assert('场次C(普通厅)', sC.status === 201, sC.body?.message);
  const sAId = sA.body?.data?.id, sBId = sB.body?.data?.id, sCId = sC.body?.data?.id;

  const seatsA = await req(`/api/seats/available/${sAId}`, 'GET');
  const seatsB = await req(`/api/seats/available/${sBId}`, 'GET');
  const seatsC = await req(`/api/seats/available/${sCId}`, 'GET');
  const availA = seatsA.body.data.filter(s => s.status === 'available').map(s => s.id);
  const availB = seatsB.body.data.filter(s => s.status === 'available').map(s => s.id);
  const availC = seatsC.body.data.filter(s => s.status === 'available').map(s => s.id);

  console.log('\n============ 需求1：锁座凭证(lockToken)机制 ============');
  const lock1 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(0, 3), userId: u1 });
  assert('锁座返回lockToken', lock1.body?.data?.lockToken != null, `返回: ${JSON.stringify(lock1.body?.data)?.slice(0, 100)}`);
  const token1 = lock1.body?.data?.lockToken;

  const lock2 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(3, 5), userId: u1 });
  const token2 = lock2.body?.data?.lockToken;
  assert('第二次锁座返回不同token', token1 !== token2);

  console.log('  测试: 不带lockToken下单→400');
  const noTokenOrder = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(0, 3) });
  assert('缺少lockToken→400', noTokenOrder.status === 400);

  console.log('  测试: 用token1只结算第一批3座');
  const order1 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(0, 3), lockToken: token1 });
  assert('token1下单成功201', order1.status === 201, order1.body?.message);
  const o1Id = order1.body?.data?.id;

  console.log('  测试: 用token2结算第二批2座');
  const order2 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(3, 5), lockToken: token2 });
  assert('token2下单成功201', order2.status === 201, order2.body?.message);
  const o2Id = order2.body?.data?.id;

  console.log('  测试: 夹带别的token的座位');
  const lock3 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(5, 7), userId: u1 });
  const token3 = lock3.body?.data?.lockToken;
  const mixOrder = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: [...availA.slice(5, 6), availA[0]], lockToken: token3 });
  assert('夹带座位→400', mixOrder.status === 400, mixOrder.body?.message);

  console.log('  测试: 少交token下的座位');
  const partialOrder = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: [availA[5]], lockToken: token3 });
  assert('少交座位→400', partialOrder.status === 400, partialOrder.body?.message);

  console.log('  测试: 正常用token3下单');
  const order3 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(5, 7), lockToken: token3 });
  assert('token3下单成功201', order3.status === 201, order3.body?.message);

  const pay1 = await req(`/api/orders/${o1Id}/pay`, 'PUT');
  const pay2 = await req(`/api/orders/${o2Id}/pay`, 'PUT');
  const pay3 = await req(`/api/orders/${order3.body?.data?.id}/pay`, 'PUT');
  assert('3个订单全部支付成功', pay1.status === 200 && pay2.status === 200 && pay3.status === 200);

  console.log('\n============ 需求2：补货审批流简化 ============');
  const lock4 = await req('/api/seats/lock', 'POST', { scheduleId: sBId, seatIds: availB.slice(0, 2), userId: u1 });
  const token4 = lock4.body?.data?.lockToken;
  const order4 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sBId, seatIds: availB.slice(0, 2), lockToken: token4, concessionItems: [{ concessionId: 5, quantity: 55 }] });
  const pay4 = await req(`/api/orders/${order4.body?.data?.id}/pay`, 'PUT');
  assert('大量卖品订单支付成功', pay4.status === 200);

  const restockList = await req('/api/concessions/restock-requests?status=pending', 'GET');
  assert('有pending补货申请', restockList.body?.data?.length > 0);
  const reqId = restockList.body?.data?.[0]?.id;

  if (reqId) {
    const approve = await req(`/api/concessions/restock-requests/${reqId}/approve`, 'PUT', { approvedBy: 1 }, tA);
    assert('审批通过→直接purchasing', approve.status === 200 && approve.body?.data?.status === 'purchasing', `状态：${approve.body?.data?.status}`);

    const startPurch = await req(`/api/concessions/restock-requests/${reqId}/start-purchase`, 'PUT', { purchasedBy: 2 }, tA);
    assert('start-purchase已移除→404', startPurch.status === 404);

    const complete = await req(`/api/concessions/restock-requests/${reqId}/purchase`, 'PUT', { quantity: 20 }, tA);
    assert('采购完成→purchased', complete.status === 200 && complete.body?.data?.status === 'purchased', `状态：${complete.body?.data?.status}`);
  }

  console.log('\n============ 需求3：票房与卖品分开 ============');
  const summary = await req(`/api/reports/summary?cinemaId=1&startDate=${SD}&endDate=${SD}`, 'GET');
  assert('汇总200', summary.status === 200);
  assert('有boxRevenue字段', summary.body?.data?.boxRevenue !== undefined, `boxRevenue: ${summary.body?.data?.boxRevenue}`);
  assert('totalRevenue=boxRevenue+卖品', Math.abs(summary.body?.data?.totalRevenue - (summary.body?.data?.boxRevenue + summary.body?.data?.totalConcessionSales)) < 0.01, `total=${summary.body?.data?.totalRevenue} box=${summary.body?.data?.boxRevenue} con=${summary.body?.data?.totalConcessionSales}`);

  const schedDetail = await req(`/api/reports/schedule-detail?cinemaId=1&startDate=${SD}`, 'GET');
  assert('场次明细200', schedDetail.status === 200);
  const firstDetail = schedDetail.body?.data?.[0];
  assert('场次明细有boxRevenue', firstDetail?.boxRevenue !== undefined);
  assert('场次明细有concessionRevenue', firstDetail?.concessionRevenue !== undefined);

  const movieSum = await req(`/api/reports/movie-summary?cinemaId=1&startDate=${SD}`, 'GET');
  assert('影片汇总200', movieSum.status === 200);
  const firstMovie = movieSum.body?.data?.[0];
  assert('影片汇总有boxRevenue', firstMovie?.totalRevenue !== undefined);

  const exportRes = await req(`/api/reports/export?cinemaId=1&startDate=${SD}&endDate=${SD}&format=json`, 'GET', null, tA);
  assert('Excel导出200', exportRes.status === 200);

  console.log('\n============ 需求4：退票/改签流程 ============');
  console.log('  创建用于退票测试的订单');
  const lock5 = await req('/api/seats/lock', 'POST', { scheduleId: sCId, seatIds: availC.slice(0, 2), userId: u2 });
  const token5 = lock5.body?.data?.lockToken;
  const order5 = await req('/api/orders', 'POST', { userId: u2, scheduleId: sCId, seatIds: availC.slice(0, 2), lockToken: token5, concessionItems: [{ concessionId: 1, quantity: 1 }] });
  const pay5 = await req(`/api/orders/${order5.body?.data?.id}/pay`, 'PUT');
  const o5Id = order5.body?.data?.id;
  assert('退票测试订单支付', pay5.status === 200);

  console.log('  会员申请退票');
  const refundBody = { userId: u2, reason: '临时有事' };
  const refundBodyStr = JSON.stringify(refundBody);
  console.log('    POST body:', refundBodyStr, 'length:', refundBodyStr.length);
  const refundApply = await req(`/api/orders/${o5Id}/refund`, 'POST', refundBody);
  console.log('    refund response:', refundApply.status, 'body:', refundApply.body, 'raw:', refundApply.raw);
  assert('退票申请201', refundApply.status === 201, `status=${refundApply.status} msg=${refundApply.body?.message}`);
  const refundId = refundApply.body?.data?.id;

  console.log('  运营审批通过退票');
  const approveRefund = await req(`/api/refunds/${refundId}/approve`, 'PUT', { processedBy: 1 });
  assert('退票审批通过', approveRefund.status === 200, approveRefund.body?.message);

  const order5After = await req(`/api/orders/${o5Id}`, 'GET');
  assert('订单状态→refunded', order5After.body?.data?.status === 'refunded');

  const seatsC2 = await req(`/api/seats/available/${sCId}`, 'GET');
  const availC2 = seatsC2.body.data.filter(s => s.status === 'available').length;
  assert('退票后座位释放', availC2 === 80, `实际：${availC2}`);

  console.log('  退票记录查询');
  const refundRecords = await req('/api/refunds?type=refund&status=completed', 'GET');
  assert('退票记录200', refundRecords.status === 200);
  assert('有完成的退票记录', refundRecords.body?.data?.length > 0);

  console.log('  创建用于改签测试的订单');
  const lock6 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(7, 9), userId: u2 });
  const token6 = lock6.body?.data?.lockToken;
  const order6 = await req('/api/orders', 'POST', { userId: u2, scheduleId: sAId, seatIds: availA.slice(7, 9), lockToken: token6 });
  const pay6 = await req(`/api/orders/${order6.body?.data?.id}/pay`, 'PUT');
  const o6Id = order6.body?.data?.id;
  assert('改签测试订单支付', pay6.status === 200);

  console.log('  会员申请改签（A→C同影院）');
  const reschedApply = await req(`/api/orders/${o6Id}/reschedule`, 'POST', { userId: u2, reason: '时间冲突', newScheduleId: sCId });
  assert('改签申请201', reschedApply.status === 201, `status=${reschedApply.status} msg=${reschedApply.body?.message}`);
  const reschedId = reschedApply.body?.data?.id;

  console.log('  运营审批改签（指定新座位）');
  const approveResched = await req(`/api/refunds/${reschedId}/approve`, 'PUT', { processedBy: 1, newSeatIds: availC.slice(0, 2) });
  assert('改签审批通过', approveResched.status === 200, approveResched.body?.message);

  const order6After = await req(`/api/orders/${o6Id}`, 'GET');
  assert('订单scheduleId已改', order6After.body?.data?.scheduleId === sCId, `实际：${order6After.body?.data?.scheduleId}`);

  console.log('  改签记录查询');
  const reschedRecords = await req('/api/refunds?type=reschedule&status=completed', 'GET');
  assert('改签记录200', reschedRecords.status === 200);
  assert('有完成的改签记录', reschedRecords.body?.data?.length > 0);

  console.log('  改签拒绝测试');
  const lock7 = await req('/api/seats/lock', 'POST', { scheduleId: sAId, seatIds: availA.slice(9, 11), userId: u1 });
  const token7 = lock7.body?.data?.lockToken;
  const order7 = await req('/api/orders', 'POST', { userId: u1, scheduleId: sAId, seatIds: availA.slice(9, 11), lockToken: token7 });
  const pay7 = await req(`/api/orders/${order7.body?.data?.id}/pay`, 'PUT');
  const o7Id = order7.body?.data?.id;
  const refundApply2 = await req(`/api/orders/${o7Id}/refund`, 'POST', { userId: u1, reason: '测试拒绝' });
  const refundId2 = refundApply2.body?.data?.id;
  const rejectRes = await req(`/api/refunds/${refundId2}/reject`, 'PUT', { processedBy: 1 });
  assert('拒绝退票成功', rejectRes.status === 200);
  const refundRecord2 = await req(`/api/refunds?orderId=${o7Id}`, 'GET');
  const rejectedRecord = refundRecord2.body?.data?.find(r => r.id === refundId2);
  assert('记录状态→rejected', rejectedRecord?.status === 'rejected');

  console.log(`\n==============================`);
  console.log(`测试完成：通过 ${pass} / ${pass + fail}`);
  if (fail === 0) console.log('🎉 所有测试通过！');
  process.exit(fail === 0 ? 0 : 1);
}

setTimeout(() => { runTests().catch(e => { console.error('测试异常:', e); process.exit(1); }); }, 2000);
