'use strict';

/**
 * 赔率 / 真实概率适配层
 * ----------------------------------------------------------
 * 目的：让「真实概率」的来源与平台其它逻辑解耦，并可与内生的 LMSR 市场价
 *      随时切换（priceSource: 'lmsr' | 'odds'）。
 *
 * 关键事实（务必了解）：
 *   - 不存在「免费公开的真实获胜概率 API」。博彩公司赔率是精算+盘口调整的结果。
 *   - 因此真实概率有两条来路：
 *       A. 喂十进制赔率(decimal odds)，本模块自动「去水(de-vig)」换算成隐含概率；
 *       B. 直接喂一个概率数字(0~1)，用于对接自建模型 / 第三方数据商的概率输出。
 *
 * 约定接口（provider）：
 *   fetchImplied(market) -> { impliedYes, yesOdds, noOdds, overround, provider, updatedAt } | null
 *
 * 现内置 manual provider：读取管理员写在 market.odds 上的数据。
 * 将来接 PandaScore / 博彩数据商时：实现同名接口并 registerProvider('xxx', impl)，
 * 然后把市场的 market.oddsProvider 设为 'xxx' 即可，无需改动 index.js。
 */

/**
 * 十进制赔率去水：把 1/odds 归一化，抵消庄家水位(overround)。
 * @example devig(1.55, 2.45) -> impliedYes≈0.612
 */
function devig(yesOdds, noOdds) {
  const iy = 1 / yesOdds;
  const ino = 1 / noOdds;
  const s = iy + ino; // 通常 > 1，多出来的就是水位
  return {
    impliedYes: iy / s,
    impliedNo: ino / s,
    overround: s - 1,
  };
}

/** 由概率反推「公平赔率」(仅用于展示，无水位)。 */
function fairOdds(p) {
  const q = Math.min(0.99, Math.max(0.01, p));
  return { yesOdds: 1 / q, noOdds: 1 / (1 - q) };
}

/**
 * 把一次赔率/概率录入标准化成挂到 market.odds 上的对象。
 * 接受两种输入：
 *   { yesOdds, noOdds }  -> 去水得隐含概率
 *   { impliedYes }       -> 直接给概率(0~1)，反推公平赔率用于展示
 */
function normalizeOdds(input, providerName = 'manual') {
  const now = Date.now();
  if (input && input.impliedYes != null && input.yesOdds == null) {
    const p = Math.min(0.99, Math.max(0.01, Number(input.impliedYes)));
    const fo = fairOdds(p);
    return {
      provider: providerName,
      yesOdds: round(fo.yesOdds),
      noOdds: round(fo.noOdds),
      impliedYes: p,
      impliedNo: 1 - p,
      overround: 0,
      updatedAt: now,
    };
  }
  const yesOdds = Number(input.yesOdds);
  const noOdds = Number(input.noOdds);
  if (!(yesOdds > 1) || !(noOdds > 1)) {
    throw new Error('十进制赔率需大于 1（YES 与 NO 各一个）');
  }
  const d = devig(yesOdds, noOdds);
  return {
    provider: providerName,
    yesOdds: round(yesOdds),
    noOdds: round(noOdds),
    impliedYes: d.impliedYes,
    impliedNo: d.impliedNo,
    overround: round(d.overround),
    updatedAt: now,
  };
}

function round(n) { return Math.round(n * 10000) / 10000; }

/* -------------------------- provider 注册表 -------------------------- */

const manualProvider = {
  name: 'manual',
  // 直接读管理员写在市场上的赔率
  async fetchImplied(market) {
    return market.odds || null;
  },
};

const providers = { manual: manualProvider };

function registerProvider(name, impl) {
  providers[name] = { name, ...impl };
}

/**
 * 取某市场当前的隐含概率来源数据。
 * 现在 manual 是同步读取；接真实 API 的 provider 可在这里做网络请求。
 */
async function fetchImplied(market) {
  const p = providers[market.oddsProvider] || providers.manual;
  try {
    return await p.fetchImplied(market);
  } catch (e) {
    console.error(`[oddsSource] provider ${p.name} fetchImplied 失败:`, e.message);
    return market.odds || null;
  }
}

module.exports = {
  devig,
  fairOdds,
  normalizeOdds,
  registerProvider,
  fetchImplied,
  listProviders: () => Object.keys(providers),
};