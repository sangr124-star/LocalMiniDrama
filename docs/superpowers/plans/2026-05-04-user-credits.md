# 用户积分体系 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 miniDrama 加上用户积分账户：所有 AI 调用通过 reserve→settle/refund 状态机扣费，余额不足 402 拦截，super_admin 维护计价表，admin 给自己创建的 user 充值，新用户注册赠送 5000 积分。

**Architecture:** `creditService` 提供原子化的 reserve/settle/refund/grant/deduct + 计价表查询；`withCredits` 高阶包装器把状态机封装一处，套在 `aiClient` / `imageClient` / `videoClient` / `ttsService` 的对外导出函数上；新增 `/credits/*` 路由 + 全局 402 错误中间件；前端加顶部余额 badge、我的积分页、用户管理列扩展、积分管理页（super_admin）、402 全局拦截弹窗。所有 AI 调用方必须显式传 `user_id`，由 wrapper 强校验。

**Tech Stack:** Node.js + Express + better-sqlite3（后端），Vue 3 + Vite + Pinia（前端）。沿用现有 SQL 文件迁移机制（`backend-node/migrations/*.sql`，最新已到 22）。

参考 spec：`docs/superpowers/specs/2026-05-04-user-credits-design.md`

---

## 文件结构

**新建（后端）：**
- `backend-node/migrations/23_user_credits.sql` — 表结构 + 计价表种子数据 + 全局设置
- `backend-node/src/errors/InsufficientCreditsError.js` — 402 自定义错误类
- `backend-node/src/services/creditPricing.js` — 计价 estimator/settler 纯函数
- `backend-node/src/services/creditService.js` — 余额/流水/状态机
- `backend-node/src/services/creditWrapper.js` — `withCredits` 高阶包装器
- `backend-node/src/routes/credits.js` — `/credits/*` 路由组
- `backend-node/src/middleware/creditError.js` — Express 全局 402 错误中间件

**修改（后端）：**
- `backend-node/src/services/aiClient.js` — 流式补 `stream_options.include_usage`，对外导出包装；解析 SSE 时透传最后一条 `usage`
- `backend-node/src/services/imageClient.js` — 对外导出包装
- `backend-node/src/services/videoClient.js` — 对外导出包装
- `backend-node/src/services/ttsService.js` — 对外导出包装；同时清理已存在的孤儿 `cs.reportUsage`
- `backend-node/src/services/userService.js` — `createUser` 接 `created_by` 参数；新增 grant 触发钩子
- `backend-node/src/routes/index.js` — 挂载 credits 路由 + 错误中间件
- `backend-node/src/routes/auth.js` — 注册赠送（如该处控制注册逻辑）
- `backend-node/src/routes/admin.js`（或 user 管理路由）— `createUser` 写入 `created_by` + 注册赠送
- 各 caller（`storyboardService.js` / `propImageGenerationService.js` 等）— 自顶向下贯通 `user_id`

**新建（前端）：**
- `frontweb/src/views/MyCredits.vue` — 我的积分页
- `frontweb/src/views/AdminCredits.vue` — 积分管理（super_admin）
- `frontweb/src/components/CreditBalanceBadge.vue` — 顶部余额徽章
- `frontweb/src/components/InsufficientCreditsModal.vue` — 402 弹窗
- `frontweb/src/components/GrantCreditsDialog.vue` — 充值/扣减对话框
- `frontweb/src/api/credits.js` — 前端 API 封装

**修改（前端）：**
- `frontweb/src/router/index.js` — 加 `/my/credits` 和 `/admin/credits` 两条路由
- `frontweb/src/utils/request.js`（或 axios 实例所在）— 全局 402 拦截
- `frontweb/src/views/UserManagement.vue` — 加余额列 + 行内充值/扣减/流水操作
- `frontweb/src/App.vue` 或 layout 顶部组件 — 嵌入余额 badge
- `frontweb/src/stores/user.js` — 加 `creditBalance` 字段，登录后拉取

---

## Task 1：迁移 + 种子数据

**Files:**
- Create: `backend-node/migrations/23_user_credits.sql`

- [ ] **Step 1：写迁移 SQL**

```sql
-- 23_user_credits.sql：用户积分体系
-- users 加列
ALTER TABLE users ADD COLUMN credit_balance         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_recharged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_consumed  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN created_by             INTEGER;

-- 流水表
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL,
  scope           TEXT,
  service_type    TEXT,
  model           TEXT,
  estimated       INTEGER NOT NULL DEFAULT 0,
  real_cost       INTEGER NOT NULL DEFAULT 0,
  price_snapshot  TEXT,
  drama_id        INTEGER,
  episode_id      INTEGER,
  scene_key       TEXT,
  operator_id     INTEGER,
  note            TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user   ON credit_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_status ON credit_ledger(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_scope  ON credit_ledger(scope, created_at DESC);

-- 计价表
CREATE TABLE IF NOT EXISTS credit_pricing (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_type    TEXT NOT NULL,
  model           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  price           INTEGER NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(service_type, model, unit)
);

-- 计价表种子数据（保守估算，super_admin 后续可在 UI 调整）
INSERT OR IGNORE INTO credit_pricing (service_type, model, unit, price, note, created_at, updated_at) VALUES
  ('text','*','per_1k_input',  10, '兜底单价（输入）','2026-05-04','2026-05-04'),
  ('text','*','per_1k_output', 30, '兜底单价（输出）','2026-05-04','2026-05-04'),
  ('text','claude-sonnet-4','per_1k_input',  30, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-sonnet-4','per_1k_output',150, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-opus-4','per_1k_input',  150, NULL,'2026-05-04','2026-05-04'),
  ('text','claude-opus-4','per_1k_output', 750, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o','per_1k_input',  25, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o','per_1k_output',100, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o-mini','per_1k_input',  3, NULL,'2026-05-04','2026-05-04'),
  ('text','gpt-4o-mini','per_1k_output',12, NULL,'2026-05-04','2026-05-04'),
  ('image','*','per_image', 200, '兜底单价','2026-05-04','2026-05-04'),
  ('image','seedream-4','per_image', 200, NULL,'2026-05-04','2026-05-04'),
  ('image','seedream-3','per_image', 150, NULL,'2026-05-04','2026-05-04'),
  ('image','jimeng-3','per_image', 150, NULL,'2026-05-04','2026-05-04'),
  ('image','gemini-2.5-flash-image','per_image', 200, NULL,'2026-05-04','2026-05-04'),
  ('video','*','per_second', 200, '兜底单价','2026-05-04','2026-05-04'),
  ('video','seedance-1080p','per_second', 200, NULL,'2026-05-04','2026-05-04'),
  ('video','seedance-720p','per_second', 100, NULL,'2026-05-04','2026-05-04'),
  ('video','jimeng-video-3','per_second', 200, NULL,'2026-05-04','2026-05-04'),
  ('tts','*','per_1k_chars', 50, '兜底单价','2026-05-04','2026-05-04'),
  ('tts','volcengine-doubao','per_1k_chars', 50, NULL,'2026-05-04','2026-05-04'),
  ('tts','minimax','per_1k_chars', 80, NULL,'2026-05-04','2026-05-04'),
  ('tts','openai-tts','per_1k_chars', 100, NULL,'2026-05-04','2026-05-04');

-- 全局设置（global_settings 复用 KV 模式）
INSERT OR IGNORE INTO global_settings (key, value, updated_at) VALUES
  ('credits.signup_bonus','5000','2026-05-04'),
  ('credits.low_balance_threshold','1000','2026-05-04');
```

- [ ] **Step 2：本地跑迁移**

Run（PowerShell）：
```powershell
cd D:\claude\miniDrama\backend-node
npm run migrate
```
Expected：日志包含 `Ran migration: 23_user_credits.sql #N`（多个 statement 各一条）。

- [ ] **Step 3：sqlite 验证表结构**

Run：
```powershell
node -e "const db=require('better-sqlite3')('./data/drama_generator.db'); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\" AND name LIKE \"credit%\"').all()); console.log(db.prepare('SELECT COUNT(*) c FROM credit_pricing').get()); console.log(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name).filter(n=>n.startsWith(\"credit_\")||n===\"created_by\"));"
```
Expected：含 `credit_ledger`、`credit_pricing`；pricing 行数 ≥ 23；users 列含 4 个新字段。

- [ ] **Step 4：commit**

```bash
git add backend-node/migrations/23_user_credits.sql
git commit -m "feat(db): migration 23 用户积分账户 + 计价表种子"
```

---

## Task 2：错误类 + 计价 estimator/settler

**Files:**
- Create: `backend-node/src/errors/InsufficientCreditsError.js`
- Create: `backend-node/src/services/creditPricing.js`

- [ ] **Step 1：写错误类**

`backend-node/src/errors/InsufficientCreditsError.js`：
```js
class InsufficientCreditsError extends Error {
  constructor({ required, balance, scope, service_type, model }) {
    super('INSUFFICIENT_CREDITS');
    this.code = 'INSUFFICIENT_CREDITS';
    this.statusCode = 402;
    this.required = required;
    this.balance = balance;
    this.shortfall = required - balance;
    this.scope = scope;
    this.service_type = service_type;
    this.model = model;
  }
}
module.exports = { InsufficientCreditsError };
```

- [ ] **Step 2：写计价工具**

`backend-node/src/services/creditPricing.js`：
```js
// 价格查询：先精确匹配 (service_type, model, unit)，未命中走 (service_type, '*', unit) 兜底
function getUnitPrice(db, service_type, model, unit) {
  const row = db.prepare(
    `SELECT price FROM credit_pricing WHERE service_type=? AND model=? AND unit=? AND is_active=1`
  ).get(service_type, model, unit);
  if (row) return row.price;
  const fallback = db.prepare(
    `SELECT price FROM credit_pricing WHERE service_type=? AND model='*' AND unit=? AND is_active=1`
  ).get(service_type, unit);
  return fallback ? fallback.price : 0;
}

// 文本：按 prompt 字节/2 估输入上限，max_tokens 估输出上限
function estimateText(db, opts) {
  const model = opts.model || 'unknown';
  const promptBytes = Buffer.byteLength(
    String(opts.userPrompt || '') + String(opts.systemPrompt || ''),
    'utf-8'
  );
  const inputTokens = Math.ceil(promptBytes / 2);
  const outputTokens = Number(opts.max_tokens) || 4000;
  const inputPrice  = getUnitPrice(db, 'text', model, 'per_1k_input');
  const outputPrice = getUnitPrice(db, 'text', model, 'per_1k_output');
  const estimated = Math.ceil(inputTokens / 1000 * inputPrice)
                  + Math.ceil(outputTokens / 1000 * outputPrice);
  return {
    estimated,
    snapshot: {
      service_type: 'text', model,
      input_unit_price: inputPrice, output_unit_price: outputPrice,
      est_input_tokens: inputTokens, est_output_tokens: outputTokens,
    },
  };
}
function settleText(result, snapshot) {
  // result 由 aiClient 改造后返回 { content, usage }；usage 缺失走全额结算（spec 已约定）
  if (!result || !result.usage) return null; // null 表示按 estimated 全额结算
  const inT = Number(result.usage.prompt_tokens) || 0;
  const outT = Number(result.usage.completion_tokens) || 0;
  return Math.ceil(inT / 1000 * snapshot.input_unit_price)
       + Math.ceil(outT / 1000 * snapshot.output_unit_price);
}

// 图片：按 n × per_image
function estimateImage(db, opts) {
  const model = opts.model || 'unknown';
  const n = Number(opts.n) || 1;
  const price = getUnitPrice(db, 'image', model, 'per_image');
  return {
    estimated: n * price,
    snapshot: { service_type: 'image', model, per_image_price: price, est_n: n },
  };
}
function settleImage(result, snapshot) {
  const realN = (result && Array.isArray(result.images)) ? result.images.length : null;
  if (realN == null) return null;
  return realN * snapshot.per_image_price;
}

// 视频：按 duration_seconds × per_second
function estimateVideo(db, opts) {
  const model = opts.model || 'unknown';
  const seconds = Number(opts.duration_seconds) || 5;
  const price = getUnitPrice(db, 'video', model, 'per_second');
  return {
    estimated: seconds * price,
    snapshot: { service_type: 'video', model, per_second_price: price, est_seconds: seconds },
  };
}
function settleVideo(result, snapshot) {
  const realSec = result && (result.duration_seconds || result.duration);
  if (!realSec) return null;
  return Math.ceil(Number(realSec)) * snapshot.per_second_price;
}

// TTS：按 ceil(text 长度 / 1000) × per_1k_chars
function estimateTts(db, opts) {
  const model = opts.model || 'unknown';
  const chars = String(opts.text || '').length;
  const price = getUnitPrice(db, 'tts', model, 'per_1k_chars');
  const units = Math.max(1, Math.ceil(chars / 1000));
  return {
    estimated: units * price,
    snapshot: { service_type: 'tts', model, per_1k_chars_price: price, est_chars: chars },
  };
}
function settleTts(result, snapshot) {
  // tts 一般无返真实字符数；按 estimated 全额结算
  return null;
}

module.exports = {
  getUnitPrice,
  estimateText, settleText,
  estimateImage, settleImage,
  estimateVideo, settleVideo,
  estimateTts, settleTts,
};
```

- [ ] **Step 3：commit**

```bash
git add backend-node/src/errors/InsufficientCreditsError.js backend-node/src/services/creditPricing.js
git commit -m "feat(credits): InsufficientCreditsError + 各服务 estimate/settle 工具"
```

---

## Task 3：creditService（核心状态机）

**Files:**
- Create: `backend-node/src/services/creditService.js`

- [ ] **Step 1：写 creditService**

```js
const { InsufficientCreditsError } = require('../errors/InsufficientCreditsError');

function getBalance(db, userId) {
  const row = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
  return row ? row.credit_balance : 0;
}

// 预扣：原子事务内校验 + 扣余额 + 写 reserved 流水
function reserve(db, userId, amount, scope, biz) {
  if (!userId) throw new Error('reserve: userId required');
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new Error(`User ${userId} not found`);
    if (u.credit_balance < amount) {
      throw new InsufficientCreditsError({
        required: amount,
        balance: u.credit_balance,
        scope,
        service_type: biz?.service_type,
        model: biz?.model,
      });
    }
    db.prepare('UPDATE users SET credit_balance = credit_balance - ?, updated_at=? WHERE id=?')
      .run(amount, new Date().toISOString(), Number(userId));
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, service_type, model, estimated, real_cost,
       price_snapshot, drama_id, episode_id, scene_key, created_at, updated_at)
      VALUES (?, 'consume', 'reserved', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(userId), scope || null,
      biz?.service_type || null, biz?.model || null,
      amount,
      JSON.stringify(biz?.price_snapshot || {}),
      biz?.drama_id || null, biz?.episode_id || null, biz?.scene_key || null,
      now, now,
    );
    return info.lastInsertRowid;
  });
  return tx();
}

// 结算：real_cost == null 时按 estimated 全额结算（无对账信号场景）
function settle(db, ledgerId, realCost, snapshot) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM credit_ledger WHERE id=?').get(Number(ledgerId));
    if (!row) throw new Error(`ledger ${ledgerId} not found`);
    if (row.status !== 'reserved') return; // 幂等
    const finalCost = realCost == null ? row.estimated : Math.max(0, Math.ceil(Number(realCost)));
    const delta = row.estimated - finalCost; // >0 退还，<0 补扣（罕见，预扣按上限故 delta>=0 居多）
    if (delta !== 0) {
      db.prepare('UPDATE users SET credit_balance = credit_balance + ?, updated_at=? WHERE id=?')
        .run(delta, new Date().toISOString(), Number(row.user_id));
    }
    db.prepare(`
      UPDATE users SET credit_total_consumed = credit_total_consumed + ? WHERE id=?
    `).run(finalCost, Number(row.user_id));
    db.prepare(`
      UPDATE credit_ledger
         SET status='settled', real_cost=?, price_snapshot=?, updated_at=?
       WHERE id=?
    `).run(finalCost,
      snapshot ? JSON.stringify(snapshot) : row.price_snapshot,
      new Date().toISOString(), Number(ledgerId));
  });
  tx();
}

// 退款：reserved → refunded，全额回滚
function refund(db, ledgerId, reason) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM credit_ledger WHERE id=?').get(Number(ledgerId));
    if (!row) return;
    if (row.status !== 'reserved') return; // 幂等
    db.prepare('UPDATE users SET credit_balance = credit_balance + ?, updated_at=? WHERE id=?')
      .run(row.estimated, new Date().toISOString(), Number(row.user_id));
    db.prepare(`
      UPDATE credit_ledger SET status='refunded', error=?, updated_at=? WHERE id=?
    `).run(String(reason || '').slice(0, 500), new Date().toISOString(), Number(ledgerId));
  });
  tx();
}

// 充值（grant）：管理员/系统给用户加积分
function grant(db, userId, amount, operatorId, note, scope = 'admin.grant') {
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  if (amount <= 0) throw new Error('grant amount must be > 0');
  if (!note) throw new Error('grant note is required');
  const tx = db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users SET credit_balance = credit_balance + ?,
                       credit_total_recharged = credit_total_recharged + ?,
                       updated_at=? WHERE id=?
    `).run(amount, amount, now, Number(userId));
    db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, estimated, real_cost, operator_id, note, created_at, updated_at)
      VALUES (?, 'grant', 'done', ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(userId), scope, amount, amount, operatorId || null, note, now, now);
  });
  tx();
}

// 扣减（deduct）：super_admin 对用户做行政扣减；不允许扣成负数
function deduct(db, userId, amount, operatorId, note) {
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  if (amount <= 0) throw new Error('deduct amount must be > 0');
  if (!note) throw new Error('deduct note is required');
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new Error(`User ${userId} not found`);
    const real = Math.min(amount, u.credit_balance); // 扣到 0 为止
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET credit_balance = credit_balance - ?, updated_at=? WHERE id=?')
      .run(real, now, Number(userId));
    db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, estimated, real_cost, operator_id, note, created_at, updated_at)
      VALUES (?, 'deduct', 'done', 'admin.deduct', ?, ?, ?, ?, ?, ?)
    `).run(Number(userId), real, real, operatorId || null, note, now, now);
    return real;
  });
  return tx();
}

function listLedger(db, { userId, status, scope, type, page = 1, pageSize = 20 } = {}) {
  const conds = []; const params = [];
  if (userId) { conds.push('user_id=?'); params.push(Number(userId)); }
  if (status) { conds.push('status=?'); params.push(status); }
  if (scope)  { conds.push('scope=?');  params.push(scope); }
  if (type)   { conds.push('type=?');   params.push(type); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM credit_ledger ${where}`).get(...params).c;
  const offset = (Math.max(1, Number(page) || 1) - 1) * Number(pageSize);
  const rows = db.prepare(`
    SELECT * FROM credit_ledger ${where}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);
  return { total, page, pageSize, rows };
}

function getStats(db) {
  const sumBalance = db.prepare('SELECT COALESCE(SUM(credit_balance),0) s FROM users WHERE deleted_at IS NULL').get().s;
  const sumRech    = db.prepare('SELECT COALESCE(SUM(credit_total_recharged),0) s FROM users WHERE deleted_at IS NULL').get().s;
  const sumCons    = db.prepare('SELECT COALESCE(SUM(credit_total_consumed),0) s FROM users WHERE deleted_at IS NULL').get().s;
  const top = db.prepare(`
    SELECT id, username, nickname, credit_total_consumed
    FROM users WHERE deleted_at IS NULL
    ORDER BY credit_total_consumed DESC LIMIT 10
  `).all();
  return { total_balance: sumBalance, total_recharged: sumRech, total_consumed: sumCons, top_consumers: top };
}

module.exports = {
  getBalance, reserve, settle, refund,
  grant, deduct,
  listLedger, getStats,
};
```

- [ ] **Step 2：临时手测**

```powershell
node -e "const db=require('better-sqlite3')('./data/drama_generator.db'); const cs=require('./src/services/creditService'); cs.grant(db, 1, 10000, 1, 'test bootstrap'); console.log('balance', cs.getBalance(db,1)); const id=cs.reserve(db,1,500,'text.chat',{service_type:'text',model:'claude-sonnet-4'}); console.log('reserved id', id, 'balance', cs.getBalance(db,1)); cs.settle(db, id, 350); console.log('after settle', cs.getBalance(db,1)); const id2=cs.reserve(db,1,1000,'text.chat',{service_type:'text',model:'x'}); cs.refund(db, id2, 'test'); console.log('after refund', cs.getBalance(db,1));"
```
Expected：余额走 0→10000→9500→9650→8650→9650；流水 5 条（1 grant + 1 reserved→settled + 1 reserved→refunded）。

- [ ] **Step 3：commit**

```bash
git add backend-node/src/services/creditService.js
git commit -m "feat(credits): creditService 状态机 + grant/deduct/listLedger/stats"
```

---

## Task 4：withCredits 包装器

**Files:**
- Create: `backend-node/src/services/creditWrapper.js`

- [ ] **Step 1：写 wrapper**

```js
const creditService = require('./creditService');

/**
 * @param {string} scope 'text.chat' / 'image.gen' / 'video.merge' / 'tts.synth'
 * @param {Function} originalFn  async (db, log, opts) => result
 * @param {{estimate: (db, opts)=>{estimated, snapshot}, settle: (result, snapshot)=>realCost|null}} hooks
 */
function withCredits(scope, originalFn, hooks) {
  if (typeof hooks?.estimate !== 'function') throw new Error(`withCredits(${scope}): estimate required`);
  if (typeof hooks?.settle !== 'function')   throw new Error(`withCredits(${scope}): settle required`);

  return async function billed(db, log, opts) {
    const userId = opts && opts.user_id;
    if (!userId) throw new Error(`withCredits(${scope}): opts.user_id is required`);

    const { estimated, snapshot } = hooks.estimate(db, opts);
    const ledgerId = creditService.reserve(db, userId, estimated, scope, {
      service_type: snapshot?.service_type,
      model: snapshot?.model,
      drama_id: opts.drama_id,
      episode_id: opts.episode_id,
      scene_key: opts.scene_key,
      price_snapshot: snapshot,
    });
    if (log) log.info('credits reserve', { scope, user_id: userId, estimated, ledger_id: ledgerId });
    try {
      const result = await originalFn(db, log, opts);
      let realCost = null;
      try { realCost = hooks.settle(result, snapshot); }
      catch (e) { if (log) log.warn('credits settle hook error', { err: e.message }); }
      creditService.settle(db, ledgerId, realCost, snapshot);
      if (log) log.info('credits settle', { scope, ledger_id: ledgerId, real_cost: realCost ?? estimated });
      return result;
    } catch (err) {
      try { creditService.refund(db, ledgerId, err.message || 'unknown'); }
      catch (e2) { if (log) log.error('credits refund failed', { err: e2.message, ledger_id: ledgerId }); }
      throw err;
    }
  };
}

module.exports = { withCredits };
```

- [ ] **Step 2：commit**

```bash
git add backend-node/src/services/creditWrapper.js
git commit -m "feat(credits): withCredits 高阶包装器"
```

---

## Task 5：包装 aiClient（文本 + Vision）

**Files:**
- Modify: `backend-node/src/services/aiClient.js`（流式补 include_usage、把 generateText/streamGenerateText/generateTextWithVision/extractDescriptionFromImage 套包装；返回结构改为 `{content, usage}`，调用方按需读取；现有调用方仅取 content 时需改为 `r.content`）

- [ ] **Step 1：流式 SSE 解析里抓 usage**

修改 `postJSONStream` 函数（aiClient.js 文件 114-199 行）：
- 在 SSE 解析循环里识别 `evt.usage`（最后一条会含），保留到 outer scope `lastUsage`；
- `resolve` 时返回 `{ status, body: accumulated, usage: lastUsage }`。

```js
// 在 postJSONStream 内：
let lastUsage = null;
// ... 在循环里：
const evt = JSON.parse(data);
if (evt.usage) lastUsage = evt.usage;   // 新增这一行
const delta = evt.choices?.[0]?.delta?.content;
// ...
// res.on('end', ...)：
resolve({ status: statusCode, body: accumulated, usage: lastUsage });
```

并在 `generateText` / `streamGenerateText` 的请求体里加：
```js
const body = {
  ...,
  stream_options: { include_usage: true },
};
```

- [ ] **Step 2：把外部函数改名为内部并构造对外包装**

把 `aiClient.js` 文件底部的 `module.exports = { generateText, streamGenerateText, generateTextWithVision, extractDescriptionFromImage, ... }` 改为：

```js
const { withCredits } = require('./creditWrapper');
const { estimateText, settleText } = require('./creditPricing');

// 内部实现重命名为 _xxx
const _generateText = generateText;
const _streamGenerateText = streamGenerateText;
const _generateTextWithVision = generateTextWithVision;
const _extractDescriptionFromImage = extractDescriptionFromImage;

// 让 generateText 返回 { content, usage } 而不是直接返回字符串
async function _generateTextWithUsage(db, log, serviceType, userPrompt, systemPrompt, options = {}) {
  // 包一下：原 _generateText 内部用了 postJSONStream，把它的 res 透传出来
  // 实际改造：直接把现有 generateText 函数体里 `return content;` 改为 `return { content, usage: res.usage || null };`
  const content = await _generateText(db, log, serviceType, userPrompt, systemPrompt, options);
  // 注意：上面这种"再调一次"的写法是为了示意；真实改造请直接修改 generateText 函数体内的 return。
  return { content, usage: null }; // placeholder：实际改 generateText 内部 return
}
```

**实操做法（更简洁）**：直接在 `generateText` 函数底部把 `return content;` 改为 `return { content, usage: res.usage || null };`。同样改 `streamGenerateText` 和 `generateTextWithVision`。所有原本 `const txt = await generateText(...)` 的调用方在 Task 9 统一改为 `const { content: txt } = await generateText(...)`。

- [ ] **Step 3：用 wrapper 包装导出**

`aiClient.js` 末尾的 `module.exports = { ... }` 改为：

```js
const billed_generateText = withCredits('text.chat', generateText, {
  estimate: (db, opts) => estimateText(db, {
    model: opts.model,
    userPrompt: opts.userPrompt,
    systemPrompt: opts.systemPrompt,
    max_tokens: opts.max_tokens,
  }),
  settle: (result, snapshot) => settleText(result, snapshot),
});
// 但 generateText 当前签名是 (db, log, serviceType, userPrompt, systemPrompt, options)
// wrapper 期待 (db, log, opts)。需要适配层：
async function generateTextOpts(db, log, opts) {
  return generateText(db, log, opts.serviceType || 'text', opts.userPrompt, opts.systemPrompt, opts);
}
const exported_generateText = withCredits('text.chat', generateTextOpts, {
  estimate: (db, opts) => estimateText(db, opts),
  settle: (result, snapshot) => settleText(result, snapshot),
});
// 同理为 streamGenerateText / generateTextWithVision / extractDescriptionFromImage 各做一个适配
```

最终 `module.exports`：

```js
module.exports = {
  // 计费包装版（推荐外部使用）
  generateText: exported_generateText,
  streamGenerateText: exported_streamGenerateText,
  generateTextWithVision: exported_generateTextWithVision,
  extractDescriptionFromImage: exported_extractDescriptionFromImage,
  // 内部工具保持导出
  getDefaultConfig, getConfigForModel, getConfigFromModelMap,
  resolveEntityImageSource, EXTRACT_PROMPTS, isRefusalResponse,
  postJSONWithTimeout,
};
```

调用方注意：现有调用方传参从 positional 改为 opts；user_id 必须传入 opts。Task 9 统一改造调用方。

- [ ] **Step 4：commit**

```bash
git add backend-node/src/services/aiClient.js
git commit -m "feat(credits): aiClient 文本/Vision 接入计费包装 + include_usage"
```

---

## Task 6：包装 imageClient

**Files:**
- Modify: `backend-node/src/services/imageClient.js`

- [ ] **Step 1：找到对外导出函数**

```bash
grep -nE "^module.exports" D:/claude/miniDrama/backend-node/src/services/imageClient.js
```

- [ ] **Step 2：所有图片生成主函数改造为接受 `(db, log, opts)`**（如已是该签名则跳过适配层），并确保 result 含 `images: [...]` 数组（用于 settleImage 拿到真实张数）。如果原 result 形态不同，写一个返回值适配 `settleImage` 的 hook：

```js
const { withCredits } = require('./creditWrapper');
const { estimateImage, settleImage } = require('./creditPricing');

const exported_generateImage = withCredits('image.gen', _generateImage, {
  estimate: (db, opts) => estimateImage(db, { model: opts.model, n: opts.n || 1 }),
  settle: (result, snapshot) => {
    // 兼容多种返回形态
    const arr = result?.images || result?.data || [];
    return Array.isArray(arr) && arr.length ? arr.length * snapshot.per_image_price : null;
  },
});

module.exports = {
  ...,
  generateImage: exported_generateImage, // 同理处理 createAndGenerateImage 等其他对外函数
};
```

- [ ] **Step 3：commit**

```bash
git add backend-node/src/services/imageClient.js
git commit -m "feat(credits): imageClient 接入计费包装"
```

---

## Task 7：包装 videoClient

**Files:**
- Modify: `backend-node/src/services/videoClient.js`

- [ ] **Step 1：处理对外导出**

```js
const { withCredits } = require('./creditWrapper');
const { estimateVideo, settleVideo } = require('./creditPricing');

// 视频通常是异步任务：submit → poll → done。
// 计费应包装在"提交+等待最终结果"的最外层 async 函数上。
// 如果实现是 submit + 后续 poll 的两阶段，则在 submit 处 reserve、poll 拿到结果时 settle/refund。
// 对于 v1：在能拿到最终 result（含真实 duration）的最外层包一次。

const exported_generateVideo = withCredits('video.gen', _generateVideo, {
  estimate: (db, opts) => estimateVideo(db, {
    model: opts.model,
    duration_seconds: opts.duration_seconds || opts.duration || 5,
  }),
  settle: (result, snapshot) => settleVideo(result, snapshot),
});
```

- [ ] **Step 2：videoMergeService 同理（如果它直接调外部模型）**

如 `videoMergeService.js` 内部的合并是纯本地 ffmpeg、不调外部模型，则**不计费**。仅对真正调外部 AI 模型的环节包装。

- [ ] **Step 3：commit**

```bash
git add backend-node/src/services/videoClient.js
git commit -m "feat(credits): videoClient 接入计费包装"
```

---

## Task 8：包装 ttsService + 清理孤儿 reportUsage

**Files:**
- Modify: `backend-node/src/services/ttsService.js`

- [ ] **Step 1：删除 line 253 孤儿 `cs.reportUsage`**

```js
// 删掉这一行：
// try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
```

- [ ] **Step 2：让 synthesize 接受 opts.user_id 并改为 (db, log, opts) 形态（保留向后兼容签名也可在适配层）**

- [ ] **Step 3：包装导出**

```js
const { withCredits } = require('./creditWrapper');
const { estimateTts, settleTts } = require('./creditPricing');

const exported_synthesize = withCredits('tts.synth', _synthesize, {
  estimate: (db, opts) => estimateTts(db, { model: opts.model || opts?.config?.model, text: opts.text }),
  settle: (result, snapshot) => settleTts(result, snapshot),
});

module.exports = { synthesize: exported_synthesize };
```

- [ ] **Step 4：commit**

```bash
git add backend-node/src/services/ttsService.js
git commit -m "feat(credits): ttsService 接入计费 + 清理孤儿 reportUsage"
```

---

## Task 9：自顶向下贯通 user_id

**Files:**
- Modify: 所有调用 aiClient / imageClient / videoClient / ttsService 的 service / route 文件

- [ ] **Step 1：清单**

```bash
grep -rln "require.*aiClient\|require.*imageClient\|require.*videoClient\|require.*ttsService" D:/claude/miniDrama/backend-node/src/
```

- [ ] **Step 2：在每个 caller 中确保 `opts.user_id = req.user.id`（路由层注入），逐层透传到 client**

route handler 中：
```js
const result = await someService.run(db, log, { ...userOpts, user_id: req.user.id });
```

service 层只需把 user_id 透传给 client；自顶向下贯通。

- [ ] **Step 3：本地启动验证**

```powershell
cd D:\claude\miniDrama\backend-node
npm run dev
```

随便 curl 一个简单 AI 调用接口（如生成分镜），确认日志中出现 `credits reserve` 和 `credits settle`。

- [ ] **Step 4：commit**

```bash
git commit -am "feat(credits): 各 caller 贯通 user_id 到 AI client"
```

---

## Task 10：402 错误中间件 + 路由

**Files:**
- Create: `backend-node/src/middleware/creditError.js`
- Create: `backend-node/src/routes/credits.js`
- Modify: `backend-node/src/routes/index.js`

- [ ] **Step 1：错误中间件**

`backend-node/src/middleware/creditError.js`：
```js
function creditErrorHandler(err, req, res, next) {
  if (err && err.code === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: '积分不足，无法完成本次调用',
        required: err.required,
        current_balance: err.balance,
        shortfall: err.shortfall,
        scope: err.scope,
        service_type: err.service_type,
        model: err.model,
        hint: '请联系管理员充值，或在「我的积分」页查看消耗明细',
      },
    });
  }
  return next(err);
}
module.exports = { creditErrorHandler };
```

- [ ] **Step 2：路由**

`backend-node/src/routes/credits.js`：
```js
const express = require('express');
const creditService = require('../services/creditService');
const { isSuperAdmin, isAdminOrAbove, requireSuperAdmin, requireAdminOrAbove } = require('../middleware/permissions');
const userService = require('../services/userService');

const router = express.Router();

// 自己的余额 / 流水
router.get('/balance', (req, res) => {
  const balance = creditService.getBalance(req.db, req.user.id);
  res.json({ success: true, data: { balance } });
});
router.get('/ledger', (req, res) => {
  const data = creditService.listLedger(req.db, {
    userId: req.user.id,
    status: req.query.status,
    scope: req.query.scope,
    type: req.query.type,
    page: req.query.page,
    pageSize: req.query.page_size,
  });
  res.json({ success: true, data });
});

// admin+ 看某用户余额/流水（admin 限自己创建的 user）
function checkAdminCanManage(req, targetUserId) {
  if (isSuperAdmin(req.user)) return true;
  const target = userService.findById(req.db, targetUserId);
  if (!target) return false;
  return target.role === 'user' && target.created_by === req.user.id;
}

router.get('/users/:id/balance', requireAdminOrAbove, (req, res) => {
  if (!checkAdminCanManage(req, req.params.id)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '无权管理此用户' } });
  res.json({ success: true, data: { balance: creditService.getBalance(req.db, req.params.id) } });
});
router.get('/users/:id/ledger', requireAdminOrAbove, (req, res) => {
  if (!checkAdminCanManage(req, req.params.id)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '无权管理此用户' } });
  const data = creditService.listLedger(req.db, {
    userId: req.params.id,
    status: req.query.status, scope: req.query.scope, type: req.query.type,
    page: req.query.page, pageSize: req.query.page_size,
  });
  res.json({ success: true, data });
});
router.post('/users/:id/grant', requireAdminOrAbove, (req, res) => {
  if (!checkAdminCanManage(req, req.params.id)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '无权管理此用户' } });
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim();
  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: { message: 'amount 必须大于 0' } });
  if (!note) return res.status(400).json({ success: false, error: { message: '备注必填' } });
  creditService.grant(req.db, req.params.id, amount, req.user.id, note);
  res.json({ success: true, data: { balance: creditService.getBalance(req.db, req.params.id) } });
});
router.post('/users/:id/deduct', requireSuperAdmin, (req, res) => {
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim();
  if (!amount || amount <= 0) return res.status(400).json({ success: false, error: { message: 'amount 必须大于 0' } });
  if (!note) return res.status(400).json({ success: false, error: { message: '备注必填' } });
  const real = creditService.deduct(req.db, req.params.id, amount, req.user.id, note);
  res.json({ success: true, data: { deducted: real, balance: creditService.getBalance(req.db, req.params.id) } });
});

// 计价表 CRUD
router.get('/pricing', requireSuperAdmin, (req, res) => {
  const rows = req.db.prepare('SELECT * FROM credit_pricing ORDER BY service_type, model, unit').all();
  res.json({ success: true, data: rows });
});
router.post('/pricing', requireSuperAdmin, (req, res) => {
  const { service_type, model, unit, price, is_active = 1, note } = req.body || {};
  if (!service_type || !model || !unit || price == null) return res.status(400).json({ success: false, error: { message: '缺字段' } });
  const now = new Date().toISOString();
  const info = req.db.prepare(`
    INSERT INTO credit_pricing (service_type, model, unit, price, is_active, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(service_type, model, unit, Math.ceil(price), is_active ? 1 : 0, note || null, now, now);
  res.json({ success: true, data: { id: info.lastInsertRowid } });
});
router.put('/pricing/:id', requireSuperAdmin, (req, res) => {
  const { price, is_active, note } = req.body || {};
  const fields = []; const params = [];
  if (price != null)     { fields.push('price=?');     params.push(Math.ceil(price)); }
  if (is_active != null) { fields.push('is_active=?'); params.push(is_active ? 1 : 0); }
  if (note !== undefined){ fields.push('note=?');      params.push(note || null); }
  if (!fields.length) return res.json({ success: true });
  fields.push('updated_at=?'); params.push(new Date().toISOString());
  params.push(Number(req.params.id));
  req.db.prepare(`UPDATE credit_pricing SET ${fields.join(', ')} WHERE id=?`).run(...params);
  res.json({ success: true });
});
router.delete('/pricing/:id', requireSuperAdmin, (req, res) => {
  req.db.prepare('DELETE FROM credit_pricing WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

// 总览
router.get('/stats', requireSuperAdmin, (req, res) => {
  res.json({ success: true, data: creditService.getStats(req.db) });
});

// 全局流水（super_admin）
router.get('/ledger/global', requireSuperAdmin, (req, res) => {
  const data = creditService.listLedger(req.db, {
    userId: req.query.user_id,
    status: req.query.status, scope: req.query.scope, type: req.query.type,
    page: req.query.page, pageSize: req.query.page_size,
  });
  res.json({ success: true, data });
});

// 设置（沿用 global_settings KV）
router.get('/settings', requireSuperAdmin, (req, res) => {
  const rows = req.db.prepare(`SELECT key, value FROM global_settings WHERE key LIKE 'credits.%'`).all();
  res.json({ success: true, data: rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {}) });
});
router.put('/settings', requireSuperAdmin, (req, res) => {
  const updates = req.body || {};
  const now = new Date().toISOString();
  const upd = req.db.prepare(`INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const tx = req.db.transaction(() => {
    for (const [k, v] of Object.entries(updates)) {
      if (k.startsWith('credits.')) upd.run(k, String(v), now);
    }
  });
  tx();
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 3：挂载到 routes/index.js + 错误中间件**

```js
// routes/index.js
const credits = require('./credits');
router.use('/credits', credits);

// 错误中间件挂载在 app.js 的最末尾（所有路由之后）
const { creditErrorHandler } = require('./middleware/creditError');
app.use(creditErrorHandler);
```

- [ ] **Step 4：curl 验收**

```bash
# 1. 登录拿 token（admin/123456）
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"123456"}' | jq -r .data.token)
# 2. 看自己余额
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/credits/balance
# 3. 给 user_id=2 充 5000，备注"测试"
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"amount":5000,"note":"测试"}' http://localhost:3000/api/credits/users/2/grant
# 4. 列表
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/credits/pricing
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/credits/stats
```

- [ ] **Step 5：commit**

```bash
git add backend-node/src/middleware/creditError.js backend-node/src/routes/credits.js backend-node/src/routes/index.js backend-node/src/app.js
git commit -m "feat(credits): /credits/* 路由 + 402 错误中间件"
```

---

## Task 11：注册赠送 + created_by

**Files:**
- Modify: `backend-node/src/services/userService.js`
- Modify: `backend-node/src/routes/admin.js`（或调用 createUser 的路由）

- [ ] **Step 1：userService.createUser 加 `created_by` 参数**

```js
function createUser(db, { username, password, nickname, role, created_by = null }) {
  // ...原校验
  const info = db.prepare(
    `INSERT INTO users (username, password, nickname, role, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(username, hash, nickname || null, safeRole, created_by || null, now, now);
  return rowToUser(findById(db, info.lastInsertRowid));
}
```

`rowToUser` 也加上 `created_by`。

- [ ] **Step 2：路由层调用时传 `created_by = req.user.id`**

```js
// admin.js 内 createUser 路由：
const newUser = userService.createUser(req.db, { ...req.body, created_by: req.user.id });
// 注册赠送（读 global_settings）
const bonusRow = req.db.prepare(`SELECT value FROM global_settings WHERE key='credits.signup_bonus'`).get();
const bonus = Number(bonusRow?.value) || 5000;
if (bonus > 0) {
  creditService.grant(req.db, newUser.id, bonus, req.user.id, '注册赠送', 'system.signup_bonus');
}
res.json({ success: true, data: { ...newUser, credit_balance: creditService.getBalance(req.db, newUser.id) } });
```

- [ ] **Step 3：commit**

```bash
git add backend-node/src/services/userService.js backend-node/src/routes/admin.js
git commit -m "feat(credits): 注册赠送 5000 积分 + created_by 落库"
```

---

## Task 12：前端 API 封装

**Files:**
- Create: `frontweb/src/api/credits.js`

```js
import request from '@/utils/request';
export const getMyBalance = () => request.get('/credits/balance');
export const getMyLedger  = (params) => request.get('/credits/ledger', { params });
export const getUserBalance = (id) => request.get(`/credits/users/${id}/balance`);
export const getUserLedger  = (id, params) => request.get(`/credits/users/${id}/ledger`, { params });
export const grantCredits   = (id, amount, note) => request.post(`/credits/users/${id}/grant`, { amount, note });
export const deductCredits  = (id, amount, note) => request.post(`/credits/users/${id}/deduct`, { amount, note });
export const listPricing    = () => request.get('/credits/pricing');
export const createPricing  = (payload) => request.post('/credits/pricing', payload);
export const updatePricing  = (id, payload) => request.put(`/credits/pricing/${id}`, payload);
export const deletePricing  = (id) => request.delete(`/credits/pricing/${id}`);
export const getStats       = () => request.get('/credits/stats');
export const getGlobalLedger = (params) => request.get('/credits/ledger/global', { params });
export const getSettings    = () => request.get('/credits/settings');
export const updateSettings = (payload) => request.put('/credits/settings', payload);
```

```bash
git add frontweb/src/api/credits.js
git commit -m "feat(credits): 前端 API 封装"
```

---

## Task 13：402 全局拦截 + 弹窗组件

**Files:**
- Create: `frontweb/src/components/InsufficientCreditsModal.vue`
- Modify: `frontweb/src/utils/request.js`（axios 实例响应拦截）

- [ ] **Step 1：弹窗组件**

```vue
<template>
  <el-dialog v-model="visible" title="积分不足" width="420px" :show-close="false">
    <div style="text-align:center;">
      <div style="font-size:18px;color:#f56c6c;margin-bottom:12px;">本次调用需要 <b>{{ data.required }}</b> 积分</div>
      <div style="margin-bottom:8px;">当前余额：<b>{{ data.current_balance }}</b></div>
      <div style="color:#909399;font-size:13px;">还差 {{ data.shortfall }} 积分</div>
      <div style="margin-top:16px;font-size:13px;color:#606266;">{{ data.hint }}</div>
    </div>
    <template #footer>
      <el-button @click="visible=false">关闭</el-button>
      <el-button type="primary" @click="goCredits">查看消耗明细</el-button>
    </template>
  </el-dialog>
</template>
<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
const visible = ref(false); const data = ref({});
const router = useRouter();
function open(payload) { data.value = payload; visible.value = true; }
function goCredits() { visible.value = false; router.push('/my/credits'); }
defineExpose({ open });
</script>
```

- [ ] **Step 2：全局事件总线 + axios 拦截**

`request.js`：
```js
import mitt from 'mitt';
export const bus = mitt();

instance.interceptors.response.use(r => r, err => {
  if (err.response?.status === 402 && err.response?.data?.error?.code === 'INSUFFICIENT_CREDITS') {
    bus.emit('insufficient_credits', err.response.data.error);
  }
  return Promise.reject(err);
});
```

`App.vue` 顶部挂载组件并监听：
```vue
<InsufficientCreditsModal ref="creditsModal" />
<script setup>
import { ref, onMounted } from 'vue';
import { bus } from '@/utils/request';
import InsufficientCreditsModal from '@/components/InsufficientCreditsModal.vue';
const creditsModal = ref(null);
onMounted(() => bus.on('insufficient_credits', (p) => creditsModal.value?.open(p)));
</script>
```

- [ ] **Step 3：commit**

```bash
git add frontweb/src/components/InsufficientCreditsModal.vue frontweb/src/utils/request.js frontweb/src/App.vue
git commit -m "feat(credits): 前端 402 全局拦截 + 不足弹窗"
```

---

## Task 14：顶部余额 badge + 「我的积分」页

**Files:**
- Create: `frontweb/src/components/CreditBalanceBadge.vue`
- Create: `frontweb/src/views/MyCredits.vue`
- Modify: `frontweb/src/router/index.js`、layout 或 `App.vue` 顶部

- [ ] **Step 1：badge 组件**

```vue
<template>
  <el-button link @click="$router.push('/my/credits')" style="font-weight:600;">
    💎 {{ balance }}
  </el-button>
</template>
<script setup>
import { ref, onMounted, watch } from 'vue';
import { getMyBalance } from '@/api/credits';
import { bus } from '@/utils/request';
const balance = ref(0);
async function refresh() {
  try { const r = await getMyBalance(); balance.value = r.data.balance; } catch (_) {}
}
onMounted(refresh);
bus.on('credits_changed', refresh);
bus.on('insufficient_credits', refresh);
defineExpose({ refresh });
</script>
```

- [ ] **Step 2：MyCredits.vue（含余额卡片 + 流水分页表）**

```vue
<template>
  <div style="padding:24px;">
    <el-card><h2>我的积分：{{ balance }}</h2></el-card>
    <el-card style="margin-top:16px;">
      <el-form inline>
        <el-form-item label="状态">
          <el-select v-model="filter.status" clearable placeholder="全部" style="width:140px;">
            <el-option label="预扣中" value="reserved" />
            <el-option label="已结算" value="settled" />
            <el-option label="已退还" value="refunded" />
            <el-option label="完成" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filter.type" clearable placeholder="全部" style="width:140px;">
            <el-option label="消耗" value="consume" />
            <el-option label="充值" value="grant" />
            <el-option label="扣减" value="deduct" />
          </el-select>
        </el-form-item>
        <el-button @click="load">查询</el-button>
      </el-form>
      <el-table :data="rows" border>
        <el-table-column prop="created_at" label="时间" width="180" />
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="scope" label="场景" width="160" />
        <el-table-column prop="model" label="模型" width="180" />
        <el-table-column prop="estimated" label="预扣" width="80" />
        <el-table-column prop="real_cost" label="实扣" width="80" />
        <el-table-column prop="note" label="备注" />
      </el-table>
      <el-pagination :total="total" v-model:current-page="filter.page" :page-size="20" @current-change="load" />
    </el-card>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { getMyBalance, getMyLedger } from '@/api/credits';
const balance = ref(0); const rows = ref([]); const total = ref(0);
const filter = ref({ status: '', type: '', page: 1 });
async function load() {
  const [b, l] = await Promise.all([getMyBalance(), getMyLedger({ ...filter.value, page_size: 20 })]);
  balance.value = b.data.balance; rows.value = l.data.rows; total.value = l.data.total;
}
onMounted(load);
</script>
```

- [ ] **Step 3：路由 + 顶部嵌入**

router：
```js
{ path: '/my/credits', component: () => import('@/views/MyCredits.vue'), meta: { requireAuth: true } },
```

App.vue 或顶部 layout：在用户名旁边加 `<CreditBalanceBadge />`。

- [ ] **Step 4：commit**

```bash
git add frontweb/src/components/CreditBalanceBadge.vue frontweb/src/views/MyCredits.vue frontweb/src/router/index.js frontweb/src/App.vue
git commit -m "feat(credits): 顶部余额徽章 + 我的积分页"
```

---

## Task 15：用户管理列扩展

**Files:**
- Create: `frontweb/src/components/GrantCreditsDialog.vue`
- Modify: `frontweb/src/views/UserManagement.vue`

- [ ] **Step 1：充值/扣减对话框组件**

```vue
<template>
  <el-dialog v-model="visible" :title="`${action==='grant'?'充值':'扣减'} - ${user?.username}`" width="420px">
    <el-form>
      <el-form-item label="金额">
        <el-input-number v-model="amount" :min="1" :max="999999999" />
      </el-form-item>
      <el-form-item label="备注（必填）">
        <el-input v-model="note" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible=false">取消</el-button>
      <el-button type="primary" :disabled="!note.trim()||amount<=0" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>
<script setup>
import { ref } from 'vue';
import { grantCredits, deductCredits } from '@/api/credits';
import { ElMessage } from 'element-plus';
const visible = ref(false); const user = ref(null); const action = ref('grant');
const amount = ref(1000); const note = ref('');
const emit = defineEmits(['updated']);
function open(u, act) { user.value = u; action.value = act; amount.value = 1000; note.value = ''; visible.value = true; }
async function submit() {
  try {
    if (action.value === 'grant') await grantCredits(user.value.id, amount.value, note.value.trim());
    else await deductCredits(user.value.id, amount.value, note.value.trim());
    ElMessage.success('成功');
    visible.value = false;
    emit('updated');
  } catch (e) { ElMessage.error(e.response?.data?.error?.message || '失败'); }
}
defineExpose({ open });
</script>
```

- [ ] **Step 2：UserManagement.vue 加列 + 行操作**

```vue
<el-table-column label="积分余额" prop="credit_balance" width="120" />
<el-table-column label="操作" width="240">
  <template #default="{row}">
    <el-button size="small" @click="dialog.open(row, 'grant')">充值</el-button>
    <el-button size="small" v-if="isSuperAdmin" @click="dialog.open(row, 'deduct')">扣减</el-button>
    <el-button size="small" link @click="$router.push(`/admin/users/${row.id}/ledger`)">流水</el-button>
  </template>
</el-table-column>
<GrantCreditsDialog ref="dialog" @updated="loadUsers" />
```

list 接口需要返回 credit_balance（修改后端 `userService.listUsers` 返回 `credit_balance` 字段，rowToUser 一并暴露）。

- [ ] **Step 3：commit**

```bash
git add frontweb/src/components/GrantCreditsDialog.vue frontweb/src/views/UserManagement.vue backend-node/src/services/userService.js
git commit -m "feat(credits): UserManagement 加积分列 + 充值扣减入口"
```

---

## Task 16：积分管理页（super_admin）

**Files:**
- Create: `frontweb/src/views/AdminCredits.vue`
- Modify: `frontweb/src/router/index.js`

- [ ] **Step 1：四个 tab：总览 / 计价表 / 全局流水 / 系统设置**

骨架（核心逻辑用前面的 api）：
```vue
<template>
  <div style="padding:24px;">
    <el-tabs v-model="tab">
      <el-tab-pane label="总览" name="stats">
        <el-row :gutter="16">
          <el-col :span="6"><el-card>总余额<h2>{{ stats.total_balance }}</h2></el-card></el-col>
          <el-col :span="6"><el-card>总充值<h2>{{ stats.total_recharged }}</h2></el-card></el-col>
          <el-col :span="6"><el-card>总消耗<h2>{{ stats.total_consumed }}</h2></el-card></el-col>
        </el-row>
        <el-table :data="stats.top_consumers" border style="margin-top:16px;">
          <el-table-column prop="username" label="用户" />
          <el-table-column prop="nickname" label="昵称" />
          <el-table-column prop="credit_total_consumed" label="累计消耗" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="计价表" name="pricing">
        <el-button type="primary" @click="addPricing">新增</el-button>
        <el-table :data="pricing" border>
          <el-table-column prop="service_type" label="服务" width="100" />
          <el-table-column prop="model" label="模型" />
          <el-table-column prop="unit" label="单位" width="160" />
          <el-table-column label="单价"><template #default="{row}">
            <el-input-number v-model="row.price" :min="0" @change="p => onPriceChange(row, p)" />
          </template></el-table-column>
          <el-table-column label="启用"><template #default="{row}">
            <el-switch v-model="row.is_active" :active-value="1" :inactive-value="0" @change="v => onActiveChange(row, v)" />
          </template></el-table-column>
          <el-table-column prop="note" label="备注" />
          <el-table-column label="操作" width="100"><template #default="{row}">
            <el-button size="small" type="danger" @click="removePricing(row)">删除</el-button>
          </template></el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="全局流水" name="ledger">
        <el-input v-model="globalFilter.user_id" placeholder="按 user_id 筛选" style="width:200px;" />
        <el-button @click="loadGlobal">查询</el-button>
        <el-table :data="globalRows" border>
          <el-table-column prop="created_at" label="时间" />
          <el-table-column prop="user_id" label="用户" width="80" />
          <el-table-column prop="type" label="类型" width="80" />
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column prop="scope" label="场景" />
          <el-table-column prop="model" label="模型" />
          <el-table-column prop="estimated" label="预扣" />
          <el-table-column prop="real_cost" label="实扣" />
          <el-table-column prop="note" label="备注" />
        </el-table>
        <el-pagination :total="globalTotal" v-model:current-page="globalFilter.page" :page-size="20" @current-change="loadGlobal" />
      </el-tab-pane>

      <el-tab-pane label="系统设置" name="settings">
        <el-form label-width="240px">
          <el-form-item label="新用户注册赠送积分">
            <el-input-number v-model="settings['credits.signup_bonus']" :min="0" />
          </el-form-item>
          <el-form-item label="低余额提示阈值">
            <el-input-number v-model="settings['credits.low_balance_threshold']" :min="0" />
          </el-form-item>
          <el-button type="primary" @click="saveSettings">保存</el-button>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import * as api from '@/api/credits';
import { ElMessage } from 'element-plus';

const tab = ref('stats');
const stats = ref({ total_balance: 0, total_recharged: 0, total_consumed: 0, top_consumers: [] });
const pricing = ref([]);
const globalRows = ref([]); const globalTotal = ref(0);
const globalFilter = ref({ user_id: '', page: 1 });
const settings = ref({});

async function loadStats() { stats.value = (await api.getStats()).data; }
async function loadPricing() { pricing.value = (await api.listPricing()).data; }
async function loadGlobal() {
  const r = await api.getGlobalLedger({ ...globalFilter.value, page_size: 20 });
  globalRows.value = r.data.rows; globalTotal.value = r.data.total;
}
async function loadSettings() {
  const r = await api.getSettings();
  settings.value = Object.fromEntries(Object.entries(r.data).map(([k,v]) => [k, Number(v) || 0]));
}
async function saveSettings() {
  await api.updateSettings(settings.value);
  ElMessage.success('已保存');
}
async function onPriceChange(row, p) { await api.updatePricing(row.id, { price: p }); }
async function onActiveChange(row, v) { await api.updatePricing(row.id, { is_active: v }); }
async function removePricing(row) { await api.deletePricing(row.id); await loadPricing(); }
async function addPricing() {
  const payload = prompt('JSON {"service_type":"text","model":"new","unit":"per_1k_input","price":10}');
  if (!payload) return;
  await api.createPricing(JSON.parse(payload));
  await loadPricing();
}

onMounted(async () => {
  await Promise.all([loadStats(), loadPricing(), loadGlobal(), loadSettings()]);
});
</script>
```

- [ ] **Step 2：路由（super_admin only）**

```js
{ path: '/admin/credits', component: () => import('@/views/AdminCredits.vue'), meta: { requireAuth: true, requireSuperAdmin: true } },
```

加入侧栏/菜单（仅 super_admin 可见）。

- [ ] **Step 3：commit**

```bash
git add frontweb/src/views/AdminCredits.vue frontweb/src/router/index.js
git commit -m "feat(credits): 积分管理页（super_admin）"
```

---

## Task 17：curl 矩阵 + 浏览器手动验收

- [ ] **Step 1：起服务**

```powershell
cd D:\claude\miniDrama\backend-node ; npm run dev
# 另一个窗口
cd D:\claude\miniDrama\frontweb ; npm run dev
```

- [ ] **Step 2：curl 验收**

```bash
# 用变量保存 token
ADMIN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"123456"}' | jq -r .data.token)
ZHX=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"zhx","password":"<密码>"}' | jq -r .data.token)

# 1. 自己余额
curl -H "Authorization: Bearer $ADMIN" http://localhost:3000/api/credits/balance
# 2. 给某 user_id=3 充值 5000
curl -X POST -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"amount":5000,"note":"测试"}' http://localhost:3000/api/credits/users/3/grant
# 3. zhx 给非自己创建的 user 充值，应 403
curl -X POST -H "Authorization: Bearer $ZHX" -H 'Content-Type: application/json' -d '{"amount":100,"note":"x"}' http://localhost:3000/api/credits/users/1/grant
# 4. 计价表 CRUD
curl -H "Authorization: Bearer $ADMIN" http://localhost:3000/api/credits/pricing
# 5. zhx 看计价表，403
curl -H "Authorization: Bearer $ZHX" http://localhost:3000/api/credits/pricing
# 6. stats
curl -H "Authorization: Bearer $ADMIN" http://localhost:3000/api/credits/stats
# 7. 余额 0 时调用 AI（触发 402）
# 临时把 user_id=2 余额清空：curl deduct
# 然后 user_id=2 调用任何 AI 接口，应 402 + 详细 JSON
```

- [ ] **Step 3：浏览器验证**

- 用 admin 登录，看到顶部 💎 余额，进「我的积分」看流水
- 进「用户管理」看到余额列、充值/扣减按钮
- 进「积分管理」四个 tab 可用
- 用普通 user 登录（先 super_admin 在后台清空其余额 → 0），尝试生成分镜，弹出 402 modal 显示缺多少
- 浏览器 DevTools Network 看 402 响应体格式正确

- [ ] **Step 4：commit（如有 bugfix）**

```bash
git commit -am "fix(credits): 验收期间 bugfix"
```

---

## Task 18：部署到 mj 服务器

- [ ] **Step 1：备份生产 db**

参考 `docs/deploy-standards.md` + `feedback_scp_sqlite.md`：在 mj 服务器先 VACUUM INTO。

```bash
ssh mj 'cd /var/www/aimj.aijianshou.com/backend-node && sqlite3 ./data/drama_generator.db "VACUUM INTO '\''./data/drama_generator.db.pre23-bak'\''"'
```

- [ ] **Step 2：推送 git → mj 拉取 → npm install / migrate / pm2 reload**

```bash
git push origin main
ssh mj 'cd /var/www/aimj.aijianshou.com && git pull && cd backend-node && npm install && npm run migrate && pm2 reload all'
ssh mj 'cd /var/www/aimj.aijianshou.com/frontweb && npm install && npm run build'
```

- [ ] **Step 3：浏览器 hard reload 验证**

参考 `feedback_frontend_cache_after_deploy.md` —— 部署完前端必须 hard reload，否则代码新+缓存旧会出怪 bug。

- [ ] **Step 4：初始化首批用户余额**

在生产 admin 后台用「积分管理 → 系统设置」确认 5000 注册赠送已写入；为已有用户在「用户管理」逐个充值（或用一条 SQL 批量）。

```bash
ssh mj "sqlite3 /var/www/aimj.aijianshou.com/backend-node/data/drama_generator.db 'UPDATE users SET credit_balance = 5000 WHERE deleted_at IS NULL AND role = \"user\" AND credit_balance = 0'"
```

并补一条 grant 流水（手写脚本或 admin UI 逐个）。

---

## Self-Review

- ✅ Spec 覆盖：数据模型（Task 1）、creditService（3）、wrapper（4）、4 大 client 包装（5-8）、user_id 贯通（9）、路由+错误（10）、注册赠送+created_by（11）、前端五件套（12-16）、验收（17）、部署（18）。无未覆盖项。
- ✅ Placeholder 扫描：无 TBD/TODO；每个步骤有具体代码或具体命令。Task 5 中 generateText 的 return 改造说明清楚（直接修改函数体内 `return content` 为 `return { content, usage }`）。
- ✅ 类型一致：`reserve` 返 ledgerId、`settle(db, ledgerId, realCost, snapshot)`、`refund(db, ledgerId, reason)`，wrapper 与 service 签名一致；前端 api/credits.js 与后端路由路径一致。
- ✅ 范围聚焦：单一目标（用户积分），不涉及无关重构；YAGNI 项（支付集成、配额池、月套餐等）spec 里已声明排除。
