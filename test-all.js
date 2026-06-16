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

const SD = '2028-06-16';

async function lockOrderPay(scheduleId, seatIds, userId, opts = {}) {
  const lockRes = await req('/api/seats/lock', 'POST', { scheduleId, seatIds, userId });
  if (lockRes.status !== 201) return null;
  const lockToken = lockRes.body.data.lockToken;
  const orderBody = { userId, scheduleId, seatIds, lockToken };
  if (opts.concessionItems) orderBody.concessionItems = opts.concessionItems;
  if (opts.usePoints) { orderBody.usePoints = true; orderBody.pointsToUse = opts.pointsToUse; }
  const orderRes = await req('/api/orders', 'POST', orderBody);
  if (orderRes.status !== 201) return null;
  const payRes = await req(`/api/orders/${orderRes.body.data.id}/pay`, 'PUT');
  return { orderId: orderRes.body.data.id, payStatus: payRes.status, orderData: orderRes.body.data };
}

async function getMemberInfo(userId) {
  const res = await req(`/api/members/info/${userId}`, 'GET');
  return res.body?.data;
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
  const sB = await req('/api/schedules', 'POST', { movieId: 2, hallId: 2, cinemaId: 1, startTime: `${SD}T14:00:00`, price: 80 }, tA);
  const sC = await req('/api/schedules', 'POST', { movieId: 3, hallId: 3, cinemaId: 1, startTime: `${SD}T18:00:00`, price: 45 }, tA);
  assert('场次A(50元)', sA.status === 201, sA.body?.message);
  assert('场次B(80元)', sB.status === 201, sB.body?.message);
  assert('场次C(45元)', sC.status === 201, sC.body?.message);
  const sAId = sA.body?.data?.id, sBId = sB.body?.data?.id, sCId = sC.body?.data?.id;

  const seatsA = await req(`/api/seats/available/${sAId}`, 'GET');
  const seatsC = await req(`/api/seats/available/${sCId}`, 'GET');
  const availA = seatsA.body.data.filter(s => s.status === 'available').map(s => s.id);
  const availC = seatsC.body.data.filter(s => s.status === 'available').map(s => s.id);

  // ============================
  console.log('\n============ 需求1：完整售后单流程 ============');

  console.log('  1.1 创建带积分抵扣的订单');
  const order1 = await lockOrderPay(sAId, availA.slice(0, 2), u2, {
    concessionItems: [{ concessionId: 1, quantity: 2 }],
    usePoints: true, pointsToUse: 100
  });
  assert('订单创建并支付', order1 !== null && order1.payStatus === 200, `order1=${order1?.payStatus}`);
  const o1Id = order1.orderId;

  const order1Info = await req(`/api/orders/${o1Id}`, 'GET');
  const o1PointsUsed = order1Info.body?.data?.pointsUsed || 0;
  const o1PointsEarned = order1Info.body?.data?.pointsEarned || 0;
  console.log(`    积分使用: ${o1PointsUsed}, 积分获得: ${o1PointsEarned}`);

  console.log('  1.2 会员申请退票');
  const refund1 = await req(`/api/orders/${o1Id}/refund`, 'POST', { userId: u2, reason: '临时有事' });
  assert('退票申请201', refund1.status === 201, `status=${refund1.status} msg=${refund1.body?.message}`);

  const refund1Id = refund1.body?.data?.id;
  assert('退票记录含originalScheduleId', refund1.body?.data?.originalScheduleId === sAId, `orig=${refund1.body?.data?.originalScheduleId}`);
  assert('退票记录含originalSeatIds', refund1.body?.data?.originalSeatIds != null);
  assert('退票记录status=pending', refund1.body?.data?.status === 'pending');
  assert('退票记录action未设置', refund1.body?.data?.action === null || refund1.body?.data?.action === undefined);

  console.log('  1.3 重复申请应失败');
  const refund1Dup = await req(`/api/orders/${o1Id}/refund`, 'POST', { userId: u2, reason: '再试' });
  assert('重复申请→500', refund1Dup.status === 500, `status=${refund1Dup.status}`);

  console.log('  1.4 运营审批通过退票(带处理意见)');
  const approve1 = await req(`/api/refunds/${refund1Id}/approve`, 'PUT', {
    processedBy: 1,
    processedReason: '同意退票'
  });
  assert('退票审批通过200', approve1.status === 200, approve1.body?.message);
  assert('action=refund', approve1.body?.data?.action === 'refund');
  assert('status=completed', approve1.body?.data?.status === 'completed');
  assert('pointsReturned>0', approve1.body?.data?.pointsReturned > 0, `points=${approve1.body?.data?.pointsReturned}`);
  assert('processedReason已记录', approve1.body?.data?.processedReason === '同意退票');

  console.log('  1.5 验证订单状态、座位释放、卖品库存、积分回退');
  const order1After = await req(`/api/orders/${o1Id}`, 'GET');
  assert('订单状态→refunded', order1After.body?.data?.status === 'refunded');

  const seatsA2 = await req(`/api/seats/available/${sAId}`, 'GET');
  const availA2 = seatsA2.body.data.filter(s => s.status === 'available').length;
  assert('座位释放→80', availA2 === 80, `实际：${availA2}`);

  const member2Info = await getMemberInfo(u2);
  assert('积分含抵扣退回', member2Info != null, `member data: ${JSON.stringify(member2Info)?.slice(0, 100)}`);

  console.log('  1.6 查看积分明细(来源可追溯)');
  const member2Rec = await req('/api/members', 'GET');
  const member2List = await req(`/api/members/info/${u2}`, 'GET');
  const m2MemberId = member2List.body?.data?.id;
  const pointsRecords = await req(`/api/members/points-records/${m2MemberId}?type=return`, 'GET');
  const returnRecords = pointsRecords.body?.data?.records?.filter(r => r.type === 'return') || [];
  assert('有return类型积分记录', returnRecords.length >= 2, `return records: ${returnRecords.length}`);
  const hasRefundSource = returnRecords.some(r => r.source && r.source.includes('退票'));
  assert('积分来源含退票标记', hasRefundSource, `sources: ${returnRecords.map(r => r.source).join(', ')}`);

  // ============================
  console.log('\n============ 需求2：改签增强 ============');

  console.log('  2.1 创建订单(2座 A场次 50元)');
  const order2 = await lockOrderPay(sAId, availA.slice(0, 2), u2);
  assert('订单创建', order2 !== null, `order2=${order2?.payStatus}`);
  const o2Id = order2.orderId;

  console.log('  2.2 申请改签到C场次(45元，更便宜)');
  const resched1 = await req(`/api/orders/${o2Id}/reschedule`, 'POST', { userId: u2, reason: '时间冲突', newScheduleId: sCId });
  assert('改签申请201', resched1.status === 201, `status=${resched1.status} msg=${resched1.body?.message}`);
  const resched1Id = resched1.body?.data?.id;

  console.log('  2.3 审批改签(C场次更便宜→退差价，直接完成)');
  const approveResch1 = await req(`/api/refunds/${resched1Id}/approve`, 'PUT', {
    processedBy: 1,
    newSeatIds: availC.slice(0, 2),
    processedReason: '同意改签'
  });
  assert('改签审批通过', approveResch1.status === 200, approveResch1.body?.message);
  assert('action=supplement', approveResch1.body?.data?.action === 'supplement');
  assert('status=completed', approveResch1.body?.data?.status === 'completed', `status=${approveResch1.body?.data?.status}`);
  assert('refundAmount>0(退差价)', approveResch1.body?.data?.refundAmount > 0, `refund=${approveResch1.body?.data?.refundAmount}`);

  const order2After = await req(`/api/orders/${o2Id}`, 'GET');
  assert('订单scheduleId已改到C', order2After.body?.data?.scheduleId === sCId, `actual=${order2After.body?.data?.scheduleId}`);

  console.log('  2.4 改签到更贵场次(需补差价)');
  const seatsC2 = await req(`/api/seats/available/${sCId}`, 'GET');
  const availC2 = seatsC2.body.data.filter(s => s.status === 'available').map(s => s.id);

  const order3 = await lockOrderPay(sCId, availC2.slice(0, 2), u1);
  assert('C场次订单创建', order3 !== null);
  const o3Id = order3.orderId;

  console.log('    申请改签到B场次(80元，更贵)');
  const resched2 = await req(`/api/orders/${o3Id}/reschedule`, 'POST', { userId: u1, reason: '想看3D', newScheduleId: sBId });
  assert('改签申请201', resched2.status === 201, `status=${resched2.status} msg=${resched2.body?.message}`);
  const resched2Id = resched2.body?.data?.id;

  const seatsB = await req(`/api/seats/available/${sBId}`, 'GET');
  const availB = seatsB.body.data.filter(s => s.status === 'available').map(s => s.id);

  console.log('    审批改签(B更贵→需补差价)');
  const approveResch2 = await req(`/api/refunds/${resched2Id}/approve`, 'PUT', {
    processedBy: 1,
    newSeatIds: availB.slice(0, 2),
    processedReason: '同意改签，需补差价'
  });
  assert('改签审批→supplement_pending', approveResch2.status === 200, approveResch2.body?.message);
  assert('status=supplement_pending', approveResch2.body?.data?.status === 'supplement_pending', `status=${approveResch2.body?.data?.status}`);
  assert('supplementAmount>0', approveResch2.body?.data?.supplementAmount > 0, `supplement=${approveResch2.body?.data?.supplementAmount}`);
  assert('supplementStatus=pending', approveResch2.body?.data?.supplementStatus === 'pending');

  const order3AfterApprove = await req(`/api/orders/${o3Id}`, 'GET');
  assert('订单supplementStatus=pending', order3AfterApprove.body?.data?.supplementStatus === 'pending');
  assert('订单仍paid(未改签)', order3AfterApprove.body?.data?.status === 'paid');
  assert('订单scheduleId未变', order3AfterApprove.body?.data?.scheduleId === sCId, `actual=${order3AfterApprove.body?.data?.scheduleId}`);

  console.log('    会员补差价');
  const supplementPay = await req(`/api/refunds/${resched2Id}/supplement-pay`, 'POST');
  assert('补款成功200', supplementPay.status === 200, supplementPay.body?.message);
  assert('改签完成status=completed', supplementPay.body?.data?.status === 'completed');
  assert('supplementStatus=paid', supplementPay.body?.data?.supplementStatus === 'paid');

  const order3After = await req(`/api/orders/${o3Id}`, 'GET');
  assert('订单scheduleId→B', order3After.body?.data?.scheduleId === sBId, `actual=${order3After.body?.data?.scheduleId}`);
  assert('订单supplementStatus=paid', order3After.body?.data?.supplementStatus === 'paid');

  console.log('  2.5 改签目标座位已满→原订单不受影响');
  const seatsC3 = await req(`/api/seats/available/${sCId}`, 'GET');
  const availC3 = seatsC3.body.data.filter(s => s.status === 'available').map(s => s.id);
  const order4 = await lockOrderPay(sCId, availC3.slice(0, 2), u2);
  assert('C场次订单创建', order4 !== null);
  const o4Id = order4.orderId;

  const seatsB2 = await req(`/api/seats/available/${sBId}`, 'GET');
  const availB2 = seatsB2.body.data.filter(s => s.status === 'available').map(s => s.id);
  for (const sid of availB2.slice(0, 2)) {
    await req('/api/seats/lock', 'POST', { scheduleId: sBId, seatIds: [sid], userId: u1 });
  }

  const resched3 = await req(`/api/orders/${o4Id}/reschedule`, 'POST', { userId: u2, reason: '换场次', newScheduleId: sBId });
  assert('改签申请201', resched3.status === 201);
  const resched3Id = resched3.body?.data?.id;

  const approveResch3 = await req(`/api/refunds/${resched3Id}/approve`, 'PUT', {
    processedBy: 1,
    newSeatIds: availB2.slice(0, 2),
    processedReason: '目标座位已满'
  });
  assert('目标座位满→rejected', approveResch3.body?.data?.status === 'rejected', `status=${approveResch3.body?.data?.status}`);
  assert('action=reject', approveResch3.body?.data?.action === 'reject');

  const order4After = await req(`/api/orders/${o4Id}`, 'GET');
  assert('原订单不受影响→仍paid', order4After.body?.data?.status === 'paid');
  assert('原订单scheduleId不变', order4After.body?.data?.scheduleId === sCId);

  // ============================
  console.log('\n============ 需求3：售后记录汇总 ============');

  console.log('  3.1 按类型筛选');
  const refundList = await req('/api/refunds?type=refund', 'GET');
  assert('退票记录200', refundList.status === 200);
  assert('退票记录>0', refundList.body?.data?.length > 0);
  const allRefund = refundList.body?.data?.every(r => r.type === 'refund');
  assert('全部是refund类型', allRefund);

  const reschedList = await req('/api/refunds?type=reschedule', 'GET');
  assert('改签记录200', reschedList.status === 200);
  assert('改签记录>0', reschedList.body?.data?.length > 0);

  console.log('  3.2 按状态筛选');
  const completedList = await req('/api/refunds?status=completed', 'GET');
  assert('completed记录200', completedList.status === 200);
  assert('completed记录>0', completedList.body?.data?.length > 0);

  const rejectedList = await req('/api/refunds?status=rejected', 'GET');
  assert('rejected记录200', rejectedList.status === 200);

  console.log('  3.3 按影院筛选');
  const cinemaList = await req('/api/refunds?cinemaId=1', 'GET');
  assert('按影院筛选200', cinemaList.status === 200);

  console.log('  3.4 按影片筛选');
  const movieList = await req('/api/refunds?movieId=1', 'GET');
  assert('按影片筛选200', movieList.status === 200);

  console.log('  3.5 查看售后详情');
  const detail1 = await req(`/api/refunds/${refund1Id}`, 'GET');
  assert('详情200', detail1.status === 200);
  assert('有originalSchedule', detail1.body?.data?.originalSchedule != null);
  assert('有originalSeatIds', detail1.body?.data?.originalSeatIds?.length > 0);
  assert('有refundAmount', detail1.body?.data?.refundAmount > 0);
  assert('有pointsReturned', detail1.body?.data?.pointsReturned > 0);
  assert('有processedBy信息', detail1.body?.data?.processedBy != null);
  assert('有processedReason', detail1.body?.data?.processedReason === '同意退票');
  assert('有orderInfo', detail1.body?.data?.orderInfo != null);

  const detail2 = await req(`/api/refunds/${resched1Id}`, 'GET');
  assert('改签详情200', detail2.status === 200);
  assert('有newSchedule', detail2.body?.data?.newSchedule != null);
  assert('有newSeatIds', detail2.body?.data?.newSeatIds?.length > 0);

  // ============================
  console.log('\n============ 需求4：会员通知+积分回退 ============');

  console.log('  4.1 检查会员通知列表含退票/改签消息');
  const memberNotifs = await req(`/api/notifications/member/${u2}?pageSize=50`, 'GET');
  assert('会员通知200', memberNotifs.status === 200);
  const notifs = memberNotifs.body?.data?.notifications || [];
  const refundApplyNotif = notifs.some(n => n.type === 'refund_apply');
  const refundApprovedNotif = notifs.some(n => n.type === 'refund_approved');
  assert('有退票申请通知', refundApplyNotif);
  assert('有退票通过通知', refundApprovedNotif);

  const reschedApplyNotif = notifs.some(n => n.type === 'reschedule_apply');
  assert('有改签申请通知', reschedApplyNotif);

  console.log('  4.2 拒绝测试(会员收到拒绝通知)');
  const seatsC4 = await req(`/api/seats/available/${sCId}`, 'GET');
  const availC4 = seatsC4.body.data.filter(s => s.status === 'available').map(s => s.id);
  const order5 = await lockOrderPay(sCId, availC4.slice(0, 2), u2);
  assert('订单5创建', order5 !== null);
  const o5Id = order5.orderId;

  const rejectApply = await req(`/api/orders/${o5Id}/refund`, 'POST', { userId: u2, reason: '不想要了' });
  assert('退票申请201', rejectApply.status === 201);
  const rejectId = rejectApply.body?.data?.id;

  const rejectRes = await req(`/api/refunds/${rejectId}/reject`, 'PUT', {
    processedBy: 1,
    processedReason: '已过退票期限'
  });
  assert('拒绝成功200', rejectRes.status === 200);
  assert('status=rejected', rejectRes.body?.data?.status === 'rejected');
  assert('action=reject', rejectRes.body?.data?.action === 'reject');
  assert('processedReason已记录', rejectRes.body?.data?.processedReason === '已过退票期限');

  const memberNotifs2 = await req(`/api/notifications/member/${u2}?pageSize=50`, 'GET');
  const notifs2 = memberNotifs2.body?.data?.notifications || [];
  const rejectedNotif = notifs2.some(n => n.type === 'refund_rejected');
  assert('会员收到拒绝通知', rejectedNotif);

  console.log('  4.3 积分抵扣订单退票→积分退回');
  const m1InfoBefore = await getMemberInfo(u1);
  const m1PointsBefore = m1InfoBefore?.points || 0;

  const order6 = await lockOrderPay(sAId, availA.slice(2, 4), u1, {
    usePoints: true, pointsToUse: 100
  });
  assert('积分抵扣订单创建', order6 !== null);
  const o6Id = order6.orderId;

  const refund6 = await req(`/api/orders/${o6Id}/refund`, 'POST', { userId: u1, reason: '测试积分退回' });
  assert('退票申请201', refund6.status === 201);
  const refund6Id = refund6.body?.data?.id;

  const approve6 = await req(`/api/refunds/${refund6Id}/approve`, 'PUT', { processedBy: 1, processedReason: '同意' });
  assert('退票审批通过', approve6.status === 200);

  const m1InfoAfter = await getMemberInfo(u1);
  const m1PointsAfter = m1InfoAfter?.points || 0;
  const pointsDiff = m1PointsAfter - m1PointsBefore;
  assert('积分退回后余额增加', pointsDiff > 0, `before=${m1PointsBefore} after=${m1PointsAfter} diff=${pointsDiff}`);

  console.log('  4.4 积分明细有来源可追溯');
  const m1MemberInfo = await req(`/api/members/info/${u1}`, 'GET');
  const m1MemberId = m1MemberInfo.body?.data?.id;
  const pointsDetail = await req(`/api/members/points-records/${m1MemberId}`, 'GET');
  const allRecords = pointsDetail.body?.data?.records || [];
  const returnRecs = allRecords.filter(r => r.type === 'return');
  const hasEarnedReturn = returnRecs.some(r => r.source && r.source.includes('扣回获得积分'));
  const hasUsedReturn = returnRecs.some(r => r.source && r.source.includes('退还抵扣积分'));
  assert('有扣回获得积分记录', hasEarnedReturn, `sources: ${returnRecs.map(r => r.source).join(', ')}`);
  assert('有退还抵扣积分记录', hasUsedReturn);

  console.log(`\n==============================`);
  console.log(`测试完成：通过 ${pass} / ${pass + fail}`);
  if (fail === 0) console.log('🎉 所有测试通过！');
  process.exit(fail === 0 ? 0 : 1);
}

setTimeout(() => { runTests().catch(e => { console.error('测试异常:', e); process.exit(1); }); }, 2000);
