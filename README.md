# hryemarket-github.com
# hryemarket · 中国游戏电竞预测市场

一个 Polymarket 风格的预测市场，专注中国大陆游戏 / 电竞行业议题（王者荣耀 KPL、无畏契约、和平精英、三角洲行动、行业动态）。用**平台币**下注，平台币可在用户间转账，**不可提现、不与法定货币挂钩**，纯娱乐预测。

- 后端：Node.js + Express，JSON 文件持久化
- 定价：**LMSR 对数市场做市商**（真实的预测市场机制，价格 = 隐含概率，会随下注实时变动）
- 鉴权：邮箱注册 / 登录 + JWT
- 前端：原生 HTML/CSS/JS，暗色电竞风，Canvas 概率走势图

## 快速开始（Windows）

在 Command Prompt（cmd，不是 PowerShell）里，进入项目目录后：

```
npm install
npm run seed      :: 生成管理员账号 + 8 个示例市场（只需首次运行）
npm start
```

然后浏览器打开 http://localhost:3000

> 你的 Node 装在 `D:\npx` 这类非标准路径也没关系，只要 `node -v` 能在 cmd 里正常输出即可。若提示 `node 不是内部命令`，需把 Node 所在目录加入系统 PATH。

### 默认管理员账号

| 邮箱 | 密码 |
|---|---|
| `admin@hrye.market` | `admin123456` |

管理员登录后顶栏会出现「管理」入口，可**创建市场**和**结算市场**（判定 YES/NO，自动给获胜方按每份 1 币兑付）。可用环境变量 `ADMIN_EMAIL` / `ADMIN_PASS` 覆盖默认值再跑 seed。

## 功能一览

- **邮箱注册 / 登录**，注册即送 1000 平台币
- **市场列表**：分类筛选、YES 概率、迷你走势 sparkline、成交额
- **市场详情**：大号 Canvas 概率曲线、YES/NO 买入卖出、实时成交估算、持仓显示
- **我的持仓**：各市场 YES/NO 份额、当前估值、累计投入
- **钱包**：余额、每日签到（+500 / 24h）、**按 UID 转账**、交易流水
- **可跳转直播**：市场可挂虎牙 / 斗鱼 / B站 / 抖音直播间，卡片与详情页显示「直播中 / 即将开始 / 已结束」状态角标，一键跳转观看
- **真实概率可切换**：每个市场的头部概率可在「市场价（LMSR 内生）」与「真实赔率（去水隐含概率）」之间切换；赔率支持直接喂十进制赔率或直接喂概率数字
- **管理面板**：创建市场（初始概率 / 流动性 / 直播 / 赔率）、结算兑付、**运营面板**（对已有市场随时更新直播、赔率、概率来源）

## 项目结构

```
hryemarket/
├─ server/
│  ├─ index.js        Express 主服务与全部 API 路由
│  ├─ lmsr.js         LMSR 做市商定价（价格/成本/买入/卖出，含闭式反解）
│  ├─ db.js           JSON 文件持久化（data/db.json）
│  ├─ matchSource.js  赛事赛程/赛果适配层——接真实电竞数据源（自动开盘/结算）
│  ├─ oddsSource.js   赔率/真实概率适配层——去水换算、直接喂概率、provider 注册
│  ├─ liveSource.js   直播适配层——平台识别、房间链接生成、（可选）自动状态
│  └─ seed.js         初始化管理员与示例市场
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js          前端全部逻辑（路由/交易面板/图表）
├─ data/db.json       运行后自动生成（用户、市场、持仓、流水）
└─ package.json
```

## 定价机制（LMSR 简述）

每个二元市场维护 YES/NO 两种份额净持仓 `qYes / qNo` 和流动性参数 `b`：

- YES 价格（即隐含概率）：`pYes = e^(qYes/b) / (e^(qYes/b) + e^(qNo/b))`
- 买入花费 = 成本函数 `C = b·ln(e^(qYes/b)+e^(qNo/b))` 的增量
- `b` 越大盘口越深、单笔下注对价格的冲击越小

结算时，持有获胜方份额的用户按 **每份额兑付 1 平台币**。

## 接入真实数据（三条独立通道）

> 现实前提：**不存在免费公开的「真实获胜概率 API」**。博彩赔率是庄家精算＋盘口调整的结果，国内 KPL/三角洲的官方赛程赛果也无免费开放接口。因此按下面三条通道分别落地，每条都做成了适配层，可独立替换、互不影响。

**1. 赛程 / 赛果（自动开盘 + 自动结算）——`server/matchSource.js`**
实现 `listUpcoming()` 与 `resolveMarket(market)` 并 `registerProvider(...)` 即可。数据源可选：官方赛事页爬虫、第三方电竞数据商（PandaScore 覆盖瓦/吃鸡，KPL 需国内数据商）。当前为手动 provider + seed。

**2. 真实概率（可与 LMSR 市场价切换）——`server/oddsSource.js`**
每个市场的 `priceSource` 可为 `'lmsr'`（用户下注内生，Polymarket 同款）或 `'odds'`（外部赔率去水后的隐含概率）。喂数据两种方式：
- 喂十进制赔率 `{yesOdds, noOdds}`，模块自动 **去水(de-vig)** 归一化成隐含概率；
- 直接喂概率 `{impliedYes: 0~1}`，用于对接自建模型或数据商的概率输出。
接第三方赔率 API：实现 `fetchImplied(market)` 并 `registerProvider('xxx', impl)`，把市场 `oddsProvider` 设为 `'xxx'`。**交易与结算始终走 LMSR**，赔率只作为头部展示的参考概率，因此平台币经济学不受影响。

**3. 直播间跳转 + 状态——`server/liveSource.js`**
管理员填直播链接或「平台＋房间号」，自动生成跳转地址（虎牙/斗鱼/B站/抖音）。直播状态默认手动设置；想自动显示「直播中」需实现 `fetchStatus(live)` 并 `registerStatusProvider(platform, impl)`，在其中调用各平台房间信息接口（示例见文件注释）。**注意这些平台接口要在你自己的服务器请求**（本项目沙箱无法外连），且可能需处理反爬。

## 关键 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` `/api/login` | 邮箱注册 / 登录 |
| GET | `/api/me` | 当前用户 |
| GET | `/api/markets` `/api/markets/:id` | 市场列表 / 详情 |
| POST | `/api/markets/:id/bet` | 按金额下注（LMSR 计算份额） |
| POST | `/api/markets/:id/sell` | 按份额卖出 |
| GET | `/api/portfolio` | 我的持仓 |
| POST | `/api/transfer` | 按 UID 转账 |
| POST | `/api/daily` | 每日签到 |
| GET | `/api/txns` | 我的流水 |
| POST | `/api/admin/markets` | （管理员）创建市场（可带 live / odds / priceSource） |
| POST | `/api/admin/markets/:id/resolve` | （管理员）结算 |
| POST | `/api/admin/markets/:id/live` | （管理员）设置/更新/清除直播间 |
| POST | `/api/admin/markets/:id/odds` | （管理员）录入赔率或直接概率 / 清除 |
| POST | `/api/admin/markets/:id/source` | （管理员）切换头部概率来源 lmsr↔odds |

## 生产部署注意

- 用环境变量设置 `JWT_SECRET`（默认值仅供本地开发）
- JSON 文件持久化适合原型；上量后建议换 SQLite / Postgres
- LMSR 做市商会在极端行情下产生做市盈亏，平台币不可提现所以无金融风险

---

平台币为虚拟积分，仅供娱乐，不可提现、不与任何法定货币或加密资产挂钩。s
