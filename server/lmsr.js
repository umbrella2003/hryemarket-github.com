'use strict';

/**
 * LMSR —— 对数市场评分规则做市商 (Logarithmic Market Scoring Rule)
 * 这是 Polymarket / 各类预测市场常用的自动做市机制。
 *
 * 一个二元市场持有两种份额：YES 与 NO。
 *   qYes / qNo  = 市场当前净持仓份额
 *   b           = 流动性参数，越大价格越稳、滑点越小
 *
 * 价格（即隐含概率）：
 *   pYes = e^(qYes/b) / (e^(qYes/b) + e^(qNo/b))
 * 成本函数：
 *   C(q) = b * ln( e^(qYes/b) + e^(qNo/b) )
 * 买入 shares 份 outcome 的花费 = C(new) - C(old)
 *
 * 全部用 log-sum-exp 稳定化，避免 e^x 溢出。
 */

function logSumExp(a, b) {
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

function cost(qYes, qNo, b) {
  return b * logSumExp(qYes / b, qNo / b);
}

/** 当前 YES 概率（0~1）。 */
function priceYes(qYes, qNo, b) {
  const m = Math.max(qYes / b, qNo / b);
  const eYes = Math.exp(qYes / b - m);
  const eNo = Math.exp(qNo / b - m);
  return eYes / (eYes + eNo);
}

function prices(market) {
  const p = priceYes(market.qYes, market.qNo, market.b);
  return { yes: p, no: 1 - p };
}

/**
 * 给定要花费的金额 spend，反解能买到多少份 outcome 份额。
 * 闭式解，见文件顶部推导。
 * @returns 份额数（正数）
 */
function sharesForSpend(market, outcome, spend) {
  const { qYes, qNo, b } = market;
  const mx = Math.max(qYes / b, qNo / b);
  const A = Math.exp(qYes / b - mx); // ∝ e^(qYes/b)
  const B = Math.exp(qNo / b - mx);  // ∝ e^(qNo/b)
  const eS = Math.exp(spend / b);

  let delta;
  if (outcome === 'yes') {
    // e^(d/b) = ((A+B)*e^(S/b) - B) / A
    delta = b * Math.log(((A + B) * eS - B) / A);
  } else {
    delta = b * Math.log(((A + B) * eS - A) / B);
  }
  return delta;
}

/**
 * 按“花费金额”买入。返回买到的份额、成交均价、以及买入后的新持仓。
 */
function buyWithSpend(market, outcome, spend) {
  const shares = sharesForSpend(market, outcome, spend);
  const before = cost(market.qYes, market.qNo, market.b);
  const nextYes = outcome === 'yes' ? market.qYes + shares : market.qYes;
  const nextNo = outcome === 'no' ? market.qNo + shares : market.qNo;
  const after = cost(nextYes, nextNo, market.b);
  const actualCost = after - before; // ≈ spend
  return {
    shares,
    cost: actualCost,
    avgPrice: actualCost / shares,
    qYes: nextYes,
    qNo: nextNo,
  };
}

/**
 * 按“份额数”卖出（把份额还给做市商换回平台币）。
 * @returns { proceeds, qYes, qNo }
 */
function sellShares(market, outcome, shares) {
  const before = cost(market.qYes, market.qNo, market.b);
  const nextYes = outcome === 'yes' ? market.qYes - shares : market.qYes;
  const nextNo = outcome === 'no' ? market.qNo - shares : market.qNo;
  const after = cost(nextYes, nextNo, market.b);
  const proceeds = before - after; // 卖出得回的币
  return { proceeds, qYes: nextYes, qNo: nextNo };
}

module.exports = {
  cost,
  priceYes,
  prices,
  sharesForSpend,
  buyWithSpend,
  sellShares,
};
