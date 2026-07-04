'use strict';

/* ============================ 状态 & 工具 ============================ */
const state = {
  token: localStorage.getItem('hm_token') || null,
  user: null,
  markets: [],
  categories: {},
  cat: 'all',
  view: 'markets',
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = (n) => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
const fmt2 = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => Math.round(n * 100);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(pathName, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${pathName}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function toast(msg, type = '') {
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2600);
}

function openModal(node, { small } = {}) {
  closeModal();
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`<div class="modal ${small ? 'modal-sm' : ''}"></div>`);
  modal.appendChild(node);
  overlay.appendChild(modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', escClose);
  $('#modalRoot').appendChild(overlay);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() { $('#modalRoot').innerHTML = ''; document.removeEventListener('keydown', escClose); }

/* ============================ 顶栏渲染 ============================ */
function renderTopbar() {
  const nav = $('#mainnav');
  const items = [['markets', '市场'], ['portfolio', '我的持仓'], ['wallet', '钱包']];
  if (state.user?.isAdmin) items.push(['admin', '管理']);
  nav.innerHTML = items.map(([v, l]) =>
    `<a data-nav="${v}" href="#${v}" class="${state.view === v ? 'active' : ''}">${l}</a>`).join('');

  const right = $('#topbarRight');
  if (state.user) {
    const initial = esc((state.user.nickname || 'U')[0].toUpperCase());
    right.innerHTML = `
      <div class="balance-chip" title="平台币余额">
        <span class="coin"></span><b>${fmt(state.user.balance)}</b><small>币</small>
      </div>
      <button class="avatar-btn" id="userMenuBtn">
        <span class="avatar">${initial}</span>
        <span class="nick">${esc(state.user.nickname)}</span>
      </button>`;
    $('#userMenuBtn').onclick = () => go('wallet');
  } else {
    right.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="loginBtn">登录</button>
      <button class="btn btn-primary btn-sm" id="registerBtn">注册</button>`;
    $('#loginBtn').onclick = () => openAuth('login');
    $('#registerBtn').onclick = () => openAuth('register');
  }
}

/* ============================ 路由 ============================ */
function go(view) { location.hash = view; }
window.addEventListener('hashchange', route);

function route() {
  const raw = location.hash.replace('#', '') || 'markets';
  const view = ['markets', 'portfolio', 'wallet', 'admin'].includes(raw) ? raw : 'markets';
  if ((view === 'portfolio' || view === 'wallet') && !state.user) { openAuth('login'); location.hash = 'markets'; return; }
  if (view === 'admin' && !state.user?.isAdmin) { location.hash = 'markets'; return; }
  state.view = view;
  renderTopbar();
  if (view === 'markets') renderMarkets();
  else if (view === 'portfolio') renderPortfolio();
  else if (view === 'wallet') renderWallet();
  else if (view === 'admin') renderAdmin();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); go(nav.dataset.nav); }
});

/* ============================ 市场列表 ============================ */
async function renderMarkets() {
  const app = $('#app');
  app.innerHTML = `
    <div class="page-head">
      <div><h1>预测市场</h1><p>用平台币押注中国游戏电竞行业的下一步走向</p></div>
    </div>
    <div class="cat-bar" id="catBar"></div>
    <div class="grid" id="grid">${skeletonCards(6)}</div>`;

  try {
    const data = await api(`/markets${state.cat !== 'all' ? `?category=${state.cat}` : ''}`);
    state.markets = data.markets;
    state.categories = data.categories;
    renderCatBar();
    renderGrid(data.markets);
  } catch (e) { toast(e.message, 'err'); }
}

function skeletonCards(n) {
  return Array.from({ length: n }).map(() => `<div class="skeleton" style="height:210px"></div>`).join('');
}

function renderCatBar() {
  const bar = $('#catBar');
  const cats = [['all', '全部']].concat(Object.entries(state.categories).map(([k, v]) => [k, v.label]));
  bar.innerHTML = cats.map(([k, label]) => {
    const color = k === 'all' ? '' : `style="--dot:${state.categories[k]?.color}"`;
    const active = state.cat === k ? 'active' : '';
    return `<button class="cat-pill ${active}" data-c="${k}" ${color}>${esc(label)}</button>`;
  }).join('');
  bar.querySelectorAll('.cat-pill').forEach((b) => {
    b.onclick = () => { state.cat = b.dataset.c; renderMarkets(); };
    if (b.classList.contains('active') && b.dataset.c !== 'all' && b.style.getPropertyValue('--dot')) {
      b.style.background = b.style.getPropertyValue('--dot') + '22';
      b.style.color = b.style.getPropertyValue('--dot');
      b.style.borderColor = 'transparent';
    }
  });
}

function renderGrid(markets) {
  const grid = $('#grid');
  if (!markets.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>暂无市场</h3><p>换个分类看看，或联系管理员创建新市场</p></div>`;
    return;
  }
  grid.innerHTML = '';
  markets.forEach((m) => grid.appendChild(marketCard(m)));
}

/* ---- 直播 / 赔率 / 概率来源 辅助 ---- */
const LMSR_COLOR = '#2DD4BF';
const ODDS_COLOR = '#7C6CF5';

// 头部展示概率（odds 优先则用赔率隐含概率）
function displayProb(m) { return m.displayProb != null ? m.displayProb : m.yes; }
// 与来源匹配的历史序列
function seriesFor(m, src) {
  return src === 'odds' && m.oddsHistory?.length ? m.oddsHistory : m.history;
}
function probFor(m, src) {
  return src === 'odds' && m.odds ? m.odds.impliedYes : m.yes;
}

function liveBadge(live) {
  if (!live) return '';
  const dot = live.status === 'live' ? '<span class="live-dot"></span>' : '';
  return `<span class="live-badge ${live.status}" style="--lc:${live.statusColor}">${dot}${esc(live.statusLabel)}</span>`;
}

function liveButtonHTML(live) {
  if (!live?.url) return '';
  const live_now = live.status === 'live';
  const ico = live_now ? '<span class="live-dot"></span>' : '▶';
  const txt = live_now
    ? `正在直播 · 前往${esc(live.label)}观看`
    : `前往${esc(live.label)}直播间 · ${esc(live.statusLabel)}`;
  return `<a class="live-btn ${live.status}" href="${esc(live.url)}" target="_blank" rel="noopener noreferrer" style="--lc:${live.statusColor}">
      <span class="live-btn-ico">${ico}</span><span class="live-btn-txt">${txt}</span><span class="live-btn-go">↗</span>
    </a>`;
}

function oddsInfoHTML(odds) {
  if (!odds) return '';
  return `<div class="odds-info">
      <span class="odds-lbl">真实赔率(去水)</span>
      <span class="odds-vals"><b class="p-yes">YES ${fmt2(odds.yesOdds)}</b><b class="p-no">NO ${fmt2(odds.noOdds)}</b></span>
      <span class="odds-meta">隐含 ${pct(odds.impliedYes)}% · 水位 ${(odds.overround * 100).toFixed(1)}% · 源 ${esc(odds.provider)}</span>
    </div>`;
}

function sourceToggleHTML(cur) {
  return `<div class="src-toggle" id="srcToggle">
      <button data-src="lmsr" class="${cur === 'lmsr' ? 'active' : ''}">市场价</button>
      <button data-src="odds" class="${cur === 'odds' ? 'active' : ''}">赔率参考</button>
    </div>`;
}

// 详情页当前图表重绘器（供交易面板下注后回调刷新）
let activeChartRedraw = null;

function marketCard(m) {
  const resolved = m.status === 'resolved';
  const dp = displayProb(m);
  const isOdds = m.priceSource === 'odds';
  const srcBadge = isOdds ? `<span class="src-badge">赔率</span>` : '';
  const card = el(`
    <div class="card" data-id="${m.id}">
      ${resolved ? `<span class="resolved-badge">已结算 · ${m.outcome === 'yes' ? 'YES' : 'NO'}</span>` : ''}
      <div class="card-top">
        <span class="chip" style="color:${m.categoryColor};background:${m.categoryColor}1f">${esc(m.categoryLabel)}</span>
        <span class="card-top-right">${srcBadge}${liveBadge(m.live)}</span>
      </div>
      <div class="card-title">${esc(m.title)}</div>
      <div class="card-mid">
        <div class="big-prob">
          <span class="num">${pct(dp)}</span><span class="pct">%</span>
          <span class="lbl">YES${isOdds ? ' · 赔率' : ''}</span>
        </div>
        <canvas class="spark" width="160" height="40"></canvas>
      </div>
      <div class="probbar"><div class="fill" style="width:${pct(dp)}%;background:${isOdds ? ODDS_COLOR : LMSR_COLOR}"></div></div>
      <div class="card-foot">
        <div class="yn"><span class="tag-yes">YES ${fmt2(m.yes)}</span><span class="tag-no">NO ${fmt2(m.no)}</span></div>
        <span>成交 ${fmt(m.volume)} 币</span>
      </div>
    </div>`);
  card.onclick = () => openMarket(m.id);
  requestAnimationFrame(() => drawSparkline(card.querySelector('.spark'), seriesFor(m, m.priceSource)));
  return card;
}

/* ============================ 市场详情 & 交易 ============================ */
async function openMarket(id) {
  let m;
  try { m = (await api(`/markets/${id}`)).market; } catch (e) { return toast(e.message, 'err'); }

  let position = { yes: 0, no: 0 };
  if (state.user) {
    try {
      const pf = await api('/portfolio');
      const p = pf.positions.find((x) => x.marketId === id);
      if (p) position = { yes: p.yesShares, no: p.noShares };
    } catch {}
  }

  const resolved = m.status === 'resolved';
  const node = el(`
    <div>
      <div class="modal-head">
        <div>
          <span class="chip" style="color:${m.categoryColor};background:${m.categoryColor}1f">${esc(m.categoryLabel)}</span>
          <h2 style="margin-top:10px">${esc(m.title)}</h2>
        </div>
        <button class="close-x" id="mClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="chart-legend">
          <span><span class="legend-dot" style="background:${m.priceSource === 'odds' ? ODDS_COLOR : LMSR_COLOR}"></span>YES 概率</span>
          ${m.odds ? sourceToggleHTML(m.priceSource) : ''}
          <span class="cur-prob" style="margin-left:auto;font-family:var(--mono)">当前 ${pct(displayProb(m))}%</span>
        </div>
        <div class="detail-chart"><canvas id="bigChart"></canvas></div>
        ${liveButtonHTML(m.live)}
        ${oddsInfoHTML(m.odds)}
        <div class="meta-row">
          <span>成交额 <b>${fmt(m.volume)}</b> 币</span>
          <span>截止 <b>${m.closeAt ? new Date(m.closeAt).toLocaleDateString('zh-CN') : '—'}</b></span>
          <span>状态 <b>${resolved ? '已结算' : '交易中'}</b></span>
        </div>
        <div class="trade-grid">
          <div>
            <p class="desc">${esc(m.description || '暂无更多说明。')}</p>
            ${resolved ? `<div class="est" style="margin-top:16px">本市场已结算，结果为 <b style="color:${m.outcome === 'yes' ? 'var(--yes)' : 'var(--no)'}">${m.outcome === 'yes' ? 'YES 成立' : 'NO 不成立'}</b>。持有获胜份额的用户已按每份 1 币兑付。</div>` : ''}
          </div>
          <div id="tradePanel"></div>
        </div>
      </div>
    </div>`);

  openModal(node);
  $('#mClose').onclick = () => { activeChartRedraw = null; closeModal(); };

  let curSource = m.priceSource === 'odds' ? 'odds' : 'lmsr';
  function redraw() {
    const color = curSource === 'odds' ? ODDS_COLOR : LMSR_COLOR;
    drawChart($('#bigChart'), seriesFor(m, curSource), color);
    const cp = $('.cur-prob', node); if (cp) cp.textContent = `当前 ${pct(probFor(m, curSource))}%`;
    const ld = $('.legend-dot', node); if (ld) ld.style.background = color;
    node.querySelectorAll('#srcToggle button').forEach((b) => b.classList.toggle('active', b.dataset.src === curSource));
  }
  activeChartRedraw = redraw;
  node.querySelectorAll('#srcToggle button').forEach((b) => b.onclick = () => { curSource = b.dataset.src; redraw(); });
  requestAnimationFrame(redraw);

  if (!resolved) renderTradePanel($('#tradePanel'), m, position);
  else $('#tradePanel').innerHTML = positionSummary(position);
}

function positionSummary(pos) {
  if (!pos.yes && !pos.no) return `<div class="trade-box"><p class="position-line">你未持有该市场份额</p></div>`;
  return `<div class="trade-box"><p class="position-line">你的持仓：<span class="p-yes">${fmt2(pos.yes)} YES</span> · <span class="p-no">${fmt2(pos.no)} NO</span></p></div>`;
}

function renderTradePanel(root, m, position) {
  let side = 'yes';
  let mode = 'buy';

  function render() {
    const price = side === 'yes' ? m.yes : m.no;
    root.innerHTML = `
      <div class="trade-box">
        <div class="side-toggle">
          <button class="side-btn ${side === 'yes' ? 'sel-yes' : ''}" data-s="yes">
            <span class="s-lbl">YES</span><span class="s-price">${fmt2(m.yes)} 币/份</span>
          </button>
          <button class="side-btn ${side === 'no' ? 'sel-no' : ''}" data-s="no">
            <span class="s-lbl">NO</span><span class="s-price">${fmt2(m.no)} 币/份</span>
          </button>
        </div>

        <div class="auth-tabs" style="margin-bottom:14px">
          <button data-m="buy" class="${mode === 'buy' ? 'active' : ''}">买入</button>
          <button data-m="sell" class="${mode === 'sell' ? 'active' : ''}">卖出</button>
        </div>

        ${mode === 'buy' ? buyForm() : sellForm()}

        <p class="position-line">当前持仓：<span class="p-yes">${fmt2(position.yes)} YES</span> · <span class="p-no">${fmt2(position.no)} NO</span></p>
      </div>`;

    root.querySelectorAll('.side-btn').forEach((b) => b.onclick = () => { side = b.dataset.s; render(); });
    root.querySelectorAll('.auth-tabs button').forEach((b) => b.onclick = () => { mode = b.dataset.m; render(); });

    if (mode === 'buy') wireBuy(); else wireSell();
  }

  function buyForm() {
    return `
      <div class="amount-field">
        <input id="amt" type="number" min="1" step="1" placeholder="0" inputmode="decimal" />
        <span class="suffix">币</span>
      </div>
      <div class="quick-amts">
        ${[100, 500, 1000, '全部'].map((v) => `<button data-q="${v}">${v === '全部' ? '全部' : '+' + v}</button>`).join('')}
      </div>
      <div class="est" id="est">
        <div class="est-row"><span>预计买入</span><b id="estShares">— 份</b></div>
        <div class="est-row"><span>成交均价</span><b id="estPrice">—</b></div>
        <div class="est-row win"><span>若命中最高可得</span><b id="estWin">—</b></div>
      </div>
      <button class="btn btn-block ${side === 'yes' ? 'btn-yes' : 'btn-no'}" id="submitBet">
        买入 ${side === 'yes' ? 'YES' : 'NO'}
      </button>`;
  }

  function sellForm() {
    const held = side === 'yes' ? position.yes : position.no;
    return `
      <div class="amount-field">
        <input id="sellQty" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal" />
        <span class="suffix">份</span>
      </div>
      <div class="quick-amts">
        <button data-sq="0.5">半仓</button><button data-sq="1">全部 (${fmt2(held)})</button>
      </div>
      <div class="est"><div class="est-row"><span>可卖份额</span><b>${fmt2(held)} ${side.toUpperCase()}</b></div>
        <div class="est-row"><span>约可得回</span><b id="sellEst">—</b></div></div>
      <button class="btn btn-block btn-ghost" id="submitSell">卖出 ${side.toUpperCase()}</button>`;
  }

  function wireBuy() {
    const amt = $('#amt', root);
    const update = () => {
      const v = Number(amt.value);
      const price = side === 'yes' ? m.yes : m.no;
      if (!(v > 0)) { $('#estShares', root).textContent = '— 份'; $('#estPrice', root).textContent = '—'; $('#estWin', root).textContent = '—'; return; }
      // 前端粗略估算（后端按 LMSR 精确计算）
      const shares = v / price;
      $('#estShares', root).textContent = `≈ ${fmt2(shares)} 份`;
      $('#estPrice', root).textContent = `≈ ${fmt2(price)} 币`;
      $('#estWin', root).textContent = `≈ ${fmt2(shares)} 币`;
    };
    amt.oninput = update;
    root.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
      const q = b.dataset.q;
      amt.value = q === '全部' ? Math.floor(state.user?.balance || 0) : (Number(amt.value) || 0) + Number(q);
      update();
    });
    $('#submitBet', root).onclick = async () => {
      if (!state.user) return openAuth('login');
      const v = Number(amt.value);
      if (!(v > 0)) return toast('请输入下注金额', 'err');
      const btn = $('#submitBet', root); btn.disabled = true;
      try {
        const r = await api(`/markets/${m.id}/bet`, { method: 'POST', body: { outcome: side, amount: v } });
        state.user = r.user; renderTopbar();
        Object.assign(m, r.market);
        position = r.position;
        toast(`买入成功：${fmt2(r.shares)} 份 ${side.toUpperCase()}，花费 ${fmt2(r.cost)} 币`, 'ok');
        if (activeChartRedraw) activeChartRedraw(); else drawChart($('#bigChart'), m.history);
        render();
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    };
  }

  function wireSell() {
    const qty = $('#sellQty', root);
    const held = side === 'yes' ? position.yes : position.no;
    const price = side === 'yes' ? m.yes : m.no;
    const update = () => { const v = Number(qty.value); $('#sellEst', root).textContent = v > 0 ? `≈ ${fmt2(v * price)} 币` : '—'; };
    qty.oninput = update;
    root.querySelectorAll('[data-sq]').forEach((b) => b.onclick = () => { qty.value = fmt2(held * Number(b.dataset.sq)); update(); });
    $('#submitSell', root).onclick = async () => {
      const v = Number(qty.value);
      if (!(v > 0)) return toast('请输入卖出份额', 'err');
      const btn = $('#submitSell', root); btn.disabled = true;
      try {
        const r = await api(`/markets/${m.id}/sell`, { method: 'POST', body: { outcome: side, shares: v } });
        state.user = r.user; renderTopbar();
        Object.assign(m, r.market); position = r.position;
        toast(`卖出成功，得回 ${fmt2(r.proceeds)} 币`, 'ok');
        if (activeChartRedraw) activeChartRedraw(); else drawChart($('#bigChart'), m.history);
        render();
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    };
  }

  render();
}

/* ============================ 我的持仓 ============================ */
async function renderPortfolio() {
  const app = $('#app');
  app.innerHTML = `<div class="page-head"><div><h1>我的持仓</h1><p>你在各市场持有的 YES / NO 份额与当前价值</p></div></div><div id="pf">${skeletonCards(1)}</div>`;
  try {
    const { positions } = await api('/portfolio');
    const box = $('#pf');
    if (!positions.length) { box.innerHTML = `<div class="empty"><h3>还没有持仓</h3><p>去市场页面挑一个感兴趣的议题押注吧</p></div>`; return; }
    const totalValue = positions.reduce((s, p) => s + p.value, 0);
    const totalSpent = positions.reduce((s, p) => s + p.spent, 0);
    box.innerHTML = `
      <div class="wallet-grid" style="margin-bottom:18px">
        <div class="panel"><h3>持仓估值</h3><div class="daily-card"><div class="reward" style="color:var(--yes)">${fmt2(totalValue)}</div><p>当前可平仓约值（币）</p></div></div>
        <div class="panel"><h3>累计投入</h3><div class="daily-card"><div class="reward" style="color:var(--text)">${fmt2(totalSpent)}</div><p>历史买入总花费（币）</p></div></div>
      </div>
      <div class="panel">
        <table class="pf-table">
          <thead><tr><th>市场</th><th>YES 份额</th><th>NO 份额</th><th>当前价</th><th>估值</th></tr></thead>
          <tbody>${positions.map(pfRow).join('')}</tbody>
        </table>
      </div>`;
    box.querySelectorAll('.m-title').forEach((t) => t.onclick = () => openMarket(Number(t.dataset.id)));
  } catch (e) { toast(e.message, 'err'); }
}

function pfRow(p) {
  const st = p.status === 'resolved' ? `<span style="color:var(--text-mute)">（已结算 ${p.outcome === 'yes' ? 'YES' : 'NO'}）</span>` : '';
  return `<tr>
    <td><span class="m-title" data-id="${p.marketId}">${esc(p.title)}</span> ${st}</td>
    <td class="mono" style="color:var(--yes)">${fmt2(p.yesShares)}</td>
    <td class="mono" style="color:var(--no)">${fmt2(p.noShares)}</td>
    <td class="mono">${fmt2(p.yesPrice)}/${fmt2(p.noPrice)}</td>
    <td class="mono">${fmt2(p.value)}</td>
  </tr>`;
}

/* ============================ 钱包 / 转账 ============================ */
async function renderWallet() {
  const app = $('#app');
  const u = state.user;
  const canDaily = !u.lastDaily || Date.now() - u.lastDaily >= 24 * 3600 * 1000;
  app.innerHTML = `
    <div class="page-head"><div><h1>钱包</h1><p>平台币充当预测下注筹码，可在用户间转账，不可提现</p></div></div>
    <div class="wallet-grid">
      <div class="panel">
        <h3>💰 我的余额</h3>
        <div class="daily-card"><div class="reward">${fmt(u.balance)}</div><p>平台币（币）</p></div>
        <div class="uid-box"><span>我的 UID</span><span class="uid" id="myUid">${esc(u.uid)}</span></div>
        <button class="copy-btn" id="copyUid" style="width:100%;text-align:center;padding:8px">复制 UID 供他人转账</button>
      </div>
      <div class="panel daily-card">
        <h3 style="justify-content:center">🎁 每日签到</h3>
        <div class="reward">+500</div>
        <p>每 24 小时可领取一次</p>
        <button class="btn btn-primary btn-block" id="dailyBtn" ${canDaily ? '' : 'disabled'}>${canDaily ? '领取今日奖励' : '今日已领取'}</button>
      </div>
    </div>

    <div class="wallet-grid" style="margin-top:16px">
      <div class="panel">
        <h3>🔁 转账给好友</h3>
        <div class="form-group"><label>对方 UID</label><input id="toUid" placeholder="如 A1B2C3D4" style="text-transform:uppercase" maxlength="8" /></div>
        <div class="form-group"><label>金额</label><input id="tAmt" type="number" min="1" placeholder="0" /></div>
        <div class="form-group"><label>备注（选填）</label><input id="tNote" placeholder="给你的下注本金~" maxlength="40" /></div>
        <div class="form-err" id="tErr"></div>
        <button class="btn btn-primary btn-block" id="transferBtn">确认转账</button>
      </div>
      <div class="panel">
        <h3>📜 最近流水</h3>
        <div class="txn-list" id="txnList">加载中…</div>
      </div>
    </div>`;

  $('#copyUid').onclick = () => { navigator.clipboard?.writeText(u.uid); toast('UID 已复制', 'ok'); };
  $('#dailyBtn').onclick = async () => {
    try { const r = await api('/daily', { method: 'POST' }); state.user = r.user; toast(`签到成功，+${r.reward} 币`, 'ok'); renderWallet(); renderTopbar(); }
    catch (e) { toast(e.message, 'err'); }
  };
  $('#transferBtn').onclick = doTransfer;
  loadTxns();
}

async function doTransfer() {
  const toUid = $('#toUid').value.trim().toUpperCase();
  const amount = Number($('#tAmt').value);
  const note = $('#tNote').value.trim();
  const errEl = $('#tErr'); errEl.textContent = '';
  if (!toUid) return errEl.textContent = '请填写对方 UID';
  if (!(amount > 0)) return errEl.textContent = '金额需大于 0';
  const btn = $('#transferBtn'); btn.disabled = true;
  try {
    const r = await api('/transfer', { method: 'POST', body: { toUid, amount, note } });
    state.user = r.user;
    toast(`已向 ${r.to.nickname} 转账 ${fmt(amount)} 币`, 'ok');
    renderWallet(); renderTopbar();
  } catch (e) { errEl.textContent = e.message; btn.disabled = false; }
}

async function loadTxns() {
  try {
    const { txns } = await api('/txns');
    const list = $('#txnList');
    if (!txns.length) { list.innerHTML = `<p style="color:var(--text-mute);font-size:13px;padding:8px 0">暂无记录</p>`; return; }
    const label = {
      signup_bonus: ['🎉', '注册奖励'], daily: ['🎁', '每日签到'], payout: ['🏆', '结算兑付'],
      bet: ['🎯', '下注'], sell: ['↩️', '卖出'], transfer: ['🔁', '转账'],
    };
    list.innerHTML = txns.map((t) => {
      const [ico, name] = label[t.type] || ['•', t.type];
      let desc = name;
      if (t.type === 'transfer') desc = `${t.dir === 'in' ? '收款自' : '转账给'} ${t.counterparty ? esc(t.counterparty.nickname) : '?'}${t.note ? ' · ' + esc(t.note) : ''}`;
      else if (t.type === 'bet') desc = `下注 ${t.outcome?.toUpperCase() || ''}`;
      const sign = t.dir === 'in' ? '+' : '−';
      return `<div class="txn">
        <div class="t-left"><span class="t-ico">${ico}</span>
          <div><div class="t-desc">${desc}</div><div class="t-time">${new Date(t.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
        </div>
        <span class="t-amt ${t.dir}">${sign}${fmt2(t.amount)}</span>
      </div>`;
    }).join('');
  } catch (e) { $('#txnList').innerHTML = `<p style="color:var(--no);font-size:13px">${esc(e.message)}</p>`; }
}

/* ============================ 管理面板 ============================ */
async function renderAdmin() {
  const app = $('#app');
  app.innerHTML = `
    <div class="page-head"><div><h1>管理面板</h1><p>创建新市场 · 结算已知结果</p></div></div>
    <div class="wallet-grid">
      <div class="panel">
        <h3>➕ 创建市场</h3>
        <div class="form-group"><label>议题标题</label><input id="aTitle" placeholder="如：KPL 2026 夏季赛 XX 战队夺冠？" /></div>
        <div class="form-group"><label>分类</label><select id="aCat"></select></div>
        <div class="form-group"><label>说明 / 结算规则</label><textarea id="aDesc" rows="3" placeholder="以什么口径判定 YES..."></textarea></div>
        <div class="form-group"><label>初始 YES 概率：<span id="pShow" class="mono">50%</span></label>
          <input id="aP" type="range" min="5" max="95" value="50" style="padding:0" /></div>
        <div class="form-group"><label>流动性参数 b（越大越稳）</label><input id="aB" type="number" value="800" /></div>

        <div class="form-group"><label>直播链接 / 房间号（选填）</label>
          <input id="aLive" placeholder="https://www.huya.com/660000 或纯房间号" /></div>
        <div class="form-row">
          <div class="form-group"><label>直播平台</label><select id="aLivePlat">
            <option value="">自动识别</option><option value="huya">虎牙</option><option value="douyu">斗鱼</option>
            <option value="bili">B站</option><option value="douyin">抖音</option><option value="other">其他</option>
          </select></div>
          <div class="form-group"><label>直播状态</label><select id="aLiveStatus">
            <option value="upcoming">即将开始</option><option value="live">直播中</option><option value="ended">已结束</option>
          </select></div>
        </div>

        <div class="form-group"><label>头部概率来源</label><select id="aSource">
          <option value="lmsr">市场价 · LMSR（用户下注内生）</option>
          <option value="odds">真实赔率 · 去水隐含概率</option>
        </select></div>
        <div class="form-row" id="oddsFields" style="display:none">
          <div class="form-group"><label>YES 十进制赔率</label><input id="aYesOdds" type="number" step="0.01" placeholder="如 1.55" /></div>
          <div class="form-group"><label>NO 十进制赔率</label><input id="aNoOdds" type="number" step="0.01" placeholder="如 2.45" /></div>
        </div>

        <div class="form-err" id="aErr"></div>
        <button class="btn btn-primary btn-block" id="createBtn">创建</button>
      </div>
      <div class="panel">
        <h3>⚖️ 结算市场</h3>
        <div id="resolveList">加载中…</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h3>🛠️ 运营：直播 & 真实概率（更新已有市场）</h3>
      <div class="form-group"><label>选择市场</label><select id="opMarket"><option>加载中…</option></select></div>
      <div class="ops-cols">
        <div class="ops-col">
          <h4>📺 直播间</h4>
          <div class="form-group"><input id="opLive" placeholder="直播链接或纯房间号" /></div>
          <div class="form-row">
            <select id="opLivePlat">
              <option value="">自动识别</option><option value="huya">虎牙</option><option value="douyu">斗鱼</option>
              <option value="bili">B站</option><option value="douyin">抖音</option><option value="other">其他</option>
            </select>
            <select id="opLiveStatus">
              <option value="upcoming">即将开始</option><option value="live">直播中</option><option value="ended">已结束</option>
            </select>
          </div>
          <div class="ops-btns">
            <button class="btn btn-primary btn-sm" id="opLiveSet">保存直播</button>
            <button class="btn btn-ghost btn-sm" id="opLiveClear">清除</button>
          </div>
        </div>
        <div class="ops-col">
          <h4>🎯 赔率 / 真实概率</h4>
          <div class="form-row">
            <input id="opYesOdds" type="number" step="0.01" placeholder="YES 赔率" />
            <input id="opNoOdds" type="number" step="0.01" placeholder="NO 赔率" />
          </div>
          <div class="form-group"><input id="opImplied" type="number" step="1" min="1" max="99" placeholder="或直接填 YES 概率 %（1-99）" /></div>
          <div class="ops-btns">
            <button class="btn btn-primary btn-sm" id="opOddsSet">保存赔率</button>
            <button class="btn btn-ghost btn-sm" id="opOddsClear">清除</button>
          </div>
          <div style="margin-top:10px">
            <label style="font-size:12px;color:var(--text-mute)">头部概率来源</label>
            <div class="src-toggle" id="opSrcToggle">
              <button data-src="lmsr">市场价</button><button data-src="odds">赔率</button>
            </div>
          </div>
        </div>
      </div>
      <div class="form-err" id="opErr"></div>
      <p style="font-size:12px;color:var(--text-mute);margin-top:6px">提示：纯房间号需配合选择平台；「赔率」与「YES 概率」二选一填写即可。</p>
    </div>`;

  const sel = $('#aCat');
  sel.innerHTML = Object.entries(state.categories).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('') || `<option value="biz">行业动态</option>`;
  $('#aP').oninput = (e) => $('#pShow').textContent = e.target.value + '%';
  $('#aSource').onchange = (e) => { $('#oddsFields').style.display = e.target.value === 'odds' ? '' : 'none'; };

  // 把「链接或房间号」拆成 live 载荷
  function buildLive(raw, platform, status) {
    raw = (raw || '').trim();
    if (!raw) return undefined;
    const isUrl = /^https?:/i.test(raw) || /[./]/.test(raw);
    return isUrl
      ? { url: raw, platform: platform || undefined, status }
      : { roomId: raw, platform: platform || 'other', status };
  }

  $('#createBtn').onclick = async () => {
    const title = $('#aTitle').value.trim();
    const errEl = $('#aErr'); errEl.textContent = '';
    if (!title) return errEl.textContent = '请填写标题';
    const source = $('#aSource').value;
    let odds;
    if (source === 'odds') {
      const yo = Number($('#aYesOdds').value), no = Number($('#aNoOdds').value);
      if (!(yo > 1) || !(no > 1)) return errEl.textContent = '真实赔率模式需填写有效的 YES/NO 十进制赔率（均需 > 1）';
      odds = { yesOdds: yo, noOdds: no };
    }
    const live = buildLive($('#aLive').value, $('#aLivePlat').value, $('#aLiveStatus').value);
    try {
      await api('/admin/markets', { method: 'POST', body: {
        title, category: $('#aCat').value, description: $('#aDesc').value.trim(),
        b: Number($('#aB').value), initialYes: Number($('#aP').value) / 100,
        live, odds, priceSource: source,
      }});
      toast('市场已创建', 'ok'); renderAdmin();
    } catch (e) { errEl.textContent = e.message; }
  };

  /* ---- 运营面板：更新已有市场 ---- */
  const opErr = $('#opErr');
  const opId = () => Number($('#opMarket').value);
  const opDone = (msg) => { toast(msg, 'ok'); renderAdmin(); };
  try {
    const { markets: allM } = await api('/markets');
    const opSel = $('#opMarket');
    opSel.innerHTML = allM.length
      ? allM.map((m) => `<option value="${m.id}">#${m.id} ${esc(m.title)}${m.priceSource === 'odds' ? '（赔率）' : ''}</option>`).join('')
      : `<option value="">暂无市场</option>`;
  } catch { /* ignore */ }

  $('#opLiveSet').onclick = async () => {
    opErr.textContent = '';
    const live = buildLive($('#opLive').value, $('#opLivePlat').value, $('#opLiveStatus').value);
    if (!live) return opErr.textContent = '请填写直播链接或房间号';
    try { await api(`/admin/markets/${opId()}/live`, { method: 'POST', body: live }); opDone('直播已更新'); }
    catch (e) { opErr.textContent = e.message; }
  };
  $('#opLiveClear').onclick = async () => {
    try { await api(`/admin/markets/${opId()}/live`, { method: 'POST', body: { clear: true } }); opDone('已清除直播'); }
    catch (e) { opErr.textContent = e.message; }
  };
  $('#opOddsSet').onclick = async () => {
    opErr.textContent = '';
    const yo = Number($('#opYesOdds').value), no = Number($('#opNoOdds').value);
    const imp = Number($('#opImplied').value);
    let body;
    if (yo > 1 && no > 1) body = { yesOdds: yo, noOdds: no };
    else if (imp >= 1 && imp <= 99) body = { impliedYes: imp / 100 };
    else return opErr.textContent = '填写 YES/NO 赔率（均 >1），或直接填 YES 概率 %（1-99）';
    try { await api(`/admin/markets/${opId()}/odds`, { method: 'POST', body }); opDone('赔率已更新'); }
    catch (e) { opErr.textContent = e.message; }
  };
  $('#opOddsClear').onclick = async () => {
    try { await api(`/admin/markets/${opId()}/odds`, { method: 'POST', body: { clear: true } }); opDone('已清除赔率'); }
    catch (e) { opErr.textContent = e.message; }
  };
  $('#opSrcToggle').querySelectorAll('button').forEach((b) => b.onclick = async () => {
    opErr.textContent = '';
    try { await api(`/admin/markets/${opId()}/source`, { method: 'POST', body: { source: b.dataset.src } }); opDone(`已切换为${b.dataset.src === 'odds' ? '赔率' : '市场价'}`); }
    catch (e) { opErr.textContent = e.message; }
  });

  try {
    const { markets } = await api('/markets?status=open');
    const box = $('#resolveList');
    box.innerHTML = markets.length ? markets.map((m) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border-soft)">
        <div style="font-size:13px;margin-bottom:8px">${esc(m.title)}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-yes btn-sm" data-r="yes" data-id="${m.id}">判 YES</button>
          <button class="btn btn-no btn-sm" data-r="no" data-id="${m.id}">判 NO</button>
        </div>
      </div>`).join('') : `<p style="color:var(--text-mute);font-size:13px">没有进行中的市场</p>`;
    box.querySelectorAll('[data-r]').forEach((b) => b.onclick = async () => {
      if (!confirm(`确认将该市场结算为 ${b.dataset.r.toUpperCase()}？该操作不可撤销。`)) return;
      try { const r = await api(`/admin/markets/${b.dataset.id}/resolve`, { method: 'POST', body: { outcome: b.dataset.r } });
        toast(`已结算，向 ${r.winners} 位用户兑付 ${fmt(r.paidTotal)} 币`, 'ok'); renderAdmin(); }
      catch (e) { toast(e.message, 'err'); }
    });
  } catch (e) { toast(e.message, 'err'); }
}

/* ============================ 登录 / 注册 ============================ */
function openAuth(tab = 'login') {
  const node = el(`
    <div>
      <div class="modal-head"><h2>${tab === 'login' ? '登录' : '注册'} hryemarket</h2><button class="close-x" id="aClose">✕</button></div>
      <div class="modal-body">
        <div class="auth-tabs">
          <button data-t="login" class="${tab === 'login' ? 'active' : ''}">登录</button>
          <button data-t="register" class="${tab === 'register' ? 'active' : ''}">注册</button>
        </div>
        <div id="authForm"></div>
      </div>
    </div>`);
  openModal(node, { small: true });
  $('#aClose').onclick = closeModal;
  const draw = (t) => {
    node.querySelectorAll('.auth-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
    renderAuthForm($('#authForm'), t);
  };
  node.querySelectorAll('.auth-tabs button').forEach((b) => b.onclick = () => draw(b.dataset.t));
  draw(tab);
}

function renderAuthForm(root, tab) {
  root.innerHTML = `
    ${tab === 'register' ? `<div class="form-group"><label>昵称（选填）</label><input id="fNick" placeholder="你的显示名" maxlength="20" /></div>` : ''}
    <div class="form-group"><label>邮箱</label><input id="fEmail" type="email" placeholder="you@example.com" /></div>
    <div class="form-group"><label>密码</label><input id="fPass" type="password" placeholder="${tab === 'register' ? '至少 6 位' : '请输入密码'}" /></div>
    <div class="form-err" id="fErr"></div>
    <button class="btn btn-primary btn-block" id="fSubmit">${tab === 'login' ? '登录' : '注册并领取 1000 币'}</button>`;

  const submit = async () => {
    const email = $('#fEmail', root).value.trim();
    const password = $('#fPass', root).value;
    const nickname = tab === 'register' ? $('#fNick', root).value.trim() : undefined;
    const errEl = $('#fErr', root); errEl.textContent = '';
    const btn = $('#fSubmit', root); btn.disabled = true;
    try {
      const r = await api(`/${tab}`, { method: 'POST', body: { email, password, nickname } });
      state.token = r.token; state.user = r.user;
      localStorage.setItem('hm_token', r.token);
      closeModal(); renderTopbar();
      toast(tab === 'login' ? `欢迎回来，${r.user.nickname}` : `注册成功，已赠送 1000 币`, 'ok');
      route();
    } catch (e) { errEl.textContent = e.message; btn.disabled = false; }
  };
  $('#fSubmit', root).onclick = submit;
  root.querySelectorAll('input').forEach((i) => i.onkeydown = (e) => { if (e.key === 'Enter') submit(); });
}

/* ============================ Canvas 图表 ============================ */
function prepCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.width, h = rect.height || canvas.height;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

function drawSparkline(canvas, history) {
  if (!canvas || !history?.length) return;
  const { ctx, w, h } = prepCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const ys = history.map((p) => p.yes);
  const pad = 3;
  const x = (i) => pad + (i / (ys.length - 1 || 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - v) * (h - pad * 2);
  const up = ys[ys.length - 1] >= ys[0];
  const color = up ? '#2DD4BF' : '#FB7185';

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '3a'); grad.addColorStop(1, color + '00');
  ctx.beginPath();
  ys.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.lineTo(x(ys.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  ys.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.stroke();
}

function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function drawChart(canvas, history, color = '#2DD4BF') {
  if (!canvas || !history?.length) return;
  const { ctx, w, h } = prepCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const [r, g, bl] = hexRgb(color);
  const padL = 34, padR = 12, padT = 12, padB = 22;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const ys = history.map((p) => p.yes);
  const x = (i) => padL + (i / (ys.length - 1 || 1)) * plotW;
  const y = (v) => padT + (1 - v) * plotH;

  // 网格 & 刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  ctx.fillStyle = '#6B7688'; ctx.font = '11px monospace'; ctx.textBaseline = 'middle';
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    ctx.fillText((v * 100) + '%', 4, yy);
  });

  // 面积
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, `rgba(${r},${g},${bl},0.28)`); grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
  ctx.beginPath();
  ys.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.lineTo(x(ys.length - 1), padT + plotH); ctx.lineTo(x(0), padT + plotH); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // 主线
  ctx.beginPath();
  ys.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  // 末点
  const lx = x(ys.length - 1), ly = y(ys[ys.length - 1]);
  ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(lx, ly, 7, 0, Math.PI * 2); ctx.fillStyle = `rgba(${r},${g},${bl},0.2)`; ctx.fill();
}

/* ============================ 启动 ============================ */
async function boot() {
  if (state.token) {
    try { const { user } = await api('/me'); state.user = user; }
    catch { state.token = null; localStorage.removeItem('hm_token'); }
  }
  renderTopbar();
  route();
}
boot();