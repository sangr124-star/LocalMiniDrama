# 用户积分体系 设计文档

> 日期：2026-05-04
> 状态：已批准，待实施
> 作者：Claude × sangr12

## 背景

`2026-05-04 用户级数据隔离 + 三角色权限` 已上线。下一步需要给每个用户加上**积分账户**：所有 AI 模型调用按用量扣积分，余额不足直接拦截。这样平台可控成本，团队管理员可以分配试用额度，未来也能接入付费充值。

当前现状：
- AI 调用入口分散在 `aiClient.js` / `imageClient.js` / `videoClient.js` / `ttsService.js` 四大 client
- 文本走 SSE 流式，目前不解析 `usage` 字段，需要补齐 `stream_options.include_usage`
- 没有任何积分 / 余额 / 计费相关的表或代码（git 全历史确认）
- 三角色 super_admin / admin / user 已稳定运行

## 目标

1. 每个用户有积分账户（余额 + 流水），所有 AI 调用统一扣费
2. 余额不足时 402 拦截 + 友好提示，**不允许透支**
3. 视频等大额调用使用预扣 + 对账机制保证不超刷
4. super_admin 可管理所有用户积分 + 维护计价表；admin 可给自己创建的 user 充值
5. 新注册 user 默认赠送 5000 积分（金额可配置）

## 概念模型

**「积分」是抽象单位**，对外统一展示。底层每种服务用最自然的计价口径：

| 服务 | 计价单位 | 示例 |
|---|---|---|
| 文本 (text) | per_1k_input_tokens / per_1k_output_tokens | claude-sonnet-4 输入 30/1k，输出 150/1k |
| 图片 (image) | per_image | seedream-4 每张 200 |
| 视频 (video) | per_second | seedance-1080p 每秒 200 |
| TTS (tts) | per_1k_chars | 火山 doubao-tts 每千字 50 |

计价表存数据库 `credit_pricing`，super_admin 在后台 UI 维护。漏配的模型走「兜底默认价」（`global_settings` 里按 service_type 配）。

## 扣费状态机

每次 AI 调用都走 **reserve → settle/refund** 三态：

```
[调用前]
  ├─ estimateCost(opts) 算出"上限估"
  ├─ creditService.reserve(user_id, estimated, scope, biz_refs)
  │   ├─ BEGIN IMMEDIATE
  │   ├─ SELECT balance FROM users WHERE id = ?
  │   ├─ if balance < estimated: throw INSUFFICIENT_CREDITS (402)
  │   ├─ UPDATE users SET balance = balance - estimated
  │   ├─ INSERT credit_ledger (status='reserved', estimated, price_snapshot)
  │   └─ COMMIT，返回 ledger_id
  ↓
[调用 AI 厂商]
  ↓
  ├─ 成功 ─→ settle(ledger_id, real_usage)
  │           ├─ real_cost = priceSnapshot × real_usage
  │           ├─ delta = estimated - real_cost  (>0 退款，<0 补扣)
  │           ├─ UPDATE users SET balance = balance + delta
  │           └─ UPDATE credit_ledger SET status='settled', real_cost
  │
  └─ 失败/超时 ─→ refund(ledger_id, reason)
              ├─ UPDATE users SET balance = balance + estimated
              └─ UPDATE credit_ledger SET status='refunded', error
```

**关键不变量**：

- 任何 reserve 都必须有对应的 settle 或 refund，由 `try/finally` 在 wrapper 层兜底
- ledger 终态只有 `settled` 和 `refunded`，运维可扫"卡在 reserved 超过 1 小时"的记录告警
- 调用方与 ledger_id 通过 wrapper 闭包持有，不暴露给业务代码
- super_admin / admin / user 都走同一套机制，**没有角色豁免**

## 数据模型

### users 表新增列（migration 23）

```sql
ALTER TABLE users ADD COLUMN credit_balance         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_recharged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN credit_total_consumed  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN created_by             INTEGER;
```

- `credit_balance` 是当前可用积分（含已 reserved 的扣减）
- `credit_total_recharged` / `credit_total_consumed` 是只增不减的统计字段，方便后台总览
- `created_by` 记录"创建该用户的管理员 id"。`userService.createUser` 在 admin 调用路径上写入当前 admin id；super_admin 创建或历史用户为 NULL。这是 admin 给"自己创建的 user 加积分"权限校验的依据
- migration 23 同时回填：所有现存用户 `created_by = NULL`（含 zhx 自己）；首次部署后 super_admin 在用户管理页可手动认领若干已有 user 给 zhx

### credit_ledger 表（消费/充值流水）

```sql
CREATE TABLE credit_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,                   -- 流水归属用户
  type            TEXT NOT NULL,                      -- 'consume' | 'grant' | 'deduct' | 'refund'
  status          TEXT NOT NULL,                      -- 'reserved' | 'settled' | 'refunded' (consume 用) | 'done' (grant/deduct/refund 用)
  scope           TEXT,                               -- 'text.chat' / 'image.gen' / 'video.merge' / 'tts.synth' / 'admin.grant'
  service_type    TEXT,                               -- 'text' | 'image' | 'video' | 'tts'
  model           TEXT,                               -- 调用的模型名
  estimated       INTEGER NOT NULL DEFAULT 0,         -- 预扣金额
  real_cost       INTEGER NOT NULL DEFAULT 0,         -- settle 后真实金额
  price_snapshot  TEXT,                               -- JSON: {unit:'per_1k_input',price:30,prompt_tokens:1500,...}
  drama_id        INTEGER,                            -- 业务关联
  episode_id      INTEGER,
  scene_key       TEXT,                               -- 'storyboard.angle' / 'prop.image' 等
  operator_id     INTEGER,                            -- grant/deduct 的操作者（admin / super_admin）
  note            TEXT,                               -- 必填备注（grant/deduct）/ 调用错误信息（refund）
  error           TEXT,                               -- refund 时的失败原因
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_credit_ledger_user      ON credit_ledger(user_id, created_at DESC);
CREATE INDEX idx_credit_ledger_status    ON credit_ledger(status, created_at);
CREATE INDEX idx_credit_ledger_scope     ON credit_ledger(scope, created_at DESC);
```

### credit_pricing 表（计价表）

```sql
CREATE TABLE credit_pricing (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_type    TEXT NOT NULL,                      -- 'text' | 'image' | 'video' | 'tts'
  model           TEXT NOT NULL,                      -- 模型名（如 'claude-sonnet-4'），'*' 表示该 service_type 的兜底
  unit            TEXT NOT NULL,                      -- 'per_1k_input' | 'per_1k_output' | 'per_image' | 'per_second' | 'per_1k_chars'
  price           INTEGER NOT NULL,                   -- 每单位多少积分
  is_active       INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(service_type, model, unit)
);
```

文本类需要 input / output 两条记录（不同单价）。其他服务通常一条。

### 全局设置（global_settings 复用）

新增几个 key：
- `credits.signup_bonus`：新用户注册赠送积分（默认 5000）
- `credits.default_pricing.text.input` / `.text.output` / `.image` / `.video` / `.tts`：兜底单价
- `credits.low_balance_threshold`：低余额提示阈值（默认 1000，前端 banner 用）

## 组件设计

### 1. creditService（核心）

`backend-node/src/services/creditService.js`，纯数据库操作 + 状态机：

- `getBalance(db, userId)` → 当前余额
- `reserve(db, userId, amount, scope, biz)` → ledgerId（事务内余额校验 + 预扣 + 写流水）
- `settle(db, ledgerId, realUsage, priceSnapshot)` → 真实金额对账
- `refund(db, ledgerId, reason)` → 全额退
- `grant(db, userId, amount, operatorId, note)` → 管理员加积分（type='grant'，直接 done）
- `deduct(db, userId, amount, operatorId, note)` → 管理员扣积分（type='deduct'）
- `listLedger(db, { userId?, status?, scope?, page })` → 流水分页查询
- `getStats(db)` → super_admin 总览（总充值 / 总消耗 / 总余额）

所有写操作走 `BEGIN IMMEDIATE` 事务保证原子性。

### 2. withCredits 包装器

`backend-node/src/services/creditWrapper.js`：

```js
function withCredits(scope, originalFn, { estimate, settle: settleHook }) {
  return async function billed(db, log, opts) {
    const userId = opts.user_id;
    if (!userId) throw new Error('withCredits: opts.user_id is required');
    const { estimated, snapshot } = estimate(db, opts);
    const ledgerId = creditService.reserve(db, userId, estimated, scope, {
      service_type: snapshot.service_type,
      model: snapshot.model,
      drama_id: opts.drama_id,
      episode_id: opts.episode_id,
      scene_key: opts.scene_key,
      price_snapshot: snapshot,
    });
    try {
      const result = await originalFn(db, log, opts);
      const realCost = settleHook(result, snapshot);
      creditService.settle(db, ledgerId, realCost, snapshot);
      return result;
    } catch (err) {
      creditService.refund(db, ledgerId, err.message || 'unknown');
      throw err;
    }
  };
}
```

每个 AI client 在 `module.exports` 时套上即可：

```js
module.exports = {
  generateText: withCredits('text.chat', _generateText, {
    estimate: (db, opts) => estimateText(db, opts),
    settle: (result, snapshot) => textCostFromUsage(result.usage, snapshot),
  }),
  // ...
};
```

### 3. estimator / settler（每个服务一对）

`backend-node/src/services/creditPricing.js`，纯函数：

- **text**：estimate 按"上限满额估"——`prompt_tokens 上限 = ceil(prompt 字节长度 / 2)`（中文偏保守的近似），`completion_tokens 上限 = max_tokens`，分别按 input / output 单价相加。settle 用真实 `usage.prompt_tokens` / `usage.completion_tokens`。**需要在 aiClient 流式请求里加 `stream_options: { include_usage: true }`** 才能拿到真实 usage；如响应中没有 usage（部分代理不支持），settle 时按 estimate 全额结算并写 warn 日志。
- **image**：estimate / settle 都按 `n × per_image`。极少数按 megapixel 计费的模型走另一条单价。
- **video**：estimate 按"用户请求的 duration_seconds 上限"，settle 按厂商返回的真实 duration。如厂商不返真实秒数，按 estimated 结算。
- **tts**：estimate / settle 都按 `Math.ceil(text.length / 1000) × per_1k_chars`。

每个 estimator 内部自动 fallback 到 `credits.default_pricing.<service>` 兜底价（漏配模型时），并写 warn 日志。

### 4. 错误响应（402）

`creditService.reserve` 余额不足时 throw 自定义错误：

```js
class InsufficientCreditsError extends Error {
  constructor({ required, balance, scope, model }) {
    super('INSUFFICIENT_CREDITS');
    this.code = 'INSUFFICIENT_CREDITS';
    this.statusCode = 402;
    this.required = required;
    this.balance = balance;
    this.shortfall = required - balance;
    this.scope = scope;
    this.model = model;
  }
}
```

Express 全局错误中间件识别 `err.code === 'INSUFFICIENT_CREDITS'` 时统一返：

```json
{
  "error": "INSUFFICIENT_CREDITS",
  "message": "积分不足，无法完成本次调用",
  "required": 1500,
  "current_balance": 320,
  "shortfall": 1180,
  "service_type": "text",
  "model": "claw-claude-sonnet-4",
  "hint": "请联系管理员充值，或在「我的积分」页查看消耗明细"
}
```

### 5. 路由

`backend-node/src/routes/credits.js`：

| 路径 | 方法 | 权限 | 用途 |
|---|---|---|---|
| `/credits/balance` | GET | 登录 | 自己的余额（顶部 badge 用） |
| `/credits/ledger` | GET | 登录 | 自己的流水（分页 + scope/status 筛选） |
| `/credits/users/:id/balance` | GET | super_admin / admin | admin 只能看自己创建的 user，super_admin 不限 |
| `/credits/users/:id/ledger` | GET | super_admin / admin | 同上 |
| `/credits/users/:id/grant` | POST | super_admin / admin | admin 调用时强制：目标用户 role 必须是 'user' 且 created_by = 当前 admin。super_admin 不限。amount > 0、note 必填 |
| `/credits/users/:id/deduct` | POST | super_admin | amount > 0、note 必填，扣到底为 0 不允许扣成负数 |
| `/credits/pricing` | GET / POST / PUT / DELETE | super_admin | 计价表 CRUD |
| `/credits/stats` | GET | super_admin | 系统总览 |
| `/credits/settings` | GET / PUT | super_admin | 注册赠送、兜底单价等系统设置 |

权限通过现有的 `requireSuperAdmin` / `requireAdminOrAbove` middleware 守卫。admin 端的"目标用户限制"在路由 handler 内显式校验（参考 `userService` 已有的 `created_by` 字段；如该字段不存在，则按现有约定：admin 创建的用户记录在 `users.created_by` 列，没有则在 migration 23 一并补齐）。

### 6. 前端 UI

`frontweb/` 下：

- **顶部 badge**：`AppHeader.vue` 加一个积分余额徽章（点击进 `/my/credits`），所有登录用户可见
- **「我的积分」页**：`MyCredits.vue`，包含「余额卡片」+「消费流水表」（分页 + service_type / status 筛选）
- **「用户管理」页**：`UserManagement.vue` 新增「积分余额」列 + 行内操作「充值 / 扣减 / 流水」
  - admin 只看自己创建的 user
  - super_admin 看所有人
- **「积分管理」页**（super_admin 专属）：`AdminCredits.vue`
  - 「总览」tab：总充值 / 总消耗 / 总余额 / Top10 消耗用户
  - 「计价表」tab：CRUD 表格
  - 「全局流水」tab：可按用户筛选
  - 「系统设置」tab：注册赠送、兜底单价、低余额阈值
- **402 全局拦截**：`request.js` axios 响应拦截器识别 `INSUFFICIENT_CREDITS`，统一弹 `InsufficientCreditsModal.vue`，显示缺多少 + 当前余额 + 业务上下文（service_type / model）。提示文案分两档：
  - 普通 user：「积分不足，请联系管理员充值」+ 「查看消耗明细」按钮跳「我的积分」页
  - admin / super_admin：「积分不足」+ 「前往用户管理给自己充值」按钮跳「用户管理」页（admin 可让 super_admin 充，或自己给 user 充值的逻辑分清楚）

## 实施步骤（高层）

1. **migration 23**：在 `backend-node/src/db/migrate.js` 的 `runMigrations` 内追加（沿用现有内联风格，不引入 SQL 文件）：
   - 建 `credit_ledger` 表 + 3 个索引
   - 建 `credit_pricing` 表 + UNIQUE 约束
   - users 加 4 列（`credit_balance` / `credit_total_recharged` / `credit_total_consumed` / `created_by`）
   - `ensureColumns(users, ...)` 兜底补列
   - 写入计价表初始数据：常见模型一次性 INSERT（claude / gpt / seedream / seedance / 火山 tts 等）
   - 写入 `global_settings` 默认值：`credits.signup_bonus = 5000` / 各 service_type 兜底单价 / `credits.low_balance_threshold = 1000`
2. **核心层**：`creditService` + `creditWrapper` + `creditPricing` + `InsufficientCreditsError`
3. **包装 AI client**：给 `aiClient` / `imageClient` / `videoClient` / `ttsService` 套包装器（**所有调用方必须显式传 `user_id`**）；同步给文本流式补 `include_usage`；定位所有 caller，自顶向下贯通 user_id（routes → service → client）
4. **路由 + 权限**：`/credits/*` 一组路由 + Express 全局错误中间件识别 402
5. **前端**：4 个页面/组件 + 1 个全局拦截（顶部 badge / MyCredits / UserManagement 列扩展 / AdminCredits / InsufficientCreditsModal）
6. **注册赠送**：`userService.createUser` 内部调用 `creditService.grant(newUserId, signup_bonus, system, '注册赠送')`，写入流水
7. **验收**：curl 矩阵覆盖三角色 × 各服务的扣费 / 拦截 / 退款；浏览器跑一次 video.merge 全流程验真实预扣对账
8. **部署**：先 VACUUM INTO 备份生产 db，再走标准 deploy-standards.md 流程

## 已知边界 / YAGNI

- **不做支付集成**：充值码 / 卡密 / 微信支付 / 支付宝都先不做。手动加积分 + 备注足够现阶段
- **不做"预估消耗"对话框**：调用前不弹"预计扣 N 积分,是否继续"。原因：文本类无法准确预估,反而引发争议
- **不做月配额 / 套餐**：只做"积分池"模型,不做"每月送 X 积分自动续杯"
- **不做 admin 配额池**：admin 给 user 充值不限额,admin 自己的余额也不会因为给 user 充值而减少
- **不做 super_admin 给自己 / admin 加积分的限制**：可任意操作（管理员账号需要独立 audit log,本期不做）
- **不做 prompt 内容审计**：流水只记元数据,不存 prompt / response 内容
- **历史数据**：现有所有用户的 `credit_balance` 默认 0；super_admin 部署后手动初始化首批账户

## 角色权限矩阵补充

| 能力 | super_admin | admin | user |
|---|---|---|---|
| 看自己余额 / 流水 | ✅ | ✅ | ✅ |
| 调用 AI 扣自己积分 | ✅ | ✅ | ✅ |
| 给任意用户加积分 | ✅ | ❌ | ❌ |
| 给自己创建的 user 加积分 | ✅ | ✅ | ❌ |
| 给任意用户扣积分 | ✅ | ❌ | ❌ |
| 看任意用户余额/流水 | ✅ | 仅自己创建的 user | ❌ |
| 维护计价表 | ✅ | ❌ | ❌ |
| 系统总览 / 系统设置 | ✅ | ❌ | ❌ |

注：super_admin 自己也走扣费机制（即使他能给自己加积分），以保证消耗统计的完整性。
