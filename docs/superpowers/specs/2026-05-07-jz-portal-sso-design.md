# jz.aijianshou.com 门户 + 模块级权限 + 轻量 SSO 设计

> 日期：2026-05-07
> 范围：新建 jz.aijianshou.com 门户（前后端），把 miniDrama（漫剧）和 Novel（网文）作为可配置模块挂在门户下，超级管理员通过 UI 控制每个用户能看到哪些模块；用户在门户登录一次，点模块卡片直接 SSO 跳转到子产品对应功能页。

---

## 1. 目标与范围

### 1.1 目标

- 新建一个**门户**（域名 `jz.aijianshou.com`），登录后展示**模块卡片网格**
- 模块由**超级管理员**通过 UI 配置（增/删/改/启停）
- 每个**用户**能看到哪些模块，由超管在 UI 上勾选
- 用户点模块卡片，**轻量 SSO** 跳转到子产品（漫剧 / Novel / 未来更多）的对应页面，不需要二次登录
- 默认上线后预置两个模块：**IP 改编、网文改写**（指向 Novel）。漫剧、剧本审核等由超管自己添加

### 1.2 不在本次范围

- **不接管**子产品的数据库或业务逻辑。Novel 的 Prisma 库、漫剧的 SQLite 库各管各的，不挪表
- **不做**全局登出（用户在门户登出 ≠ 自动登出所有子产品）
- **不做**手机号/邮箱/找回密码（只做最小账号体系：username + password + display_name + role）
- **不做**模块内角色映射（漫剧自己的 super_admin/admin/user 由漫剧管，门户不管）
- **不接**第三方登录（微信、钉钉等）

---

## 2. 整体架构

```
                ┌─────────────────────────┐
                │   jz.aijianshou.com     │  新增
                │  ┌─────────────────┐    │
                │  │ portal-frontweb │    │  Vue3 + Element Plus
                │  └────────┬────────┘    │
                │           │ /api/portal │
                │  ┌────────▼────────┐    │
                │  │ portal-backend  │    │  Node + Express + better-sqlite3
                │  │  端口 3012        │    │
                │  │  portal.db      │    │  3 张表
                │  │  RSA 私钥签 SSO  │    │
                │  └─────────────────┘    │
                └───────┬─────────┬───────┘
                        │ SSO     │ SSO
                        ▼         ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ aimj.aijianshou  │  │  jb.aijianshou   │
        │   miniDrama      │  │     Novel        │
        │  端口 3011         │  │  端口 3000        │
        │  drama.db        │  │  dev.db (Prisma) │
        │  + SSO 中间件     │  │  + SSO 中间件     │
        └──────────────────┘  └──────────────────┘
            (mj 服务器)         (jb 服务器)
```

**核心约束**：
- 三个项目数据库不混用，各自的业务表完全不动
- portal 是唯一"用户来源"，子产品本地 users 表加一列 `portal_user_id` 作为投影锚点
- portal 管"模块可见性"，子产品内角色由各自后端管
- miniDrama 现有的 `/login` 本地登录**保留**作为 fallback（portal 宕机时仍可直登 aimj）

---

## 3. 数据模型

### 3.1 portal.db（新建）

放在 `portal-backend/data/portal.db`，启动时自动跑 migration。

```sql
-- 中心用户表
CREATE TABLE portal_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                -- bcrypt
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user', -- super_admin / user
  status        TEXT NOT NULL DEFAULT 'active', -- active / disabled
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 模块注册表（数据驱动 + 超管 UI 可 CRUD）
CREATE TABLE portal_modules (
  code          TEXT PRIMARY KEY,             -- 'novel-rewrite' / 'novel-ip' / 'drama' / ...
  name          TEXT NOT NULL,                -- '网文改写'
  description   TEXT,
  icon          TEXT,                         -- emoji 或图标 URL
  target_url    TEXT NOT NULL,                -- https://jb.aijianshou.com
  sso_path      TEXT NOT NULL DEFAULT '/sso', -- /sso（子产品 SSO 入口固定路径）
  redirect_path TEXT NOT NULL DEFAULT '/',    -- 跳进子产品后落地路径，如 /novel-rewrite
  product_tag   TEXT NOT NULL,                -- 'novel' / 'drama'，作为 SSO JWT 的 aud
  sort_order    INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户 × 模块授权表
CREATE TABLE portal_user_modules (
  user_id       INTEGER NOT NULL,
  module_code   TEXT NOT NULL,
  granted_by    INTEGER,
  granted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, module_code),
  FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE,
  FOREIGN KEY (module_code) REFERENCES portal_modules(code) ON DELETE CASCADE
);

CREATE INDEX idx_portal_user_modules_user ON portal_user_modules(user_id);

-- SSO token 防重放表（jti 唯一）
CREATE TABLE consumed_sso_tokens (
  jti     TEXT PRIMARY KEY,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

> 注：`consumed_sso_tokens` 表实际由**子产品**各自维护（在 miniDrama 后端、Novel 后端各建一张同名表）；portal 自身不需要这张表（portal 不收 SSO token，只签发）。

### 3.2 子产品本地 users 表变更

漫剧（`backend-node/data/drama_generator.db`）和 Novel（`back-end/prisma/schema.prisma`）各自的 `users` 表新增：

```sql
ALTER TABLE users ADD COLUMN portal_user_id INTEGER UNIQUE;
```

- 首次 SSO 进来时，按 `portal_user_id` 找不到本地 user 就自动 INSERT 一行（role 默认 `user`，username 沿用 portal username，撞名时附 `_p${portal_id}` 后缀）
- 业务表的 `user_id` 外键继续指向**子产品本地 users.id**，不变

---

## 4. SSO 流程

### 4.1 Token 形式

- **JWT，RSA-256 非对称签名**
- portal-backend 用私钥签，子产品用本地缓存的公钥验
- TTL = **2 分钟**（仅用于"跳转一次"，到达子产品后子产品发自己的长 token）

### 4.2 Payload

```json
{
  "iss": "portal",
  "aud": "novel",                    // product_tag
  "sub": 42,                         // portal_user_id
  "username": "zhx",
  "display_name": "张三",
  "portal_role": "user",
  "module_code": "novel-rewrite",    // 仅做日志/审计
  "jti": "uuid-v4",
  "iat": 1746604800,
  "exp": 1746604920
}
```

### 4.3 跳转流程

```
浏览器                   portal-backend           子产品-backend
  │                          │                         │
  │ POST /api/portal/sso/issue                         │
  │  body: {module_code: 'novel-rewrite'}              │
  ├─────────────────────────►│                         │
  │                          │ 校验 portal_token、     │
  │                          │ 校验 user 已授权该 module、│
  │                          │ 校验 module enabled=1   │
  │                          │ 查 module 拿            │
  │                          │  target_url+redirect    │
  │                          │ 用私钥签 2 分钟 JWT      │
  │ 200 {sso_token, jump_url}│                         │
  │  jump_url = `${target_url}${sso_path}?token=xxx&redirect=${redirect_path}`
  │◄─────────────────────────┤                         │
  │                          │                         │
  │ window.location.href = jump_url                    │
  ├───────────────────────────────────────────────────►│
  │                                                    │ /api/auth/sso?token=xxx&redirect=/...
  │                                                    │ 1. 用本地公钥验签
  │                                                    │ 2. 校验 aud === 自身 product_tag
  │                                                    │ 3. 校验 jti 未消费 → INSERT consumed_sso_tokens
  │                                                    │ 4. 找/建本地 user(portal_user_id=42)
  │                                                    │ 5. 校验本地 user.status !== 'disabled'
  │                                                    │ 6. 签发本地长 token，写 Cookie/localStorage
  │ 302 → ${redirect}（默认 '/'）                       │
  │◄───────────────────────────────────────────────────┤
  │                                                    │
  │ 进入子产品对应页面（已登录态）
```

### 4.4 错误处理

| 场景 | 子产品 SSO 中间件行为 |
|---|---|
| 签名/过期/iss 错 | 302 → `/login?sso_error=invalid` |
| aud 错（漫剧 token 拿到 Novel 用） | 302 → `/login?sso_error=invalid` |
| jti 已使用过 | 302 → `/login?sso_error=replay` |
| 本地 user.status=disabled | 302 → `/login?sso_error=disabled` |
| 验签时钟漂移 | 给 30 秒 `clockTolerance` |

### 4.5 公钥分发

- portal-backend 启动时检测 `keys/portal-private.pem`，没有就报错退出（不自动生成，由部署脚本一次性生成）
- portal-backend 暴露 `GET /api/portal/pubkey`（公开接口）
- 子产品**手动拷一次**公钥到本地 `keys/portal-public.pem`（部署脚本里 scp）。不做启动期网络拉取，避免引入运行时依赖

---

## 5. 文件结构

```
miniDrama/
├── backend-node/                   # 现有
│   ├── src/
│   │   ├── middleware/
│   │   │   └── portalSso.js        # 新增
│   │   └── routes/
│   │       └── auth.js             # 现有，加挂 /sso 子路由
│   ├── migrations/
│   │   └── 023_add_portal_user_id.sql  # 新增
│   └── keys/
│       └── portal-public.pem       # gitignored，部署时拷
│
├── portal-backend/                 # 新增子项目
│   ├── src/
│   │   ├── server.js
│   │   ├── app.js
│   │   ├── config.js
│   │   ├── db/
│   │   │   ├── index.js
│   │   │   └── migrate.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   └── requireSuperAdmin.js
│   │   ├── routes/
│   │   │   ├── auth.js             # /login /logout /me
│   │   │   ├── pubkey.js           # /pubkey
│   │   │   ├── sso.js              # /sso/issue
│   │   │   ├── modules.js          # /modules（当前用户可见）
│   │   │   └── admin/
│   │   │       ├── users.js        # 用户 CRUD + 重置密码 + 启停
│   │   │       ├── userModules.js  # 用户 × 模块授权
│   │   │       └── modules.js      # 模块 CRUD
│   │   └── services/
│   │       ├── jwtSigner.js        # RSA 签名
│   │       └── pwd.js              # bcrypt
│   ├── migrations/
│   │   └── 001_init.sql
│   ├── data/
│   │   ├── portal.db               # gitignored
│   │   └── seeds/
│   │       └── default_modules.sql
│   ├── keys/                       # gitignored
│   │   ├── portal-private.pem
│   │   └── portal-public.pem
│   ├── configs/
│   │   └── config.yaml
│   ├── tools/
│   │   └── migrate-existing-users.cjs  # 一次性迁移 miniDrama 现有用户
│   ├── tmp/                        # gitignored
│   ├── ecosystem.config.cjs
│   └── package.json
│
├── portal-frontweb/                # 新增子项目
│   ├── src/
│   │   ├── main.js
│   │   ├── App.vue
│   │   ├── router/index.js
│   │   ├── stores/
│   │   │   └── user.js
│   │   ├── api/
│   │   │   ├── request.js
│   │   │   ├── auth.js
│   │   │   ├── modules.js
│   │   │   └── admin.js
│   │   ├── views/
│   │   │   ├── Login.vue
│   │   │   ├── Workspace.vue       # 模块卡片网格
│   │   │   └── admin/
│   │   │       ├── UserList.vue
│   │   │       ├── UserModules.vue # 给用户配模块
│   │   │       └── ModuleList.vue  # 模块 CRUD
│   │   └── components/
│   │       ├── ModuleCard.vue
│   │       └── ModuleFormDialog.vue
│   ├── vite.config.js
│   └── package.json
│
└── docs/superpowers/specs/
    └── 2026-05-07-jz-portal-sso-design.md  # 本文件
```

**Novel 仓库变更**（独立提交，不进 miniDrama 仓库）：

```
Novel/back-end/
├── src/
│   ├── middleware/
│   │   └── portalSso.js            # 新增
│   └── app.js                      # 加挂 /api/auth/sso 路由
├── prisma/
│   └── schema.prisma               # User model 加 portalUserId Int? @unique
├── prisma/migrations/<时间戳>_add_portal_user_id/migration.sql
└── keys/
    └── portal-public.pem           # gitignored，部署时拷
```

---

## 6. API 契约

统一响应 `{ success: boolean, data?, message? }`（沿用 miniDrama 风格）。

### 6.1 portal-backend

#### 公开接口
| Method | 路径 | 说明 |
|---|---|---|
| POST | `/api/portal/auth/login` | `{username, password}` → `{token, user}`（HS256 portal_token，TTL 7 天） |
| GET | `/api/portal/pubkey` | 返回 RSA 公钥 PEM 文本 |
| GET | `/health` | 健康检查 |

#### 已登录用户接口
| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/portal/auth/me` | 当前用户信息 |
| POST | `/api/portal/auth/logout` | 前端清 token |
| GET | `/api/portal/modules` | 当前用户**可见**的模块列表（按 user_modules 过滤；按 sort_order 排） |
| POST | `/api/portal/sso/issue` | `{module_code}` → `{sso_token, jump_url}` |

#### 超管接口
| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/portal/admin/users` | 用户列表（分页 + 按 username 搜） |
| POST | `/api/portal/admin/users` | 创建用户 `{username, password, display_name, role}` |
| PATCH | `/api/portal/admin/users/:id` | 改 display_name/role/status（不能改自己） |
| POST | `/api/portal/admin/users/:id/reset-password` | 重置密码 |
| GET | `/api/portal/admin/users/:id/modules` | 该用户已授权 module_codes |
| PUT | `/api/portal/admin/users/:id/modules` | 全量替换 `{module_codes: [...]}` |
| GET | `/api/portal/admin/modules` | 模块列表（含 enabled=0 的） |
| POST | `/api/portal/admin/modules` | 新建模块 |
| PATCH | `/api/portal/admin/modules/:code` | 编辑模块 |
| DELETE | `/api/portal/admin/modules/:code` | 删除模块（级联删 user_modules） |

### 6.2 子产品（漫剧 + Novel 一致）

| Method | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/sso?token=xxx&redirect=/` | 验签 + 找/建 user + 发本地 token + 302 redirect |

### 6.3 错误码

- 401 未登录 / portal_token 无效
- 403 已登录但无权限（未授权模块 / 非超管）
- 404 资源不存在（user_id / module_code）
- 409 username 冲突 / module_code 冲突
- 500 内部错误（带 trace_id）

---

## 7. 前端 UX

### 7.1 路由

```js
[
  { path: '/login', component: Login, meta: { public: true } },
  { path: '/', component: Workspace, meta: { title: '工作台' } },
  { path: '/admin/users', component: UserList, meta: { requireSuperAdmin: true } },
  { path: '/admin/users/:id/modules', component: UserModules, meta: { requireSuperAdmin: true } },
  { path: '/admin/modules', component: ModuleList, meta: { requireSuperAdmin: true } },
]
```

### 7.2 工作台（`/`）

模块卡片网格（按 sort_order 排序，可按 product_tag 分组显示）：

```
┌──────────────────────────────────────────────────────────┐
│  AI 工作台                          张三 ▼  [退出]          │
├──────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │  🎭          │  │  📖           │  │  🎬          │          │
│  │ IP 改编    │  │ 网文改写    │  │ AI 漫剧    │          │
│  │ 小说→剧本  │  │ 网文流水线 │  │ 短剧生成    │          │
│  │ [进入 →]   │  │ [进入 →]   │  │ [进入 →]   │          │
│  └────────────┘  └────────────┘  └────────────┘          │
│                                                          │
│  超管可见：[👥 用户管理] [⚙ 模块管理]                       │
└──────────────────────────────────────────────────────────┘
```

**未授权模块**：默认**置灰可见**（hover 提示"未开通，请联系管理员"），通过 portal 配置项 `hide_unlicensed_modules`（默认 false）可切换为隐藏。

**点卡片行为**：调 `/sso/issue` → 拿 jump_url → `window.location.href = jump_url`（整页跳转，不开新窗口）。

### 7.3 用户管理（`/admin/users`）

表格列：ID / username / display_name / role / status / 操作（[配模块] [重置密码] [启用/禁用]）。

### 7.4 用户授权（`/admin/users/:id/modules`）

按 product_tag 分组的复选框列表：

```
为 张三 (zhx) 配置可访问模块

📖 网文（Novel）
   ☑ IP 改编
   ☑ 网文改写
   ☐ 剧本审核

🎬 漫剧（Drama）
   ☑ AI 漫剧

[取消] [保存]
```

PUT 整组，不逐个 toggle。

### 7.5 模块管理（`/admin/modules`）

表格 + [+ 新建模块] 按钮 + 行内 [编辑] [删除] [启用/禁用]。

新建/编辑表单字段：code（新建后只读）、name、description、icon（emoji 输入或 URL）、product_tag（下拉，预置 `novel/drama`，支持自定义）、target_url、sso_path（默认 `/sso`）、redirect_path（默认 `/`）、sort_order、enabled。

### 7.6 视觉

- UI 库：**Element Plus**（沿用 miniDrama）
- 移动端：卡片网格响应式，超管页 PC 优先（小屏改为卡片列）

---

## 8. 边界情况与错误处理

| 场景 | 处理 |
|---|---|
| portal 后端宕机 | 用户访问 `aimj.aijianshou.com/login` 直登（fallback） |
| SSO token 过期（>2min） | 302 → `/login?sso_error=expired` |
| portal 用户被禁用 | login 拒绝；调 `/me` 时识别为 disabled，前端强制登出 |
| 子产品本地 user.status=disabled | SSO 中间件 302 → `/login?sso_error=disabled` |
| 模块在 portal 被 enabled=0 | `/modules` 不返回；`/sso/issue` 拒；用户已经在子产品里的会话不打断 |
| 用户授权被撤销 | portal_token 仍有效但下次 `/modules` 刷新就消失；下次 `/sso/issue` 拒 |
| portal 私钥泄露 | 重新生成密钥对，重启 portal-backend，重新分发公钥；老 token 全部失效 |
| 时钟漂移 | 验签 `clockTolerance: 30s` |
| 同 jti 高并发重放 | `INSERT INTO consumed_sso_tokens(jti)` 唯一索引冲突即拒（依赖 SQLite 行锁） |
| portal & 子产品 username 撞名 | 不要求一致；首次 SSO 投影时本地 username = portal username，撞名加 `_p${portal_id}` 后缀 |
| consumed_sso_tokens 表无限增长 | 启动时清理 `<= now-1h` 的行；setInterval 每小时清一次 |
| 登录接口被暴力破解 | 加 IP 限流 5 次/分钟（内存 Map 实现） |

---

## 9. 测试策略

### 9.1 portal-backend 单元测试（Vitest）

| 模块 | 测试点 |
|---|---|
| `services/jwtSigner.js` | 签 + 验自洽；过期；aud 错；篡改 payload 失败 |
| `services/pwd.js` | bcrypt hash + verify |
| `routes/auth.js` | 登录成功 / 密码错 401 / 用户禁用 401 |
| `routes/sso.js` | 已授权 → 200；未授权 → 403；module disabled → 403；module 不存在 → 404 |
| `routes/admin/users.js` | 非超管 403；创建成功；username 重复 409；不能改自己的 role |
| `routes/admin/userModules.js` | PUT 全量替换正确；user/module 不存在 404 |
| `routes/admin/modules.js` | CRUD；删除级联清 user_modules |
| `db/migrate.js` | 空库跑 migration 三表存在；重复跑幂等 |

### 9.2 子产品 SSO 中间件测试

| 测试点 |
|---|
| 合法 token + 新 portal_user_id → 自动建本地 user，302 redirect |
| 合法 token + 已存在 portal_user_id → 复用本地 user |
| 过期 → 302 sso_error=expired |
| aud 错 → 302 sso_error=invalid |
| jti 重放 → 302 sso_error=replay |
| 本地 user disabled → 302 sso_error=disabled |
| redirect 参数被正确透传到 302 Location |

### 9.3 集成测试（手动 curl + 浏览器）

部署后必跑：

1. portal 登录 → /me → /modules 返回授权列表
2. 超管登录 → 创建用户 zhx → 给 zhx 授权 IP 改编+网文改写 → zhx 登录 → /modules 看到两个
3. zhx /sso/issue novel-ip → 拿到 jump_url → 浏览器访问 → 落地 Novel `/ip-adaptation` → Novel users 表有 portal_user_id=2 的行
4. 同一 jti token 立即用第二次 → sso_error=replay
5. 撤销 zhx 的 novel-ip → /sso/issue 返 403
6. fallback：超管在 aimj/login 用本地账号直登仍可用
7. 漫剧侧重复 3-5
8. 模块 CRUD：超管新建 `drama` 模块 → 给 zhx 授权 → zhx 工作台看到漫剧卡片 → 点击跳转 aimj 成功

### 9.4 前端

实跑浏览器（chrome-devtools MCP）：登录 → 工作台 → 点卡片 → 跳转 → 回门户。

---

## 10. 部署增量

### 10.1 mj 服务器（115.191.45.199）

1. **DNS**：阿里云解析 `jz.aijianshou.com` A 记录 → 115.191.45.199（与 aimj 同 IP，TTL 10min）
2. **生成 RSA 密钥对**：`openssl genrsa -out portal-private.pem 2048; openssl rsa -in portal-private.pem -pubout -out portal-public.pem`
3. **portal-backend**：`/home/deploy/apps/MiniDrama/portal-backend` 跑 `npm install`（编译 better-sqlite3）→ 拷 portal-private.pem 到 keys/ → 启动 PM2（进程名 `portal-backend`，端口 3012，cwd 同上）
4. **miniDrama 后端**：`git pull` → 拷 portal-public.pem 到 `backend-node/keys/` → 重启 PM2
5. **nginx**：新建 `jz.aijianshou.com` 站点，反代到 `127.0.0.1:3012`（与 aimj 同套路），certbot 签证
6. **portal-frontweb 构建**：本地 `npm run build` → scp `dist/` 到服务器 → portal-backend 自动 serve（同 miniDrama 模式：app.js serve `portal-frontweb/dist`）

### 10.2 jb 服务器（Novel）

1. Novel 仓库 `git pull` 拉新代码（含 SSO 中间件 + Prisma migration）
2. `cd back-end && npx prisma migrate deploy`
3. scp `portal-public.pem` 到 `back-end/keys/`
4. PM2 重启 `novel-backend`

### 10.3 数据初始化

migration 跑完后 seed：

```sql
-- 默认两个模块（Novel）
INSERT INTO portal_modules (code, name, description, icon, target_url, sso_path, redirect_path, product_tag, sort_order)
VALUES
  ('novel-ip',      'IP 改编',  '小说改编为剧本',     '🎭', 'https://jb.aijianshou.com', '/sso', '/ip-adaptation', 'novel', 10),
  ('novel-rewrite', '网文改写', '网文改编流水线',     '📖', 'https://jb.aijianshou.com', '/sso', '/novel-rewrite', 'novel', 20);

-- 初始超管
INSERT INTO portal_users (username, password_hash, display_name, role)
VALUES ('admin', '<bcrypt(初始密码)>', '超级管理员', 'super_admin');

-- 自动给超管授权所有模块
INSERT INTO portal_user_modules (user_id, module_code) VALUES (1, 'novel-ip'), (1, 'novel-rewrite');
```

> ⚠️ `redirect_path` 的实际值（`/ip-adaptation`、`/novel-rewrite`）需要在开发到 SSO 联调阶段去 Novel 仓库 `front-end/src/router/` 里查实际路由路径再回填到 seed 里。当前是占位值，**TBD-confirm**：联调阶段确认。

### 10.4 一次性用户迁移

`portal-backend/tools/migrate-existing-users.cjs`：

- 从 miniDrama 现有 `users` 表读所有用户
- 写入 `portal_users`（密码 hash 直接复用 bcrypt 兼容；role: super_admin→super_admin，admin/user→user）
- 默认授权 `drama` 模块（前提：超管已添加 drama 模块）
- 回填 miniDrama `users.portal_user_id`

Novel 现有用户**不自动迁移**，让用户首次走 portal 登录后由超管按 portal_user_id 重新关联（或事后补脚本）。

---

## 11. 范围内 / 范围外明确分界

### 范围内
- portal-backend 完整实现（认证 + 模块 CRUD + 用户管理 + SSO 签发）
- portal-frontweb 完整实现（登录 + 工作台 + 三个超管页）
- miniDrama 后端：SSO 中间件 + portal_user_id migration
- Novel 后端：SSO 中间件 + portal_user_id migration（在 Novel 仓库提交，独立部署）
- DNS + nginx + PM2 + 部署脚本
- miniDrama 现有用户一次性迁移

### 范围外（后续迭代）
- Novel 现有用户自动迁移
- 第三方登录（微信/钉钉）
- 全局登出（用户在 portal 登出同时登出所有子产品）
- 模块依赖关系（如"AI 漫剧依赖 AI 配置完成"）
- 审计日志（谁在什么时候改了什么权限）
- 找回密码 / 邮箱手机号

---

## 12. 待确认项（TBD）

| 项 | 说明 | 解决时机 |
|---|---|---|
| Novel 前端实际路由路径 | seed 里 `redirect_path` 占位 `/ip-adaptation` `/novel-rewrite`，需查 Novel `front-end/src/router/` 确认 | 开发到 SSO 联调阶段 |
| portal 初始 admin 密码 | seed SQL 里 `<bcrypt(初始密码)>` 的明文 | 部署前由用户决定 |
| portal 端口 3012 是否冲突 | mj 服务器还有 adcast-backend (3001) + minidrama-backend (3011)，3012 应该空闲 | 部署前 `ss -tlnp` 确认 |

---

更新日期：2026-05-07
