'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');
const lmsr = require('./lmsr');
const { CATEGORIES } = require('./matchSource');
const oddsSource = require('./oddsSource');
const liveSource = require('./liveSource');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hryemarket-dev-secret-change-me';
const DAILY_REWARD = 500;          // 每日签到发放
const SIGNUP_BONUS = 1000;         // 注册奖励
const DAILY_COOLDOWN = 24 * 3600 * 1000;

db.load();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/* --------------------------------- 工具 --------------------------------- */

function genUid() {
  // 8 位大写字母数字，去掉易混字符
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  const d = db.get();
  if (d.users.some((u) => u.uid === s)) return genUid();
  return s;
}

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.get().users.find((u) => u.id === payload.id);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

function publicUser(u) {
  return { id: u.id, uid: u.uid, email: u.email, nickname: u.nickname, balance: round(u.balance), isAdmin: !!u.isAdmin, lastDaily: u.lastDaily };
}

function round(n) { return Math.round(n * 100) / 100; }

function marketView(m) {
  const p = lmsr.prices(m);
  const lmsrYes = round(p.yes * 100) / 100;
  const priceSource = m.priceSource === 'odds' && m.odds ? 'odds' : 'lmsr';
  // 头部大数字：odds 优先则用赔率去水后的隐含概率，否则用 LMSR 市场价
  const displayProb = priceSource === 'odds' ? round(m.odds.impliedYes * 100) / 100 : lmsrYes;
  return {
    id: m.id,
    title: m.title,
    category: m.category,
    categoryLabel: (CATEGORIES[m.category] || {}).label || m.category,
    categoryColor: (CATEGORIES[m.category] || {}).color || '#8A94A6',
    description: m.description,
    status: m.status,
    outcome: m.outcome,
    yes: lmsrYes,               // LMSR 交易价（份额单价）——买卖以此为准
    no: round(p.no * 100) / 100,
    volume: round(m.volume || 0),
    closeAt: m.closeAt,
    history: m.history,         // LMSR 概率历史
    createdAt: m.createdAt,
    priceSource,                // 'lmsr' | 'odds'
    displayProb,                // 头部展示用概率
    odds: m.odds || null,       // { yesOdds, noOdds, impliedYes, overround, provider, updatedAt }
    oddsHistory: m.oddsHistory || [],
    live: m.live || null,       // { platform, label, color, url, status, statusLabel, statusColor }
  };
}

function getPosition(userId, marketId, create = false) {
  const d = db.get();
  let pos = d.positions.find((p) => p.userId === userId && p.marketId === marketId);
  if (!pos && create) {
    pos = { userId, marketId, yes: 0, no: 0, spent: 0 };
    d.positions.push(pos);
  }
  return pos;
}

function logTxn(t) {
  const d = db.get();
  d.txns.push({ id: db.nextId(), createdAt: Date.now(), ...t });
}

/* --------------------------------- 鉴权 --------------------------------- */

app.post('/api/register', async (req, res) => {
  const { email, password, nickname } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const d = db.get();
  if (d.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: '该邮箱已注册' });

  const user = {
    id: db.nextId(),
    uid: genUid(),
    email,
    passwordHash: await bcrypt.hash(String(password), 10),
    nickname: (nickname && String(nickname).trim()) || email.split('@')[0],
    balance: SIGNUP_BONUS,
    isAdmin: d.users.length === 0, // 第一个注册者为管理员
    lastDaily: 0,
    createdAt: Date.now(),
  };
  d.users.push(user);
  logTxn({ type: 'signup_bonus', to: user.id, amount: SIGNUP_BONUS });
  db.saveNow();
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const d = db.get();
  const user = d.users.find((u) => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user) return res.status(401).json({ error: '邮箱或密码错误' });
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return res.status(401).json({ error: '邮箱或密码错误' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ------------------------------- 每日签到 ------------------------------- */

app.post('/api/daily', auth, (req, res) => {
  const now = Date.now();
  if (req.user.lastDaily && now - req.user.lastDaily < DAILY_COOLDOWN) {
    const left = DAILY_COOLDOWN - (now - req.user.lastDaily);
    return res.status(429).json({ error: '今日已签到', nextInMs: left });
  }
  req.user.balance = round(req.user.balance + DAILY_REWARD);
  req.user.lastDaily = now;
  logTxn({ type: 'daily', to: req.user.id, amount: DAILY_REWARD });
  db.saveNow();
  res.json({ reward: DAILY_REWARD, user: publicUser(req.user) });
});

/* -------------------------------- 市场列表 ------------------------------- */

app.get('/api/markets', (req, res) => {
  const { category, status } = req.query;
  let list = db.get().markets.slice();
  if (category && category !== 'all') list = list.filter((m) => m.category === category);
  if (status) list = list.filter((m) => m.status === status);
  else list = list.filter((m) => m.status !== 'hidden');
  list.sort((a, b) => (b.volume || 0) - (a.volume || 0) || b.createdAt - a.createdAt);
  res.json({ markets: list.map(marketView), categories: CATEGORIES });
});

app.get('/api/markets/:id', (req, res) => {
  const m = db.get().markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  res.json({ market: marketView(m) });
});

/* --------------------------------- 下注 --------------------------------- */

app.post('/api/markets/:id/bet', auth, (req, res) => {
  const { outcome, amount } = req.body || {};
  const spend = Number(amount);
  if (!['yes', 'no'].includes(outcome)) return res.status(400).json({ error: '请选择 YES 或 NO' });
  if (!(spend > 0)) return res.status(400).json({ error: '下注金额需大于 0' });

  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  if (m.status !== 'open') return res.status(400).json({ error: '该市场已停止交易' });
  if (m.closeAt && Date.now() > m.closeAt) return res.status(400).json({ error: '该市场已到截止时间' });
  if (round(req.user.balance) < spend) return res.status(400).json({ error: '平台币余额不足' });

  const result = lmsr.buyWithSpend(m, outcome, spend);

  // 扣款、更新市场持仓
  req.user.balance = round(req.user.balance - result.cost);
  m.qYes = result.qYes;
  m.qNo = result.qNo;
  m.volume = round((m.volume || 0) + result.cost);

  // 更新用户持仓
  const pos = getPosition(req.user.id, m.id, true);
  pos[outcome] = round(pos[outcome] + result.shares);
  pos.spent = round(pos.spent + result.cost);

  // 记录价格历史（图表用）
  const p = lmsr.prices(m);
  m.history.push({ t: Date.now(), yes: round(p.yes * 1000) / 1000 });
  if (m.history.length > 500) m.history.shift();

  logTxn({ type: 'bet', from: req.user.id, marketId: m.id, outcome, amount: round(result.cost), meta: { shares: round(result.shares) } });
  db.saveNow();

  res.json({
    shares: round(result.shares),
    cost: round(result.cost),
    avgPrice: round(result.avgPrice * 100) / 100,
    market: marketView(m),
    user: publicUser(req.user),
    position: { yes: round(pos.yes), no: round(pos.no) },
  });
});

/* --------------------------------- 卖出 --------------------------------- */

app.post('/api/markets/:id/sell', auth, (req, res) => {
  const { outcome, shares } = req.body || {};
  const qty = Number(shares);
  if (!['yes', 'no'].includes(outcome)) return res.status(400).json({ error: '请选择 YES 或 NO' });
  if (!(qty > 0)) return res.status(400).json({ error: '卖出份额需大于 0' });

  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  if (m.status !== 'open') return res.status(400).json({ error: '该市场已停止交易' });

  const pos = getPosition(req.user.id, m.id);
  if (!pos || round(pos[outcome]) < qty) return res.status(400).json({ error: '持仓份额不足' });

  const result = lmsr.sellShares(m, outcome, qty);
  req.user.balance = round(req.user.balance + result.proceeds);
  m.qYes = result.qYes;
  m.qNo = result.qNo;
  m.volume = round((m.volume || 0) + Math.abs(result.proceeds));
  pos[outcome] = round(pos[outcome] - qty);

  const p = lmsr.prices(m);
  m.history.push({ t: Date.now(), yes: round(p.yes * 1000) / 1000 });
  if (m.history.length > 500) m.history.shift();

  logTxn({ type: 'sell', to: req.user.id, marketId: m.id, outcome, amount: round(result.proceeds), meta: { shares: qty } });
  db.saveNow();

  res.json({
    proceeds: round(result.proceeds),
    market: marketView(m),
    user: publicUser(req.user),
    position: { yes: round(pos.yes), no: round(pos.no) },
  });
});

/* -------------------------------- 我的持仓 ------------------------------- */

app.get('/api/portfolio', auth, (req, res) => {
  const d = db.get();
  const rows = d.positions
    .filter((p) => p.userId === req.user.id && (p.yes > 0.0001 || p.no > 0.0001))
    .map((p) => {
      const m = d.markets.find((x) => x.id === p.marketId);
      if (!m) return null;
      const pr = lmsr.prices(m);
      // 当前可平仓价值（近似）：份额 × 当前价格
      const value = round(p.yes * pr.yes + p.no * pr.no);
      return {
        marketId: m.id,
        title: m.title,
        status: m.status,
        outcome: m.outcome,
        yesShares: round(p.yes),
        noShares: round(p.no),
        yesPrice: round(pr.yes * 100) / 100,
        noPrice: round(pr.no * 100) / 100,
        value,
        spent: round(p.spent),
      };
    })
    .filter(Boolean);
  res.json({ positions: rows });
});

/* --------------------------------- 转账 --------------------------------- */

app.post('/api/transfer', auth, (req, res) => {
  const { toUid, amount, note } = req.body || {};
  const amt = Number(amount);
  if (!toUid) return res.status(400).json({ error: '请填写对方 UID' });
  if (!(amt > 0)) return res.status(400).json({ error: '转账金额需大于 0' });

  const d = db.get();
  const target = d.users.find((u) => u.uid === String(toUid).trim().toUpperCase());
  if (!target) return res.status(404).json({ error: '未找到该 UID 用户' });
  if (target.id === req.user.id) return res.status(400).json({ error: '不能转给自己' });
  if (round(req.user.balance) < amt) return res.status(400).json({ error: '余额不足' });

  req.user.balance = round(req.user.balance - amt);
  target.balance = round(target.balance + amt);
  logTxn({ type: 'transfer', from: req.user.id, to: target.id, amount: amt, meta: { note: note || '' } });
  db.saveNow();

  res.json({ user: publicUser(req.user), to: { uid: target.uid, nickname: target.nickname } });
});

app.get('/api/txns', auth, (req, res) => {
  const d = db.get();
  const mine = d.txns
    .filter((t) => t.from === req.user.id || t.to === req.user.id)
    .slice(-100)
    .reverse()
    .map((t) => {
      const dir = t.to === req.user.id && t.from !== req.user.id ? 'in' : 'out';
      let counterparty = null;
      if (t.type === 'transfer') {
        const otherId = dir === 'in' ? t.from : t.to;
        const other = d.users.find((u) => u.id === otherId);
        counterparty = other ? { uid: other.uid, nickname: other.nickname } : null;
      }
      return { id: t.id, type: t.type, dir, amount: t.amount, marketId: t.marketId, outcome: t.outcome, counterparty, note: t.meta?.note, createdAt: t.createdAt };
    });
  res.json({ txns: mine });
});

/* ------------------------------ 管理员：市场 ----------------------------- */

app.post('/api/admin/markets', auth, adminOnly, (req, res) => {
  const { title, category, description, b, closeAt, initialYes,
    live, odds, priceSource } = req.body || {};
  if (!title) return res.status(400).json({ error: '标题必填' });
  const d = db.get();
  const liq = Number(b) > 0 ? Number(b) : 200;
  // 用 initialYes（0~1）初始化倾斜的起始概率
  let qYes = 0, qNo = 0;
  const p0 = Math.min(0.95, Math.max(0.05, Number(initialYes) || 0.5));
  if (p0 !== 0.5) qYes = liq * Math.log(p0 / (1 - p0)); // 反解 logit

  const now = Date.now();
  const m = {
    id: db.nextId(),
    title,
    category: CATEGORIES[category] ? category : 'biz',
    description: description || '',
    b: liq,
    qYes,
    qNo,
    volume: 0,
    status: 'open',
    outcome: null,
    closeAt: closeAt ? Number(closeAt) : null,
    history: [{ t: now, yes: round(p0 * 1000) / 1000 }],
    createdAt: now,
    priceSource: 'lmsr',
    odds: null,
    oddsHistory: [],
    oddsProvider: 'manual',
    live: null,
  };

  // 可选：直播
  if (live && (live.url || live.roomId)) {
    m.live = liveSource.normalizeLive(live);
  }
  // 可选：赔率 / 真实概率
  if (odds && (odds.yesOdds || odds.impliedYes != null)) {
    try {
      m.odds = oddsSource.normalizeOdds(odds, 'manual');
      m.oddsHistory = [{ t: now, yes: round(m.odds.impliedYes * 1000) / 1000 }];
    } catch (e) { return res.status(400).json({ error: e.message }); }
  }
  // 概率来源：只有存在赔率时才允许切到 odds
  if (priceSource === 'odds' && m.odds) m.priceSource = 'odds';

  d.markets.push(m);
  db.saveNow();
  res.json({ market: marketView(m) });
});

/* ---- 管理员：设置/更新直播间 ---- */
app.post('/api/admin/markets/:id/live', auth, adminOnly, (req, res) => {
  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  const { url, roomId, platform, status, clear } = req.body || {};
  if (clear) {
    m.live = null;
  } else {
    const live = liveSource.normalizeLive({ url, roomId, platform, status });
    if (!live) return res.status(400).json({ error: '请提供直播链接或房间号' });
    m.live = live;
  }
  db.saveNow();
  res.json({ market: marketView(m) });
});

/* ---- 管理员：设置/更新赔率或真实概率 ---- */
app.post('/api/admin/markets/:id/odds', auth, adminOnly, (req, res) => {
  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  const { yesOdds, noOdds, impliedYes, provider, clear } = req.body || {};
  if (clear) {
    m.odds = null;
    if (m.priceSource === 'odds') m.priceSource = 'lmsr';
    db.saveNow();
    return res.json({ market: marketView(m) });
  }
  try {
    m.odds = oddsSource.normalizeOdds({ yesOdds, noOdds, impliedYes }, provider || 'manual');
    m.oddsProvider = provider || m.oddsProvider || 'manual';
  } catch (e) { return res.status(400).json({ error: e.message }); }
  m.oddsHistory = m.oddsHistory || [];
  m.oddsHistory.push({ t: Date.now(), yes: round(m.odds.impliedYes * 1000) / 1000 });
  if (m.oddsHistory.length > 500) m.oddsHistory.shift();
  db.saveNow();
  res.json({ market: marketView(m) });
});

/* ---- 管理员：切换头部概率来源 (lmsr | odds) ---- */
app.post('/api/admin/markets/:id/source', auth, adminOnly, (req, res) => {
  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  const { source } = req.body || {};
  if (!['lmsr', 'odds'].includes(source)) return res.status(400).json({ error: 'source 需为 lmsr 或 odds' });
  if (source === 'odds' && !m.odds) return res.status(400).json({ error: '该市场尚未录入赔率，无法切到 odds' });
  m.priceSource = source;
  db.saveNow();
  res.json({ market: marketView(m) });
});

app.post('/api/admin/markets/:id/resolve', auth, adminOnly, (req, res) => {
  const { outcome } = req.body || {};
  if (!['yes', 'no'].includes(outcome)) return res.status(400).json({ error: '结算结果需为 yes 或 no' });
  const d = db.get();
  const m = d.markets.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: '市场不存在' });
  if (m.status === 'resolved') return res.status(400).json({ error: '该市场已结算' });

  // 赢的一方每份额兑付 1 平台币
  let paidTotal = 0, winners = 0;
  for (const pos of d.positions.filter((p) => p.marketId === m.id)) {
    const winShares = pos[outcome];
    if (winShares > 0.0001) {
      const u = d.users.find((x) => x.id === pos.userId);
      if (u) {
        u.balance = round(u.balance + winShares);
        paidTotal = round(paidTotal + winShares);
        winners++;
        logTxn({ type: 'payout', to: u.id, marketId: m.id, outcome, amount: round(winShares) });
      }
    }
  }
  m.status = 'resolved';
  m.outcome = outcome;
  m.history.push({ t: Date.now(), yes: outcome === 'yes' ? 1 : 0 });
  db.saveNow();
  res.json({ market: marketView(m), paidTotal, winners });
});

/* --------------------------------- 兜底 --------------------------------- */

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// SPA 回退
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  const d = db.get();
  console.log(`\n  hryemarket 已启动`);
  console.log(`  ▶  http://localhost:${PORT}`);
  console.log(`  用户 ${d.users.length} 位 · 市场 ${d.markets.length} 个`);
  if (d.markets.length === 0) console.log('  提示：先运行  npm run seed  生成示例市场\n');
  else console.log('');
});