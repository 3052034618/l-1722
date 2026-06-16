const bcrypt = require('bcryptjs');
const sequelize = require('./config/database');
const { Cinema, Hall, Seat, Movie, User, Concession, Member } = require('./models');

async function seed() {
  await sequelize.sync({ force: true });

  const cinemas = await Cinema.bulkCreate([
    { name: '星耀影城（万达店）', address: '万达广场3楼', phone: '010-12345678' },
    { name: '星耀影城（银泰店）', address: '银泰百货5楼', phone: '010-87654321' }
  ]);

  const hallTypes = ['IMAX', '3D', '普通'];
  const halls = [];

  for (const cinema of cinemas) {
    for (const type of hallTypes) {
      const hall = await Hall.create({
        name: `${type}厅`,
        type,
        cinemaId: cinema.id,
        capacity: 80
      });
      halls.push(hall);

      for (let row = 1; row <= 8; row++) {
        for (let col = 1; col <= 10; col++) {
          await Seat.create({
            row,
            col,
            seatNo: `${row}排${col}座`,
            hallId: hall.id,
            status: 'available'
          });
        }
      }
    }
  }

  await Movie.bulkCreate([
    { title: '星际穿越', duration: 169, genre: '科幻', director: '克里斯托弗·诺兰', rating: 9.4 },
    { title: '肖申克的救赎', duration: 142, genre: '剧情', director: '弗兰克·德拉邦特', rating: 9.7 },
    { title: '盗梦空间', duration: 148, genre: '科幻', director: '克里斯托弗·诺兰', rating: 9.3 },
    { title: '千与千寻', duration: 125, genre: '动画', director: '宫崎骏', rating: 9.4 },
    { title: '泰坦尼克号', duration: 194, genre: '爱情', director: '詹姆斯·卡梅隆', rating: 9.1 }
  ]);

  const hashedPassword = await bcrypt.hash('123456', 10);

  await User.create({ username: 'admin', password: hashedPassword, role: 'admin', name: '系统管理员' });

  const sellers = await User.bulkCreate([
    { username: 'seller1', password: hashedPassword, role: 'seller', name: '售票员张三' },
    { username: 'seller2', password: hashedPassword, role: 'seller', name: '售票员李四' }
  ]);

  const members = await User.bulkCreate([
    { username: 'member1', password: hashedPassword, role: 'member', name: '会员王五' },
    { username: 'member2', password: hashedPassword, role: 'member', name: '会员赵六' },
    { username: 'member3', password: hashedPassword, role: 'member', name: '会员孙七' }
  ]);

  for (const cinema of cinemas) {
    await Concession.bulkCreate([
      { name: '爆米花（大）', price: 35, cinemaId: cinema.id, category: '零食', stock: 100, safetyStock: 20, status: 'on_sale' },
      { name: '爆米花（中）', price: 25, cinemaId: cinema.id, category: '零食', stock: 80, safetyStock: 15, status: 'on_sale' },
      { name: '可乐（大）', price: 20, cinemaId: cinema.id, category: '饮料', stock: 120, safetyStock: 25, status: 'on_sale' },
      { name: '可乐（中）', price: 15, cinemaId: cinema.id, category: '饮料', stock: 90, safetyStock: 20, status: 'on_sale' },
      { name: '薯片', price: 18, cinemaId: cinema.id, category: '零食', stock: 60, safetyStock: 10, status: 'on_sale' }
    ]);
  }

  for (const member of members) {
    await Member.create({
      userId: member.id,
      points: 0,
      level: 'normal',
      discountRate: 1.0,
      totalSpent: 0
    });
  }

  console.log('测试数据初始化完成');
}

seed().catch(err => {
  console.error('数据初始化失败：', err);
  process.exit(1);
});
