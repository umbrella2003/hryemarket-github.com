'use strict';

/**
 * 直播适配层
 * ----------------------------------------------------------
 * 目的：给预测市场挂上「可跳转的直播间」，并（可选）显示直播状态。
 *
 * 跳转：主流平台房间号即链接，管理员填房间号或整条链接都行。
 *   虎牙   https://www.huya.com/{房间号}
 *   斗鱼   https://www.douyu.com/{房间号}
 *   B站    https://live.bilibili.com/{房间号}
 *   抖音   无稳定网页房间号规律 -> 直接存整条分享链接
 *
 * 状态(直播中/即将开始/已结束)：
 *   默认「手动」——由管理员设置 market.live.status。
 *   想自动：实现 fetchStatus(live) 接口并 registerStatusProvider，
 *   在里面调用各平台房间信息接口（示例见下方注释）。注意这些接口需要
 *   在你自己的服务器上请求（本项目沙箱无法外连），且可能需要处理反爬。
 */

const PLATFORMS = {
  huya: { label: '虎牙', color: '#FFB300', base: 'https://www.huya.com/' },
  douyu: { label: '斗鱼', color: '#FF7700', base: 'https://www.douyu.com/' },
  bili: { label: 'B站直播', color: '#FB7299', base: 'https://live.bilibili.com/' },
  douyin: { label: '抖音', color: '#00E5D4', base: null }, // 直接用整条链接
  other: { label: '直播', color: '#7C6CF5', base: null },
};

const STATUS = {
  live: { label: '直播中', color: '#FB7185' },
  upcoming: { label: '即将开始', color: '#F5B841' },
  ended: { label: '已结束', color: '#6B7688' },
};

/** 从一条 URL 猜测平台。 */
function detectPlatform(url = '') {
  const u = String(url).toLowerCase();
  if (u.includes('huya.com')) return 'huya';
  if (u.includes('douyu.com')) return 'douyu';
  if (u.includes('bilibili.com')) return 'bili';
  if (u.includes('douyin.com')) return 'douyin';
  return 'other';
}

/**
 * 标准化直播信息，挂到 market.live 上。
 * @param {{platform?, roomId?, url?, status?}} input
 *   - 传 roomId + platform：自动拼出链接
 *   - 传整条 url：自动识别平台
 */
function normalizeLive(input = {}) {
  if (!input || (!input.url && !input.roomId)) return null;
  let platform = input.platform && PLATFORMS[input.platform] ? input.platform : null;
  let url = input.url ? String(input.url).trim() : '';

  if (!platform) platform = url ? detectPlatform(url) : 'other';
  const meta = PLATFORMS[platform];

  // 只给了房间号 + 已知平台 -> 拼链接
  if (!url && input.roomId && meta.base) {
    url = meta.base + String(input.roomId).trim();
  }
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const status = STATUS[input.status] ? input.status : 'upcoming';
  return {
    platform,
    label: meta.label,
    color: meta.color,
    url,
    status,
    statusLabel: STATUS[status].label,
    statusColor: STATUS[status].color,
  };
}

/* ----------------------- 自动状态 provider（可选） ----------------------- */
/*
 * 示例（伪代码，需在你自己的服务器实现）：
 *
 *   registerStatusProvider('huya', {
 *     async fetchStatus(live) {
 *       const roomId = live.url.split('huya.com/')[1];
 *       const r = await fetch(`https://.../room/${roomId}`);  // 平台房间信息接口
 *       const j = await r.json();
 *       return j.isLive ? 'live' : 'ended';
 *     }
 *   });
 *
 * 然后加一个定时任务周期性调用 refreshStatus() 更新 market.live.status。
 */
const statusProviders = {};
function registerStatusProvider(platform, impl) {
  statusProviders[platform] = impl;
}
async function fetchStatus(live) {
  if (!live) return null;
  const p = statusProviders[live.platform];
  if (!p) return live.status; // 无自动 provider -> 沿用手动状态
  try {
    return await p.fetchStatus(live);
  } catch (e) {
    console.error(`[liveSource] ${live.platform} fetchStatus 失败:`, e.message);
    return live.status;
  }
}

module.exports = {
  PLATFORMS,
  STATUS,
  detectPlatform,
  normalizeLive,
  registerStatusProvider,
  fetchStatus,
};