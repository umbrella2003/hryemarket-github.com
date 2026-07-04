'use strict';

/**
 * 赛事数据适配层
 * ----------------------------------------------------------
 * 目的：把「市场从哪来、怎么结算」和平台其它逻辑解耦。
 * 现在用内置的种子数据；将来接入真实电竞数据源（KPL/瓦/和平精英/三角洲
 * 的赛程与赛果 API）时，只需实现同样的接口，无需改动 index.js。
 *
 * 约定接口：
 *   listUpcoming()          -> 返回可创建为市场的赛事/议题数组
 *   resolveMarket(market)   -> 返回 'yes' | 'no' | null（null=尚未有结果）
 *
 * 每个 provider 用 category 标识（对应游戏）：
 *   kpl   王者荣耀职业联赛
 *   val   无畏契约 (Valorant)
 *   pubgm 和平精英 (PUBG Mobile)
 *   delta 三角洲行动 (Delta Force)
 *   biz   行业/大盘类议题
 */

const CATEGORIES = {
  kpl: { label: '王者荣耀 · KPL', color: '#F5B841' },
  val: { label: '无畏契约', color: '#FF4655' },
  pubgm: { label: '和平精英', color: '#5AC8FA' },
  delta: { label: '三角洲行动', color: '#7C6CF5' },
  biz: { label: '行业动态', color: '#2DD4BF' },
};

/**
 * 示例 provider：手动/静态。真实接入时可替换为拉取远端 API 的实现。
 * resolve 返回 null 表示交给管理员手动结算（当前默认行为）。
 */
const manualProvider = {
  name: 'manual',
  async listUpcoming() {
    return []; // 由 seed.js 直接写入初始市场
  },
  async resolveMarket(_market) {
    return null;
  },
};

const providers = [manualProvider];

/** 将来在这里注册真实数据源，例如：providers.push(kplProvider) */
function registerProvider(p) {
  providers.push(p);
}

async function listUpcoming() {
  const all = [];
  for (const p of providers) {
    try {
      const items = await p.listUpcoming();
      all.push(...items.map((i) => ({ ...i, _source: p.name })));
    } catch (e) {
      console.error(`[matchSource] provider ${p.name} listUpcoming 失败:`, e.message);
    }
  }
  return all;
}

async function resolveMarket(market) {
  for (const p of providers) {
    try {
      const r = await p.resolveMarket(market);
      if (r === 'yes' || r === 'no') return r;
    } catch (e) {
      console.error(`[matchSource] provider ${p.name} resolve 失败:`, e.message);
    }
  }
  return null;
}

module.exports = { CATEGORIES, registerProvider, listUpcoming, resolveMarket };
