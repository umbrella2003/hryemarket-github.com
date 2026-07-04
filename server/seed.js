'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');

db.load();
const d = db.get();

function genUid(existing) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return existing.has(s) ? genUid(existing) : s;
}

// ---- 管理员账号 ----
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@hrye.market';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123456';
const uids = new Set(d.users.map((u) => u.uid));

let admin = d.users.find((u) => u.email === ADMIN_EMAIL);
if (!admin) {
  admin = {
    id: db.nextId(),
    uid: genUid(uids),
    email: ADMIN_EMAIL,
    passwordHash: bcrypt.hashSync(ADMIN_PASS, 10),
    nickname: '平台管理员',
    balance: 100000,
    isAdmin: true,
    lastDaily: 0,
    createdAt: Date.now(),
  };
  d.users.push(admin);
  console.log(`已创建管理员：${ADMIN_EMAIL} / ${ADMIN_PASS}`);
} else {
  admin.isAdmin = true;
  console.log(`管理员已存在：${ADMIN_EMAIL}`);
}

// ---- 示例市场 ----
const now = Date.now();
const DAY = 86400000;

const liveSource = require('./liveSource');
const oddsSource = require('./oddsSource');

function mk(title, category, description, p0, closeInDays, opts = {}) {
  const b = 800; // 流动性参数：越大盘口越深、单笔下注滑点越小
  const qYes = p0 !== 0.5 ? b * Math.log(p0 / (1 - p0)) : 0;
  const m = {
    id: db.nextId(),
    title,
    category,
    description,
    b,
    qYes,
    qNo: 0,
    volume: 0,
    status: 'open',
    outcome: null,
    closeAt: now + closeInDays * DAY,
    history: makeHistory(p0),
    createdAt: now,
    priceSource: 'lmsr',
    odds: null,
    oddsHistory: [],
    oddsProvider: 'manual',
    live: null,
  };
  // 直播（演示：房间号为示例，替换为真实房间号即可）
  if (opts.live) m.live = liveSource.normalizeLive(opts.live);
  // 赔率 / 真实概率（演示：接入真实数据后由数据源写入）
  if (opts.odds) {
    m.odds = oddsSource.normalizeOdds(opts.odds, 'manual');
    m.oddsHistory = makeHistory(m.odds.impliedYes);
    if (opts.priceSource === 'odds') m.priceSource = 'odds';
  }
  return m;
}

// 生成一条看起来自然的历史曲线，让图表一开始就有内容
function makeHistory(p0) {
  const pts = [];
  let p = Math.min(0.9, Math.max(0.1, p0 + (Math.random() - 0.5) * 0.2));
  for (let i = 30; i >= 0; i--) {
    p += (p0 - p) * 0.15 + (Math.random() - 0.5) * 0.05;
    p = Math.min(0.97, Math.max(0.03, p));
    pts.push({ t: now - i * (DAY / 4), yes: Math.round(p * 1000) / 1000 });
  }
  pts.push({ t: now, yes: p0 });
  return pts;
}

const seedMarkets = [
  mk('KPL 2026 春季赛：AG超玩会能否夺冠？', 'kpl',
    '以 KPL 2026 春季赛官方最终赛果为准，AG超玩会拿下总冠军则结算为 YES。', 0.28, 45,
    { live: { platform: 'huya', roomId: '660000', status: 'upcoming' } }),
  mk('无畏契约 VCT 上海大师赛：中国区战队进入四强？', 'val',
    '若有任意一支 CN 赛区战队进入 VCT Masters 上海站四强，结算为 YES。', 0.62, 30,
    { // 概率来源切到真实赔率（去水后≈62%），并挂 B 站直播（直播中）
      odds: { yesOdds: 1.55, noOdds: 2.45 }, priceSource: 'odds',
      live: { platform: 'bili', roomId: '21470', status: 'live' } }),
  mk('和平精英 PEL 2026 S1：Nova 战队进入总决赛？', 'pubgm',
    '以 PEL 2026 赛季一官方积分与赛程为准。', 0.44, 38,
    { live: { platform: 'douyu', roomId: '288016', status: 'ended' } }),
  mk('三角洲行动：2026 年内国服月活是否突破 3000 万？', 'delta',
    '以官方或第三方权威平台公布的月活数据为准，任一月份 MAU ≥ 3000 万即 YES。', 0.55, 120),
  mk('王者荣耀：2026 世冠赛是否再度在国内举办？', 'kpl',
    '以官方赛事公告为准，主赛区设于中国大陆城市则 YES。', 0.71, 90),
  mk('无畏契约国服：2026 年内是否上线新英雄 ≥ 4 名？', 'val',
    '统计 2026 自然年内国服正式上线的新特工数量，达到 4 名及以上为 YES。', 0.48, 150),
  mk('行业：2026 年国内游戏版号发放总量是否超过 1400 个？', 'biz',
    '以国家新闻出版署全年公示的国产+进口版号总数为准。', 0.52, 180),
  mk('和平精英：2026 年内是否推出正式端游版本？', 'pubgm',
    '官方发布可下载的 PC 端正式版（非云游戏/模拟器）则 YES。', 0.19, 160),
];

let added = 0;
for (const m of seedMarkets) {
  if (!d.markets.some((x) => x.title === m.title)) {
    d.markets.push(m);
    added++;
  }
}

db.saveNow();
console.log(`已写入 ${added} 个示例市场，当前市场总数 ${d.markets.length}。`);
console.log('运行  npm start  启动服务。');