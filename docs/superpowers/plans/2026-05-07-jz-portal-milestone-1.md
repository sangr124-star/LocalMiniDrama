# jz Portal 里程碑 1 实现计划：portal 闭环 + miniDrama SSO 接入

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地完整跑通 jz 门户：portal-backend 提供登录/模块管理/SSO 签发，portal-frontweb 提供工作台和超管页，miniDrama 后端能验 portal 签发的 SSO token 并自动建/复用本地用户。本里程碑结束后，本地浏览器可完成"在 portal 登录 → 工作台点漫剧卡片 → 落地 aimj 已登录态"的完整链路。

**Architecture:** 在 miniDrama 仓库新增 `portal-backend/`（CommonJS + Express + better-sqlite3，沿用 miniDrama 风格）和 `portal-frontweb/`（Vue3 + Element Plus + Vite，沿用 frontweb 风格）。portal-backend 用 RSA 私钥签 2 分钟 JWT，miniDrama 后端用本地缓存的公钥验签。portal 数据库 `portal.db` 含 4 张表（portal_users/portal_modules/portal_user_modules/consumed_sso_tokens 后者其实给子产品用，portal 自己不需要），与 miniDrama 业务库完全分离。

**Tech Stack:**
- portal-backend: Node 18+, Express 4, better-sqlite3 11, jsonwebtoken 9（RSA + HS256 双用）, bcryptjs 2, js-yaml 4, uuid 10
- portal-frontweb: Vue 3.4, Vue Router 4, Pinia 2, Element Plus 2.5, Axios 1.6, Vite 5
- 测试: Vitest（portal-backend 引入，与现有 miniDrama 不冲突）

**范围外（后续里程碑）:** Novel 仓库改动 / 服务器部署 / 数据迁移脚本 / DNS / nginx / certbot。

---

## 文件清单

**新增文件（portal-backend）:**
- `portal-backend/package.json`
- `portal-backend/configs/config.yaml`
- `portal-backend/src/server.js`
- `portal-backend/src/app.js`
- `portal-backend/src/config.js`
- `portal-backend/src/logger.js`
- `portal-backend/src/db/index.js`
- `portal-backend/src/db/migrate.js`
- `portal-backend/src/services/jwtSigner.js`
- `portal-backend/src/services/pwd.js`
- `portal-backend/src/services/userService.js`
- `portal-backend/src/services/moduleService.js`
- `portal-backend/src/services/userModuleService.js`
- `portal-backend/src/middleware/auth.js`
- `portal-backend/src/middleware/requireSuperAdmin.js`
- `portal-backend/src/middleware/rateLimit.js`
- `portal-backend/src/routes/index.js`
- `portal-backend/src/routes/auth.js`
- `portal-backend/src/routes/pubkey.js`
- `portal-backend/src/routes/sso.js`
- `portal-backend/src/routes/modules.js`
- `portal-backend/src/routes/admin/users.js`
- `portal-backend/src/routes/admin/userModules.js`
- `portal-backend/src/routes/admin/modules.js`
- `portal-backend/migrations/001_init.sql`
- `portal-backend/migrations/002_seed_default_modules.sql`
- `portal-backend/tests/jwtSigner.test.js`
- `portal-backend/tests/pwd.test.js`
- `portal-backend/tests/auth.test.js`
- `portal-backend/tests/sso.test.js`
- `portal-backend/tests/admin.users.test.js`
- `portal-backend/tests/admin.modules.test.js`
- `portal-backend/tests/admin.userModules.test.js`
- `portal-backend/tests/migrate.test.js`
- `portal-backend/tests/_helpers.js`
- `portal-backend/.gitignore`
- `portal-backend/scripts/gen-keypair.cjs`

**新增文件（portal-frontweb）:**
- `portal-frontweb/package.json`
- `portal-frontweb/index.html`
- `portal-frontweb/vite.config.js`
- `portal-frontweb/src/main.js`
- `portal-frontweb/src/App.vue`
- `portal-frontweb/src/router/index.js`
- `portal-frontweb/src/stores/user.js`
- `portal-frontweb/src/api/request.js`
- `portal-frontweb/src/api/auth.js`
- `portal-frontweb/src/api/modules.js`
- `portal-frontweb/src/api/admin.js`
- `portal-frontweb/src/views/Login.vue`
- `portal-frontweb/src/views/Workspace.vue`
- `portal-frontweb/src/views/admin/UserList.vue`
- `portal-frontweb/src/views/admin/UserModules.vue`
- `portal-frontweb/src/views/admin/ModuleList.vue`
- `portal-frontweb/src/components/ModuleCard.vue`
- `portal-frontweb/src/components/ModuleFormDialog.vue`
- `portal-frontweb/.gitignore`

**新增文件（miniDrama 仓库根）:**
- `backend-node/migrations/24_users_portal_user_id.sql`
- `backend-node/src/middleware/portalSso.js`

**修改文件:**
- `backend-node/src/routes/index.js` — 注册 `/auth/sso` 路由
- `backend-node/src/services/userService.js` — 新增 `findByPortalUserId / createFromPortal` 函数
- `.gitignore` — 加 `portal-backend/data/` `portal-backend/keys/` `portal-backend/tmp/` `portal-frontweb/dist/`

---

## Task 1: portal-backend 项目骨架

**Files:**
- Create: `portal-backend/package.json`
- Create: `portal-backend/.gitignore`
- Create: `portal-backend/configs/config.yaml`

- [ ] **Step 1: 创建 package.json**

写入 `portal-backend/package.json`：

```json
{
  "name": "portal-backend",
  "version": "1.0.0",
  "description": "jz.aijianshou.com 门户后端",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "gen-keypair": "node scripts/gen-keypair.cjs"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "better-sqlite3": "^11.6.0",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "js-yaml": "^4.1.0",
    "jsonwebtoken": "^9.0.3",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

写入 `portal-backend/.gitignore`：

```
node_modules/
data/
keys/
tmp/
*.log
```

- [ ] **Step 3: 创建 configs/config.yaml**

写入 `portal-backend/configs/config.yaml`：

```yaml
app:
  name: jz Portal Backend
  version: 1.0.0
  debug: true
server:
  port: 3012
  host: 127.0.0.1
  cors_origins:
    - http://localhost:5174
database:
  path: ./data/portal.db
auth:
  portal_token_secret: dev-portal-token-secret-change-in-prod
  portal_token_ttl: 7d
  bcrypt_rounds: 10
  rsa_private_key_path: ./keys/portal-private.pem
  rsa_public_key_path: ./keys/portal-public.pem
  sso_token_ttl_seconds: 120
sso:
  clock_tolerance_seconds: 30
  consumed_token_retention_seconds: 3600
```

- [ ] **Step 4: 安装依赖**

Run: `cd portal-backend && npm install`
Expected: `node_modules/` 出现，无报错；package-lock.json 生成。

- [ ] **Step 5: Commit**

```bash
git add portal-backend/package.json portal-backend/.gitignore portal-backend/configs/config.yaml
git commit -m "feat(portal): 初始化 portal-backend 项目骨架（依赖+配置）"
```

---

## Task 2: portal-backend 配置加载与 logger

**Files:**
- Create: `portal-backend/src/config.js`
- Create: `portal-backend/src/logger.js`

- [ ] **Step 1: 创建 src/config.js**

写入 `portal-backend/src/config.js`：

```js
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadConfig() {
  const cfgPath = path.join(__dirname, '..', 'configs', 'config.yaml');
  const raw = fs.readFileSync(cfgPath, 'utf8');
  const cfg = yaml.load(raw);
  if (!cfg.server || !cfg.database || !cfg.auth) {
    throw new Error('config.yaml 缺少必要字段：server / database / auth');
  }
  return cfg;
}

module.exports = { loadConfig };
```

- [ ] **Step 2: 创建 src/logger.js**

写入 `portal-backend/src/logger.js`：

```js
function ts() { return new Date().toISOString(); }
function info(...args) { console.log('[INFO]', ts(), ...args); }
function warn(...args) { console.warn('[WARN]', ts(), ...args); }
function error(...args) { console.error('[ERROR]', ts(), ...args); }
function errorw(msg, fields) { console.error('[ERROR]', ts(), msg, JSON.stringify(fields || {})); }
function infow(msg, fields) { console.log('[INFO]', ts(), msg, JSON.stringify(fields || {})); }
module.exports = { info, warn, error, errorw, infow };
```

- [ ] **Step 3: Commit**

```bash
git add portal-backend/src/config.js portal-backend/src/logger.js
git commit -m "feat(portal): 配置加载与 logger 工具"
```

---

## Task 3: 数据库 migration 与初始化

**Files:**
- Create: `portal-backend/migrations/001_init.sql`
- Create: `portal-backend/migrations/002_seed_default_modules.sql`
- Create: `portal-backend/src/db/index.js`
- Create: `portal-backend/src/db/migrate.js`
- Test: `portal-backend/tests/migrate.test.js`
- Test: `portal-backend/tests/_helpers.js`

- [ ] **Step 1: 创建 migrations/001_init.sql**

写入 `portal-backend/migrations/001_init.sql`：

```sql
CREATE TABLE IF NOT EXISTS portal_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_modules (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT,
  target_url    TEXT NOT NULL,
  sso_path      TEXT NOT NULL DEFAULT '/sso',
  redirect_path TEXT NOT NULL DEFAULT '/',
  product_tag   TEXT NOT NULL,
  sort_order    INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portal_user_modules (
  user_id       INTEGER NOT NULL,
  module_code   TEXT NOT NULL,
  granted_by    INTEGER,
  granted_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, module_code),
  FOREIGN KEY (user_id) REFERENCES portal_users(id) ON DELETE CASCADE,
  FOREIGN KEY (module_code) REFERENCES portal_modules(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portal_user_modules_user ON portal_user_modules(user_id);

CREATE TABLE IF NOT EXISTS portal_migrations (
  filename TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: 创建 migrations/002_seed_default_modules.sql**

写入 `portal-backend/migrations/002_seed_default_modules.sql`：

```sql
INSERT OR IGNORE INTO portal_modules (code, name, description, icon, target_url, sso_path, redirect_path, product_tag, sort_order, enabled)
VALUES
  ('novel-ip',      'IP 改编',  '小说改编为剧本',     '🎭', 'https://jb.aijianshou.com', '/api/auth/sso', '/', 'novel', 10, 1),
  ('novel-rewrite', '网文改写', '网文改编流水线',     '📖', 'https://jb.aijianshou.com', '/api/auth/sso', '/', 'novel', 20, 1);
```

> 注：`redirect_path` 暂用 `/` 占位，部署 Novel 后由超管在 UI 上修正为实际路由。

- [ ] **Step 3: 创建 src/db/index.js**

写入 `portal-backend/src/db/index.js`：

```js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let _db = null;

function getDb(dbConfig) {
  if (_db) return _db;
  const dbPath = path.isAbsolute(dbConfig.path)
    ? dbConfig.path
    : path.join(__dirname, '..', '..', dbConfig.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

function resetDbForTest(testDbPath) {
  if (_db) { _db.close(); _db = null; }
  const db = new Database(testDbPath || ':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  _db = db;
  return db;
}

module.exports = { getDb, resetDbForTest };
```

- [ ] **Step 4: 创建 src/db/migrate.js**

写入 `portal-backend/src/db/migrate.js`：

```js
const fs = require('fs');
const path = require('path');

function runMigrations(db, logger) {
  db.exec(`CREATE TABLE IF NOT EXISTS portal_migrations (
    filename TEXT PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(
    db.prepare('SELECT filename FROM portal_migrations').all().map(r => r.filename)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO portal_migrations (filename) VALUES (?)').run(file);
      db.exec('COMMIT');
      if (logger) logger.info('migration applied:', file);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} 失败: ${e.message}`);
    }
  }
}

module.exports = { runMigrations };
```

- [ ] **Step 5: 创建 tests/_helpers.js**

写入 `portal-backend/tests/_helpers.js`：

```js
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/db/migrate');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  return db;
}

module.exports = { createTestDb };
```

- [ ] **Step 6: 创建 tests/migrate.test.js（先写失败测试）**

写入 `portal-backend/tests/migrate.test.js`：

```js
const { describe, it, expect } = require('vitest');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/db/migrate');

describe('runMigrations', () => {
  it('在空库上跑后三张表 + portal_migrations 表都存在', () => {
    const db = new Database(':memory:');
    runMigrations(db, null);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    expect(tables).toContain('portal_users');
    expect(tables).toContain('portal_modules');
    expect(tables).toContain('portal_user_modules');
    expect(tables).toContain('portal_migrations');
  });

  it('seed 默认两个模块', () => {
    const db = new Database(':memory:');
    runMigrations(db, null);
    const codes = db.prepare('SELECT code FROM portal_modules ORDER BY sort_order').all().map(r => r.code);
    expect(codes).toEqual(['novel-ip', 'novel-rewrite']);
  });

  it('重复跑幂等，不重复应用 migration', () => {
    const db = new Database(':memory:');
    runMigrations(db, null);
    runMigrations(db, null);
    const count = db.prepare('SELECT COUNT(*) AS n FROM portal_modules').get().n;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 7: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/migrate.test.js`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add portal-backend/migrations portal-backend/src/db portal-backend/tests/migrate.test.js portal-backend/tests/_helpers.js
git commit -m "feat(portal): 数据库 migration 框架与 init/seed SQL"
```

---

## Task 4: 密码服务 pwd

**Files:**
- Create: `portal-backend/src/services/pwd.js`
- Test: `portal-backend/tests/pwd.test.js`

- [ ] **Step 1: 写失败测试**

写入 `portal-backend/tests/pwd.test.js`：

```js
const { describe, it, expect } = require('vitest');
const { hashPassword, verifyPassword } = require('../src/services/pwd');

describe('pwd', () => {
  it('hashPassword 返回 bcrypt 串', () => {
    const h = hashPassword('hello123', 4);
    expect(h).toMatch(/^\$2[aby]\$/);
  });

  it('verifyPassword 正确密码返 true', () => {
    const h = hashPassword('hello123', 4);
    expect(verifyPassword('hello123', h)).toBe(true);
  });

  it('verifyPassword 错误密码返 false', () => {
    const h = hashPassword('hello123', 4);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd portal-backend && npx vitest run tests/pwd.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 src/services/pwd.js**

写入 `portal-backend/src/services/pwd.js`：

```js
const bcrypt = require('bcryptjs');

function hashPassword(plain, rounds) {
  const r = typeof rounds === 'number' ? rounds : 10;
  return bcrypt.hashSync(plain, r);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  try { return bcrypt.compareSync(plain, hash); } catch (_) { return false; }
}

module.exports = { hashPassword, verifyPassword };
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/pwd.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add portal-backend/src/services/pwd.js portal-backend/tests/pwd.test.js
git commit -m "feat(portal): bcrypt 密码 hash/verify 服务"
```

---

## Task 5: SSO JWT 签发与验证服务

**Files:**
- Create: `portal-backend/scripts/gen-keypair.cjs`
- Create: `portal-backend/src/services/jwtSigner.js`
- Test: `portal-backend/tests/jwtSigner.test.js`

- [ ] **Step 1: 创建密钥生成脚本**

写入 `portal-backend/scripts/gen-keypair.cjs`：

```js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const keysDir = path.join(__dirname, '..', 'keys');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

const privPath = path.join(keysDir, 'portal-private.pem');
const pubPath = path.join(keysDir, 'portal-public.pem');

if (fs.existsSync(privPath)) {
  console.log('已存在 portal-private.pem，跳过生成。如需重置请手动删除后再跑。');
  process.exit(0);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privPath, privateKey);
fs.writeFileSync(pubPath, publicKey);
console.log('密钥已生成:');
console.log('  ', privPath);
console.log('  ', pubPath);
```

- [ ] **Step 2: 生成密钥对（一次性）**

Run: `cd portal-backend && node scripts/gen-keypair.cjs`
Expected: `keys/portal-private.pem` 和 `keys/portal-public.pem` 出现。

- [ ] **Step 3: 写失败测试**

写入 `portal-backend/tests/jwtSigner.test.js`：

```js
const { describe, it, expect } = require('vitest');
const fs = require('fs');
const path = require('path');
const { createSigner, verifyToken } = require('../src/services/jwtSigner');

const privKey = fs.readFileSync(path.join(__dirname, '..', 'keys', 'portal-private.pem'), 'utf8');
const pubKey = fs.readFileSync(path.join(__dirname, '..', 'keys', 'portal-public.pem'), 'utf8');

describe('jwtSigner', () => {
  const signer = createSigner({ privateKey: privKey, ttlSeconds: 120 });

  it('签 + 验自洽', () => {
    const token = signer.sign({
      sub: 1, username: 'alice', display_name: 'Alice',
      portal_role: 'user', aud: 'drama', module_code: 'drama',
    });
    const payload = verifyToken(token, { publicKey: pubKey, audience: 'drama' });
    expect(payload.sub).toBe(1);
    expect(payload.username).toBe('alice');
    expect(payload.aud).toBe('drama');
    expect(payload.jti).toBeTruthy();
  });

  it('aud 错误验签失败', () => {
    const token = signer.sign({
      sub: 1, username: 'alice', display_name: 'Alice',
      portal_role: 'user', aud: 'drama', module_code: 'drama',
    });
    expect(() => verifyToken(token, { publicKey: pubKey, audience: 'novel' }))
      .toThrow();
  });

  it('过期 token 验签失败', () => {
    const expired = signer.sign({
      sub: 1, username: 'alice', display_name: 'A',
      portal_role: 'user', aud: 'drama', module_code: 'drama',
    }, { expiresIn: -1 });
    expect(() => verifyToken(expired, { publicKey: pubKey, audience: 'drama' }))
      .toThrow();
  });

  it('篡改 payload 验签失败', () => {
    const token = signer.sign({
      sub: 1, username: 'alice', display_name: 'A',
      portal_role: 'user', aud: 'drama', module_code: 'drama',
    });
    const parts = token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 999 })).toString('base64url');
    const tampered = parts.join('.');
    expect(() => verifyToken(tampered, { publicKey: pubKey, audience: 'drama' }))
      .toThrow();
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

Run: `cd portal-backend && npx vitest run tests/jwtSigner.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 5: 实现 src/services/jwtSigner.js**

写入 `portal-backend/src/services/jwtSigner.js`：

```js
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

function createSigner({ privateKey, ttlSeconds }) {
  if (!privateKey) throw new Error('jwtSigner: privateKey 必填');
  const ttl = ttlSeconds || 120;

  function sign(payload, options) {
    const opts = options || {};
    const expiresIn = typeof opts.expiresIn === 'number' ? opts.expiresIn : ttl;
    const jti = uuidv4();
    const fullPayload = Object.assign({}, payload, { iss: 'portal', jti });
    return jwt.sign(fullPayload, privateKey, {
      algorithm: 'RS256',
      expiresIn,
    });
  }

  return { sign };
}

function verifyToken(token, { publicKey, audience, clockTolerance }) {
  if (!publicKey) throw new Error('verifyToken: publicKey 必填');
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'portal',
    audience,
    clockTolerance: clockTolerance || 30,
  });
}

module.exports = { createSigner, verifyToken };
```

- [ ] **Step 6: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/jwtSigner.test.js`
Expected: 4 passed.

- [ ] **Step 7: Commit（不要把 keys/ 提交！）**

```bash
git add portal-backend/scripts portal-backend/src/services/jwtSigner.js portal-backend/tests/jwtSigner.test.js
git commit -m "feat(portal): RSA JWT 签发与验证（gen-keypair 脚本+签名服务）"
```

确认 keys/ 没被加入：`git status portal-backend/keys/` 应显示 untracked（已被 .gitignore）。

---

## Task 6: 用户服务（CRUD + 登录校验）

**Files:**
- Create: `portal-backend/src/services/userService.js`
- Test: `portal-backend/tests/userService.test.js`（合并到 admin.users.test.js 在 Task 11）

> 此任务实现 service 层，路由层在后续任务接入。

- [ ] **Step 1: 实现 src/services/userService.js**

写入 `portal-backend/src/services/userService.js`：

```js
const { hashPassword, verifyPassword } = require('./pwd');

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findById(db, id) {
  return db.prepare('SELECT * FROM portal_users WHERE id = ?').get(id);
}

function findByUsername(db, username) {
  return db.prepare('SELECT * FROM portal_users WHERE username = ?').get(username);
}

function listUsers(db, { keyword, limit = 50, offset = 0 } = {}) {
  let where = '';
  const params = [];
  if (keyword) {
    where = 'WHERE username LIKE ? OR display_name LIKE ?';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM portal_users ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM portal_users ${where} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { total, items: rows.map(rowToUser) };
}

function createUser(db, { username, password, display_name, role }, bcryptRounds) {
  if (!username || !password) throw new Error('username/password 必填');
  const exists = findByUsername(db, username);
  if (exists) {
    const err = new Error('用户名已存在');
    err.code = 'USERNAME_TAKEN';
    throw err;
  }
  const hash = hashPassword(password, bcryptRounds);
  const role_ = role === 'super_admin' ? 'super_admin' : 'user';
  const info = db.prepare(`INSERT INTO portal_users (username, password_hash, display_name, role)
    VALUES (?, ?, ?, ?)`).run(username, hash, display_name || null, role_);
  return rowToUser(findById(db, info.lastInsertRowid));
}

function updateUser(db, id, fields, currentUserId) {
  const existing = findById(db, id);
  if (!existing) {
    const err = new Error('用户不存在'); err.code = 'NOT_FOUND'; throw err;
  }
  if (id === currentUserId && (fields.role !== undefined || fields.status !== undefined)) {
    const err = new Error('不能修改自己的 role/status');
    err.code = 'CANNOT_MODIFY_SELF'; throw err;
  }
  const cols = [], vals = [];
  if (fields.display_name !== undefined) { cols.push('display_name = ?'); vals.push(fields.display_name); }
  if (fields.role !== undefined) {
    const r = fields.role === 'super_admin' ? 'super_admin' : 'user';
    cols.push('role = ?'); vals.push(r);
  }
  if (fields.status !== undefined) {
    const s = fields.status === 'disabled' ? 'disabled' : 'active';
    cols.push('status = ?'); vals.push(s);
  }
  if (cols.length === 0) return rowToUser(existing);
  cols.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(id);
  db.prepare(`UPDATE portal_users SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  return rowToUser(findById(db, id));
}

function resetPassword(db, id, newPassword, bcryptRounds) {
  if (!newPassword) throw new Error('newPassword 必填');
  const existing = findById(db, id);
  if (!existing) { const err = new Error('用户不存在'); err.code='NOT_FOUND'; throw err; }
  const hash = hashPassword(newPassword, bcryptRounds);
  db.prepare('UPDATE portal_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(hash, id);
  return true;
}

function authenticate(db, username, password) {
  const row = findByUsername(db, username);
  if (!row) return null;
  if (row.status === 'disabled') return { disabled: true };
  if (!verifyPassword(password, row.password_hash)) return null;
  return rowToUser(row);
}

function ensureSuperAdmin(db, { username, password, display_name }, bcryptRounds, logger) {
  const exists = findByUsername(db, username);
  if (exists) return rowToUser(exists);
  const hash = hashPassword(password, bcryptRounds);
  db.prepare(`INSERT INTO portal_users (username, password_hash, display_name, role)
    VALUES (?, ?, ?, 'super_admin')`).run(username, hash, display_name || username);
  if (logger) logger.info('已创建初始超级管理员:', username);
  return rowToUser(findByUsername(db, username));
}

module.exports = {
  rowToUser, findById, findByUsername, listUsers,
  createUser, updateUser, resetPassword,
  authenticate, ensureSuperAdmin,
};
```

- [ ] **Step 2: Commit**

```bash
git add portal-backend/src/services/userService.js
git commit -m "feat(portal): 用户 service（CRUD + 登录校验 + 初始超管创建）"
```

---

## Task 7: 模块服务

**Files:**
- Create: `portal-backend/src/services/moduleService.js`

- [ ] **Step 1: 实现 src/services/moduleService.js**

写入 `portal-backend/src/services/moduleService.js`：

```js
function rowToModule(r) {
  if (!r) return null;
  return {
    code: r.code, name: r.name, description: r.description, icon: r.icon,
    target_url: r.target_url, sso_path: r.sso_path, redirect_path: r.redirect_path,
    product_tag: r.product_tag, sort_order: r.sort_order,
    enabled: !!r.enabled,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function findByCode(db, code) {
  return db.prepare('SELECT * FROM portal_modules WHERE code = ?').get(code);
}

function listAll(db, { onlyEnabled } = {}) {
  const sql = onlyEnabled
    ? 'SELECT * FROM portal_modules WHERE enabled = 1 ORDER BY sort_order, code'
    : 'SELECT * FROM portal_modules ORDER BY sort_order, code';
  return db.prepare(sql).all().map(rowToModule);
}

function listForUser(db, userId) {
  return db.prepare(`
    SELECT m.* FROM portal_modules m
    JOIN portal_user_modules um ON um.module_code = m.code
    WHERE um.user_id = ? AND m.enabled = 1
    ORDER BY m.sort_order, m.code
  `).all(userId).map(rowToModule);
}

function createModule(db, fields) {
  const required = ['code', 'name', 'target_url', 'product_tag'];
  for (const k of required) {
    if (!fields[k]) { const err = new Error(`字段 ${k} 必填`); err.code='BAD_REQUEST'; throw err; }
  }
  if (findByCode(db, fields.code)) {
    const err = new Error('模块 code 已存在'); err.code='CODE_TAKEN'; throw err;
  }
  db.prepare(`INSERT INTO portal_modules
    (code, name, description, icon, target_url, sso_path, redirect_path, product_tag, sort_order, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      fields.code, fields.name, fields.description || null, fields.icon || null,
      fields.target_url,
      fields.sso_path || '/api/auth/sso',
      fields.redirect_path || '/',
      fields.product_tag,
      typeof fields.sort_order === 'number' ? fields.sort_order : 0,
      fields.enabled === false ? 0 : 1,
    );
  return rowToModule(findByCode(db, fields.code));
}

function updateModule(db, code, fields) {
  const existing = findByCode(db, code);
  if (!existing) { const err = new Error('模块不存在'); err.code='NOT_FOUND'; throw err; }
  const cols = [], vals = [];
  const allowed = ['name', 'description', 'icon', 'target_url', 'sso_path', 'redirect_path', 'product_tag', 'sort_order', 'enabled'];
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      cols.push(`${k} = ?`);
      if (k === 'enabled') vals.push(fields[k] ? 1 : 0);
      else vals.push(fields[k]);
    }
  }
  if (cols.length === 0) return rowToModule(existing);
  cols.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(code);
  db.prepare(`UPDATE portal_modules SET ${cols.join(', ')} WHERE code = ?`).run(...vals);
  return rowToModule(findByCode(db, code));
}

function deleteModule(db, code) {
  const existing = findByCode(db, code);
  if (!existing) { const err = new Error('模块不存在'); err.code='NOT_FOUND'; throw err; }
  db.prepare('DELETE FROM portal_modules WHERE code = ?').run(code);
  return true;
}

module.exports = {
  rowToModule, findByCode, listAll, listForUser,
  createModule, updateModule, deleteModule,
};
```

- [ ] **Step 2: Commit**

```bash
git add portal-backend/src/services/moduleService.js
git commit -m "feat(portal): 模块 service（CRUD + 按用户查询）"
```

---

## Task 8: 用户-模块授权服务

**Files:**
- Create: `portal-backend/src/services/userModuleService.js`

- [ ] **Step 1: 实现 src/services/userModuleService.js**

写入 `portal-backend/src/services/userModuleService.js`：

```js
function listCodesForUser(db, userId) {
  return db.prepare('SELECT module_code FROM portal_user_modules WHERE user_id = ?')
    .all(userId).map(r => r.module_code);
}

function setUserModules(db, userId, moduleCodes, grantedBy) {
  // 校验 user 存在
  const user = db.prepare('SELECT id FROM portal_users WHERE id = ?').get(userId);
  if (!user) { const err=new Error('用户不存在'); err.code='NOT_FOUND'; throw err; }
  // 校验所有 module_code 都存在
  if (Array.isArray(moduleCodes) && moduleCodes.length > 0) {
    const placeholders = moduleCodes.map(() => '?').join(',');
    const found = db.prepare(`SELECT code FROM portal_modules WHERE code IN (${placeholders})`)
      .all(...moduleCodes).map(r => r.code);
    const missing = moduleCodes.filter(c => !found.includes(c));
    if (missing.length > 0) {
      const err = new Error('模块不存在: ' + missing.join(','));
      err.code = 'MODULE_NOT_FOUND'; throw err;
    }
  }
  // 全量替换：事务里删旧 + 插新
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM portal_user_modules WHERE user_id = ?').run(userId);
    if (Array.isArray(moduleCodes)) {
      const ins = db.prepare(
        'INSERT INTO portal_user_modules (user_id, module_code, granted_by) VALUES (?, ?, ?)'
      );
      for (const code of moduleCodes) ins.run(userId, code, grantedBy || null);
    }
  });
  tx();
  return listCodesForUser(db, userId);
}

function userHasModule(db, userId, moduleCode) {
  const row = db.prepare('SELECT 1 FROM portal_user_modules WHERE user_id = ? AND module_code = ?')
    .get(userId, moduleCode);
  return !!row;
}

module.exports = { listCodesForUser, setUserModules, userHasModule };
```

- [ ] **Step 2: Commit**

```bash
git add portal-backend/src/services/userModuleService.js
git commit -m "feat(portal): 用户-模块授权 service"
```

---

## Task 9: portal_token 中间件 + 登录路由

**Files:**
- Create: `portal-backend/src/middleware/auth.js`
- Create: `portal-backend/src/middleware/requireSuperAdmin.js`
- Create: `portal-backend/src/middleware/rateLimit.js`
- Create: `portal-backend/src/routes/auth.js`
- Test: `portal-backend/tests/auth.test.js`

- [ ] **Step 1: 创建 src/middleware/auth.js**

写入 `portal-backend/src/middleware/auth.js`：

```js
const jwt = require('jsonwebtoken');
const userService = require('../services/userService');

function buildAuth({ db, secret, expiresIn }) {
  function signPortalToken(user) {
    return jwt.sign(
      { uid: user.id, username: user.username, role: user.role },
      secret,
      { expiresIn: expiresIn || '7d' }
    );
  }

  function authenticate(req, res, next) {
    let token = null;
    const h = req.headers.authorization;
    if (h && h.startsWith('Bearer ')) token = h.slice(7).trim();
    if (!token && req.query && req.query.token) token = String(req.query.token);
    if (!token) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    let decoded;
    try { decoded = jwt.verify(token, secret); }
    catch (_) { return res.status(401).json({ success: false, message: 'Token 无效或已过期' }); }
    const user = userService.findById(db, decoded.uid);
    if (!user) return res.status(401).json({ success: false, message: '用户不存在' });
    if (user.status === 'disabled') {
      return res.status(403).json({ success: false, message: '账号已禁用' });
    }
    req.user = userService.rowToUser(user);
    next();
  }

  return { signPortalToken, authenticate };
}

module.exports = { buildAuth };
```

- [ ] **Step 2: 创建 src/middleware/requireSuperAdmin.js**

写入 `portal-backend/src/middleware/requireSuperAdmin.js`：

```js
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: '需要超级管理员权限' });
  }
  next();
}
module.exports = { requireSuperAdmin };
```

- [ ] **Step 3: 创建 src/middleware/rateLimit.js**

写入 `portal-backend/src/middleware/rateLimit.js`：

```js
function buildIpRateLimit({ windowMs = 60000, max = 5 } = {}) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const now = Date.now();
    const arr = (buckets.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试' });
    }
    arr.push(now);
    buckets.set(ip, arr);
    next();
  };
}
module.exports = { buildIpRateLimit };
```

- [ ] **Step 4: 创建 src/routes/auth.js**

写入 `portal-backend/src/routes/auth.js`：

```js
const express = require('express');
const userService = require('../services/userService');

function buildAuthRouter({ db, signPortalToken, authenticate, loginRateLimit }) {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'username/password 必填' });
    }
    const result = userService.authenticate(db, username, password);
    if (!result) return res.status(401).json({ success: false, message: '用户名或密码错误' });
    if (result.disabled) return res.status(403).json({ success: false, message: '账号已禁用' });
    const token = signPortalToken(result);
    res.json({ success: true, data: { token, user: result } });
  });

  router.get('/me', authenticate, (req, res) => {
    res.json({ success: true, data: req.user });
  });

  router.post('/logout', authenticate, (req, res) => {
    res.json({ success: true });
  });

  return router;
}

module.exports = { buildAuthRouter };
```

- [ ] **Step 5: 写测试 tests/auth.test.js**

写入 `portal-backend/tests/auth.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const express = require('express');
const request = require('supertest');
const { createTestDb } = require('./_helpers');
const userService = require('../src/services/userService');
const { buildAuth } = require('../src/middleware/auth');
const { buildIpRateLimit } = require('../src/middleware/rateLimit');
const { buildAuthRouter } = require('../src/routes/auth');

function makeApp(db) {
  const { signPortalToken, authenticate } = buildAuth({
    db, secret: 'test-secret', expiresIn: '1h',
  });
  const app = express();
  app.use(express.json());
  const loginRateLimit = buildIpRateLimit({ windowMs: 60000, max: 100 });
  app.use('/api/portal/auth', buildAuthRouter({ db, signPortalToken, authenticate, loginRateLimit }));
  return { app, signPortalToken };
}

describe('auth routes', () => {
  let db, app, signPortalToken;
  beforeEach(() => {
    db = createTestDb();
    userService.createUser(db, { username: 'alice', password: 'a12345', display_name: 'Alice', role: 'user' }, 4);
    ({ app, signPortalToken } = makeApp(db));
  });

  it('正确密码返回 token', async () => {
    const res = await request(app).post('/api/portal/auth/login').send({ username: 'alice', password: 'a12345' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.username).toBe('alice');
  });

  it('错误密码 401', async () => {
    const res = await request(app).post('/api/portal/auth/login').send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('用户不存在 401', async () => {
    const res = await request(app).post('/api/portal/auth/login').send({ username: 'nouser', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('禁用账号 403', async () => {
    userService.updateUser(db, 1, { status: 'disabled' }, 999);
    const res = await request(app).post('/api/portal/auth/login').send({ username: 'alice', password: 'a12345' });
    expect(res.status).toBe(403);
  });

  it('/me 需要登录', async () => {
    const res = await request(app).get('/api/portal/auth/me');
    expect(res.status).toBe(401);
  });

  it('/me 带 token 返回当前用户', async () => {
    const u = userService.findByUsername(db, 'alice');
    const token = signPortalToken(userService.rowToUser(u));
    const res = await request(app).get('/api/portal/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('alice');
  });
});
```

- [ ] **Step 6: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/auth.test.js`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add portal-backend/src/middleware portal-backend/src/routes/auth.js portal-backend/tests/auth.test.js
git commit -m "feat(portal): portal_token 认证中间件 + 登录/me/logout 路由"
```

---

## Task 10: SSO 签发路由 + 公钥路由 + 用户可见模块路由

**Files:**
- Create: `portal-backend/src/routes/pubkey.js`
- Create: `portal-backend/src/routes/sso.js`
- Create: `portal-backend/src/routes/modules.js`
- Test: `portal-backend/tests/sso.test.js`

- [ ] **Step 1: 创建 src/routes/pubkey.js**

写入 `portal-backend/src/routes/pubkey.js`：

```js
const express = require('express');

function buildPubkeyRouter({ publicKeyPem }) {
  const router = express.Router();
  router.get('/pubkey', (req, res) => {
    res.type('text/plain').send(publicKeyPem);
  });
  return router;
}

module.exports = { buildPubkeyRouter };
```

- [ ] **Step 2: 创建 src/routes/modules.js**

写入 `portal-backend/src/routes/modules.js`：

```js
const express = require('express');
const moduleService = require('../services/moduleService');

function buildModulesRouter({ db, authenticate }) {
  const router = express.Router();
  router.get('/modules', authenticate, (req, res) => {
    if (req.user.role === 'super_admin') {
      // 超管能看到所有 enabled 模块
      const list = moduleService.listAll(db, { onlyEnabled: true });
      return res.json({ success: true, data: list });
    }
    const list = moduleService.listForUser(db, req.user.id);
    res.json({ success: true, data: list });
  });
  return router;
}

module.exports = { buildModulesRouter };
```

- [ ] **Step 3: 创建 src/routes/sso.js**

写入 `portal-backend/src/routes/sso.js`：

```js
const express = require('express');
const moduleService = require('../services/moduleService');
const userModuleService = require('../services/userModuleService');

function buildSsoRouter({ db, authenticate, signer }) {
  const router = express.Router();

  router.post('/sso/issue', authenticate, (req, res) => {
    const { module_code } = req.body || {};
    if (!module_code) {
      return res.status(400).json({ success: false, message: 'module_code 必填' });
    }
    const moduleRow = moduleService.findByCode(db, module_code);
    if (!moduleRow) return res.status(404).json({ success: false, message: '模块不存在' });
    if (!moduleRow.enabled) return res.status(403).json({ success: false, message: '模块已停用' });

    if (req.user.role !== 'super_admin') {
      const ok = userModuleService.userHasModule(db, req.user.id, module_code);
      if (!ok) return res.status(403).json({ success: false, message: '未授权该模块' });
    }

    const ssoToken = signer.sign({
      sub: req.user.id,
      username: req.user.username,
      display_name: req.user.display_name || req.user.username,
      portal_role: req.user.role,
      aud: moduleRow.product_tag,
      module_code: moduleRow.code,
    });

    const sep = moduleRow.sso_path.includes('?') ? '&' : '?';
    const target = `${moduleRow.target_url}${moduleRow.sso_path}${sep}token=${encodeURIComponent(ssoToken)}&redirect=${encodeURIComponent(moduleRow.redirect_path || '/')}`;
    res.json({ success: true, data: { sso_token: ssoToken, jump_url: target } });
  });

  return router;
}

module.exports = { buildSsoRouter };
```

- [ ] **Step 4: 写 tests/sso.test.js**

写入 `portal-backend/tests/sso.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createTestDb } = require('./_helpers');
const userService = require('../src/services/userService');
const moduleService = require('../src/services/moduleService');
const userModuleService = require('../src/services/userModuleService');
const { buildAuth } = require('../src/middleware/auth');
const { buildSsoRouter } = require('../src/routes/sso');
const { createSigner, verifyToken } = require('../src/services/jwtSigner');

const privKey = fs.readFileSync(path.join(__dirname, '..', 'keys', 'portal-private.pem'), 'utf8');
const pubKey = fs.readFileSync(path.join(__dirname, '..', 'keys', 'portal-public.pem'), 'utf8');

describe('sso/issue', () => {
  let db, app, signPortalToken;
  beforeEach(() => {
    db = createTestDb();
    userService.createUser(db, { username: 'alice', password: 'a12345', role: 'user' }, 4);
    userModuleService.setUserModules(db, 1, ['novel-ip'], null);
    const auth = buildAuth({ db, secret: 'test-secret', expiresIn: '1h' });
    signPortalToken = auth.signPortalToken;
    const signer = createSigner({ privateKey: privKey, ttlSeconds: 120 });
    app = express();
    app.use(express.json());
    app.use('/api/portal', buildSsoRouter({ db, authenticate: auth.authenticate, signer }));
  });

  function loginToken() {
    const u = userService.findByUsername(db, 'alice');
    return signPortalToken(userService.rowToUser(u));
  }

  it('已授权模块返 200 + jump_url 含 product_tag aud', async () => {
    const res = await request(app)
      .post('/api/portal/sso/issue')
      .set('Authorization', `Bearer ${loginToken()}`)
      .send({ module_code: 'novel-ip' });
    expect(res.status).toBe(200);
    expect(res.body.data.jump_url).toContain('https://jb.aijianshou.com');
    expect(res.body.data.jump_url).toContain('token=');
    const payload = verifyToken(res.body.data.sso_token, { publicKey: pubKey, audience: 'novel' });
    expect(payload.sub).toBe(1);
    expect(payload.module_code).toBe('novel-ip');
  });

  it('未授权模块 403', async () => {
    const res = await request(app)
      .post('/api/portal/sso/issue')
      .set('Authorization', `Bearer ${loginToken()}`)
      .send({ module_code: 'novel-rewrite' });
    expect(res.status).toBe(403);
  });

  it('模块不存在 404', async () => {
    const res = await request(app)
      .post('/api/portal/sso/issue')
      .set('Authorization', `Bearer ${loginToken()}`)
      .send({ module_code: 'nope' });
    expect(res.status).toBe(404);
  });

  it('模块禁用 403', async () => {
    moduleService.updateModule(db, 'novel-ip', { enabled: false });
    const res = await request(app)
      .post('/api/portal/sso/issue')
      .set('Authorization', `Bearer ${loginToken()}`)
      .send({ module_code: 'novel-ip' });
    expect(res.status).toBe(403);
  });

  it('未登录 401', async () => {
    const res = await request(app).post('/api/portal/sso/issue').send({ module_code: 'novel-ip' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/sso.test.js`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add portal-backend/src/routes/pubkey.js portal-backend/src/routes/sso.js portal-backend/src/routes/modules.js portal-backend/tests/sso.test.js
git commit -m "feat(portal): SSO issue 路由 + 用户可见模块查询 + 公钥导出"
```

---

## Task 11: 超管路由（用户管理）

**Files:**
- Create: `portal-backend/src/routes/admin/users.js`
- Test: `portal-backend/tests/admin.users.test.js`

- [ ] **Step 1: 创建 routes/admin/users.js**

写入 `portal-backend/src/routes/admin/users.js`：

```js
const express = require('express');
const userService = require('../../services/userService');

function buildAdminUsersRouter({ db, authenticate, requireSuperAdmin, bcryptRounds }) {
  const router = express.Router();
  router.use(authenticate, requireSuperAdmin);

  router.get('/users', (req, res) => {
    const { keyword, limit, offset } = req.query;
    const out = userService.listUsers(db, {
      keyword: keyword || undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, data: out });
  });

  router.post('/users', (req, res) => {
    try {
      const u = userService.createUser(db, req.body || {}, bcryptRounds);
      res.json({ success: true, data: u });
    } catch (e) {
      if (e.code === 'USERNAME_TAKEN') return res.status(409).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  router.patch('/users/:id', (req, res) => {
    try {
      const u = userService.updateUser(db, parseInt(req.params.id, 10), req.body || {}, req.user.id);
      res.json({ success: true, data: u });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'CANNOT_MODIFY_SELF') return res.status(400).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  router.post('/users/:id/reset-password', (req, res) => {
    const { new_password } = req.body || {};
    if (!new_password) return res.status(400).json({ success: false, message: 'new_password 必填' });
    try {
      userService.resetPassword(db, parseInt(req.params.id, 10), new_password, bcryptRounds);
      res.json({ success: true });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { buildAdminUsersRouter };
```

- [ ] **Step 2: 写 tests/admin.users.test.js**

写入 `portal-backend/tests/admin.users.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const express = require('express');
const request = require('supertest');
const { createTestDb } = require('./_helpers');
const userService = require('../src/services/userService');
const { buildAuth } = require('../src/middleware/auth');
const { requireSuperAdmin } = require('../src/middleware/requireSuperAdmin');
const { buildAdminUsersRouter } = require('../src/routes/admin/users');

function makeApp(db) {
  const auth = buildAuth({ db, secret: 'test-secret', expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/portal/admin',
    buildAdminUsersRouter({
      db,
      authenticate: auth.authenticate,
      requireSuperAdmin,
      bcryptRounds: 4,
    })
  );
  return { app, signPortalToken: auth.signPortalToken };
}

function tokenFor(db, signPortalToken, username) {
  const u = userService.findByUsername(db, username);
  return signPortalToken(userService.rowToUser(u));
}

describe('admin/users', () => {
  let db, app, signPortalToken;
  beforeEach(() => {
    db = createTestDb();
    userService.createUser(db, { username: 'admin', password: 'a12345', role: 'super_admin' }, 4);
    userService.createUser(db, { username: 'alice', password: 'a12345', role: 'user' }, 4);
    ({ app, signPortalToken } = makeApp(db));
  });

  it('非超管 403', async () => {
    const t = tokenFor(db, signPortalToken, 'alice');
    const res = await request(app).get('/api/portal/admin/users').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
  });

  it('超管列出用户', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const res = await request(app).get('/api/portal/admin/users').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  it('创建用户成功', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const res = await request(app).post('/api/portal/admin/users')
      .set('Authorization', `Bearer ${t}`)
      .send({ username: 'bob', password: 'b12345', display_name: 'Bob', role: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('bob');
  });

  it('用户名重复 409', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const res = await request(app).post('/api/portal/admin/users')
      .set('Authorization', `Bearer ${t}`)
      .send({ username: 'alice', password: 'x', role: 'user' });
    expect(res.status).toBe(409);
  });

  it('不能改自己的 role', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const adminId = userService.findByUsername(db, 'admin').id;
    const res = await request(app).patch(`/api/portal/admin/users/${adminId}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ role: 'user' });
    expect(res.status).toBe(400);
  });

  it('禁用其他用户成功', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const aliceId = userService.findByUsername(db, 'alice').id;
    const res = await request(app).patch(`/api/portal/admin/users/${aliceId}`)
      .set('Authorization', `Bearer ${t}`)
      .send({ status: 'disabled' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('disabled');
  });

  it('重置密码成功', async () => {
    const t = tokenFor(db, signPortalToken, 'admin');
    const aliceId = userService.findByUsername(db, 'alice').id;
    const res = await request(app).post(`/api/portal/admin/users/${aliceId}/reset-password`)
      .set('Authorization', `Bearer ${t}`)
      .send({ new_password: 'newpass' });
    expect(res.status).toBe(200);
    const ok = userService.authenticate(db, 'alice', 'newpass');
    expect(ok).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/admin.users.test.js`
Expected: 7 passed.

- [ ] **Step 4: Commit**

```bash
git add portal-backend/src/routes/admin/users.js portal-backend/tests/admin.users.test.js
git commit -m "feat(portal): 超管用户管理路由（list/create/update/resetPassword）"
```

---

## Task 12: 超管路由（模块 CRUD + 用户授权）

**Files:**
- Create: `portal-backend/src/routes/admin/modules.js`
- Create: `portal-backend/src/routes/admin/userModules.js`
- Test: `portal-backend/tests/admin.modules.test.js`
- Test: `portal-backend/tests/admin.userModules.test.js`

- [ ] **Step 1: 创建 routes/admin/modules.js**

写入 `portal-backend/src/routes/admin/modules.js`：

```js
const express = require('express');
const moduleService = require('../../services/moduleService');

function buildAdminModulesRouter({ db, authenticate, requireSuperAdmin }) {
  const router = express.Router();
  router.use(authenticate, requireSuperAdmin);

  router.get('/modules', (req, res) => {
    res.json({ success: true, data: moduleService.listAll(db, { onlyEnabled: false }) });
  });

  router.post('/modules', (req, res) => {
    try {
      const m = moduleService.createModule(db, req.body || {});
      res.json({ success: true, data: m });
    } catch (e) {
      if (e.code === 'CODE_TAKEN') return res.status(409).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  router.patch('/modules/:code', (req, res) => {
    try {
      const m = moduleService.updateModule(db, req.params.code, req.body || {});
      res.json({ success: true, data: m });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  router.delete('/modules/:code', (req, res) => {
    try {
      moduleService.deleteModule(db, req.params.code);
      res.json({ success: true });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { buildAdminModulesRouter };
```

- [ ] **Step 2: 创建 routes/admin/userModules.js**

写入 `portal-backend/src/routes/admin/userModules.js`：

```js
const express = require('express');
const userModuleService = require('../../services/userModuleService');

function buildAdminUserModulesRouter({ db, authenticate, requireSuperAdmin }) {
  const router = express.Router();
  router.use(authenticate, requireSuperAdmin);

  router.get('/users/:id/modules', (req, res) => {
    const codes = userModuleService.listCodesForUser(db, parseInt(req.params.id, 10));
    res.json({ success: true, data: codes });
  });

  router.put('/users/:id/modules', (req, res) => {
    const codes = (req.body && Array.isArray(req.body.module_codes)) ? req.body.module_codes : [];
    try {
      const out = userModuleService.setUserModules(db, parseInt(req.params.id, 10), codes, req.user.id);
      res.json({ success: true, data: out });
    } catch (e) {
      if (e.code === 'NOT_FOUND') return res.status(404).json({ success: false, message: e.message });
      if (e.code === 'MODULE_NOT_FOUND') return res.status(400).json({ success: false, message: e.message });
      return res.status(400).json({ success: false, message: e.message });
    }
  });

  return router;
}

module.exports = { buildAdminUserModulesRouter };
```

- [ ] **Step 3: 写 tests/admin.modules.test.js**

写入 `portal-backend/tests/admin.modules.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const express = require('express');
const request = require('supertest');
const { createTestDb } = require('./_helpers');
const userService = require('../src/services/userService');
const { buildAuth } = require('../src/middleware/auth');
const { requireSuperAdmin } = require('../src/middleware/requireSuperAdmin');
const { buildAdminModulesRouter } = require('../src/routes/admin/modules');

function makeApp(db) {
  const auth = buildAuth({ db, secret: 'test-secret', expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/portal/admin', buildAdminModulesRouter({
    db, authenticate: auth.authenticate, requireSuperAdmin,
  }));
  return { app, signPortalToken: auth.signPortalToken };
}

describe('admin/modules', () => {
  let db, app, signPortalToken;
  beforeEach(() => {
    db = createTestDb();
    userService.createUser(db, { username: 'admin', password: 'a12345', role: 'super_admin' }, 4);
    ({ app, signPortalToken } = makeApp(db));
  });

  function adminToken() {
    const u = userService.findByUsername(db, 'admin');
    return signPortalToken(userService.rowToUser(u));
  }

  it('列出所有模块（含 seed 两条）', async () => {
    const res = await request(app).get('/api/portal/admin/modules')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('新建模块', async () => {
    const res = await request(app).post('/api/portal/admin/modules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({
        code: 'drama', name: 'AI 漫剧', target_url: 'https://aimj.aijianshou.com',
        product_tag: 'drama', icon: '🎬', sort_order: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('drama');
  });

  it('code 重复 409', async () => {
    const res = await request(app).post('/api/portal/admin/modules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ code: 'novel-ip', name: 'x', target_url: 'x', product_tag: 'novel' });
    expect(res.status).toBe(409);
  });

  it('编辑模块', async () => {
    const res = await request(app).patch('/api/portal/admin/modules/novel-ip')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'IP改编 v2', enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('IP改编 v2');
    expect(res.body.data.enabled).toBe(false);
  });

  it('删除模块级联清 user_modules', async () => {
    const userModuleService = require('../src/services/userModuleService');
    userService.createUser(db, { username: 'alice', password: 'x', role: 'user' }, 4);
    const aliceId = userService.findByUsername(db, 'alice').id;
    userModuleService.setUserModules(db, aliceId, ['novel-ip'], null);
    const res = await request(app).delete('/api/portal/admin/modules/novel-ip')
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(userModuleService.listCodesForUser(db, aliceId)).toEqual([]);
  });
});
```

- [ ] **Step 4: 写 tests/admin.userModules.test.js**

写入 `portal-backend/tests/admin.userModules.test.js`：

```js
const { describe, it, expect, beforeEach } = require('vitest');
const express = require('express');
const request = require('supertest');
const { createTestDb } = require('./_helpers');
const userService = require('../src/services/userService');
const { buildAuth } = require('../src/middleware/auth');
const { requireSuperAdmin } = require('../src/middleware/requireSuperAdmin');
const { buildAdminUserModulesRouter } = require('../src/routes/admin/userModules');

function makeApp(db) {
  const auth = buildAuth({ db, secret: 'test-secret', expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/portal/admin', buildAdminUserModulesRouter({
    db, authenticate: auth.authenticate, requireSuperAdmin,
  }));
  return { app, signPortalToken: auth.signPortalToken };
}

describe('admin/userModules', () => {
  let db, app, signPortalToken, aliceId;
  beforeEach(() => {
    db = createTestDb();
    userService.createUser(db, { username: 'admin', password: 'a12345', role: 'super_admin' }, 4);
    userService.createUser(db, { username: 'alice', password: 'a12345', role: 'user' }, 4);
    aliceId = userService.findByUsername(db, 'alice').id;
    ({ app, signPortalToken } = makeApp(db));
  });

  function adminToken() {
    const u = userService.findByUsername(db, 'admin');
    return signPortalToken(userService.rowToUser(u));
  }

  it('GET 空数组（未授权过）', async () => {
    const res = await request(app).get(`/api/portal/admin/users/${aliceId}/modules`)
      .set('Authorization', `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('PUT 全量替换', async () => {
    const res = await request(app).put(`/api/portal/admin/users/${aliceId}/modules`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ module_codes: ['novel-ip', 'novel-rewrite'] });
    expect(res.status).toBe(200);
    expect(res.body.data.sort()).toEqual(['novel-ip', 'novel-rewrite']);

    const res2 = await request(app).put(`/api/portal/admin/users/${aliceId}/modules`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ module_codes: ['novel-ip'] });
    expect(res2.body.data).toEqual(['novel-ip']);
  });

  it('PUT 不存在的 module → 400', async () => {
    const res = await request(app).put(`/api/portal/admin/users/${aliceId}/modules`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ module_codes: ['nope'] });
    expect(res.status).toBe(400);
  });

  it('PUT 不存在的 user → 404', async () => {
    const res = await request(app).put(`/api/portal/admin/users/9999/modules`)
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ module_codes: ['novel-ip'] });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd portal-backend && npx vitest run tests/admin.modules.test.js tests/admin.userModules.test.js`
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add portal-backend/src/routes/admin/modules.js portal-backend/src/routes/admin/userModules.js portal-backend/tests/admin.modules.test.js portal-backend/tests/admin.userModules.test.js
git commit -m "feat(portal): 超管模块 CRUD + 用户授权路由"
```

---

## Task 13: 路由聚合 + app + server

**Files:**
- Create: `portal-backend/src/routes/index.js`
- Create: `portal-backend/src/app.js`
- Create: `portal-backend/src/server.js`

- [ ] **Step 1: 创建 src/routes/index.js**

写入 `portal-backend/src/routes/index.js`：

```js
const express = require('express');
const { buildAuthRouter } = require('./auth');
const { buildPubkeyRouter } = require('./pubkey');
const { buildSsoRouter } = require('./sso');
const { buildModulesRouter } = require('./modules');
const { buildAdminUsersRouter } = require('./admin/users');
const { buildAdminModulesRouter } = require('./admin/modules');
const { buildAdminUserModulesRouter } = require('./admin/userModules');

function buildPortalRouter(deps) {
  const router = express.Router();
  router.use(buildPubkeyRouter({ publicKeyPem: deps.publicKeyPem }));
  router.use('/auth', buildAuthRouter({
    db: deps.db,
    signPortalToken: deps.signPortalToken,
    authenticate: deps.authenticate,
    loginRateLimit: deps.loginRateLimit,
  }));
  router.use('/', buildSsoRouter({
    db: deps.db, authenticate: deps.authenticate, signer: deps.ssoSigner,
  }));
  router.use('/', buildModulesRouter({
    db: deps.db, authenticate: deps.authenticate,
  }));
  router.use('/admin', buildAdminUsersRouter({
    db: deps.db,
    authenticate: deps.authenticate,
    requireSuperAdmin: deps.requireSuperAdmin,
    bcryptRounds: deps.bcryptRounds,
  }));
  router.use('/admin', buildAdminModulesRouter({
    db: deps.db, authenticate: deps.authenticate, requireSuperAdmin: deps.requireSuperAdmin,
  }));
  router.use('/admin', buildAdminUserModulesRouter({
    db: deps.db, authenticate: deps.authenticate, requireSuperAdmin: deps.requireSuperAdmin,
  }));
  return router;
}

module.exports = { buildPortalRouter };
```

- [ ] **Step 2: 创建 src/app.js**

写入 `portal-backend/src/app.js`：

```js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const { runMigrations } = require('./db/migrate');
const { createSigner } = require('./services/jwtSigner');
const userService = require('./services/userService');
const { buildAuth } = require('./middleware/auth');
const { requireSuperAdmin } = require('./middleware/requireSuperAdmin');
const { buildIpRateLimit } = require('./middleware/rateLimit');
const { buildPortalRouter } = require('./routes');

function loadKey(p, root) {
  const full = path.isAbsolute(p) ? p : path.join(root, p);
  if (!fs.existsSync(full)) {
    throw new Error(`密钥文件不存在: ${full}。请先运行 npm run gen-keypair`);
  }
  return fs.readFileSync(full, 'utf8');
}

function createApp() {
  const config = loadConfig();
  const root = path.join(__dirname, '..');
  const db = getDb(config.database);
  runMigrations(db, logger);

  // 确保初始超管存在（开发环境用，生产部署时由迁移脚本创建）
  const initSuperUsername = process.env.PORTAL_INIT_ADMIN_USERNAME || 'admin';
  const initSuperPassword = process.env.PORTAL_INIT_ADMIN_PASSWORD || 'admin123';
  userService.ensureSuperAdmin(db,
    { username: initSuperUsername, password: initSuperPassword, display_name: '超级管理员' },
    config.auth.bcrypt_rounds, logger);

  const privateKey = loadKey(config.auth.rsa_private_key_path, root);
  const publicKeyPem = loadKey(config.auth.rsa_public_key_path, root);
  const ssoSigner = createSigner({
    privateKey, ttlSeconds: config.auth.sso_token_ttl_seconds,
  });

  const { signPortalToken, authenticate } = buildAuth({
    db,
    secret: config.auth.portal_token_secret,
    expiresIn: config.auth.portal_token_ttl,
  });
  const loginRateLimit = buildIpRateLimit({ windowMs: 60000, max: 5 });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cors({
    origin: config.server.cors_origins && config.server.cors_origins.length
      ? config.server.cors_origins : '*',
    credentials: true,
  }));
  app.use((req, res, next) => { logger.info(req.method, req.path); next(); });

  app.get('/health', (req, res) => res.json({ status: 'ok', app: config.app.name }));

  app.use('/api/portal', buildPortalRouter({
    db, signPortalToken, authenticate, requireSuperAdmin,
    loginRateLimit, ssoSigner, publicKeyPem,
    bcryptRounds: config.auth.bcrypt_rounds,
  }));

  // 前端 dist 自动 serve（与 miniDrama 同套路）
  const webDist = process.env.PORTAL_WEB_DIST || path.join(root, '..', 'portal-frontweb', 'dist');
  if (fs.existsSync(webDist)) {
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    app.use(express.static(webDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(webDist, 'index.html');
      if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml);
      next();
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ success: false, message: 'API endpoint not found' });
    }
    res.status(404).send('Not Found');
  });

  app.use((err, req, res, next) => {
    logger.errorw('Unhandled error', { error: err.message, path: req.path });
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message || '服务器错误' });
    }
  });

  return { app, config, db };
}

module.exports = { createApp };
```

- [ ] **Step 3: 创建 src/server.js**

写入 `portal-backend/src/server.js`：

```js
const { createApp } = require('./app');

const { app, config } = createApp();
const port = config.server.port;
const host = config.server.host;
app.listen(port, host, () => {
  console.log(`[portal-backend] listening on http://${host}:${port}`);
});
```

- [ ] **Step 4: 启动验证**

Run: `cd portal-backend && node src/server.js`
Expected: 输出 `[portal-backend] listening on http://127.0.0.1:3012`，不报错。

另开终端：
```bash
curl http://127.0.0.1:3012/health
```
Expected: `{"status":"ok","app":"jz Portal Backend"}`

```bash
curl -X POST http://127.0.0.1:3012/api/portal/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
```
Expected: `{"success":true,"data":{"token":"<jwt>","user":{...}}}`

Ctrl+C 停止。

- [ ] **Step 5: Commit**

```bash
git add portal-backend/src/routes/index.js portal-backend/src/app.js portal-backend/src/server.js
git commit -m "feat(portal): 路由聚合 + app 装配 + server 启动入口"
```

---

## Task 14: 全测试套件验证

- [ ] **Step 1: 跑所有 portal-backend 单测**

Run: `cd portal-backend && npm test`
Expected: 全部通过（migrate 3 + pwd 3 + jwtSigner 4 + auth 6 + sso 5 + admin.users 7 + admin.modules 5 + admin.userModules 4 = 37 个）

- [ ] **Step 2: 总览本里程碑后端进度**

Run: `cd portal-backend && find src tests -name '*.js' | wc -l`
Expected: 至少 25 个 js 文件

无新提交，仅作里程碑确认。

---

## Task 15: portal-frontweb 项目骨架

**Files:**
- Create: `portal-frontweb/package.json`
- Create: `portal-frontweb/.gitignore`
- Create: `portal-frontweb/index.html`
- Create: `portal-frontweb/vite.config.js`

- [ ] **Step 1: 创建 package.json**

写入 `portal-frontweb/package.json`：

```json
{
  "name": "portal-frontweb",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "element-plus": "^2.5.0",
    "@element-plus/icons-vue": "^2.3.0",
    "pinia": "^2.1.0",
    "vue": "^3.4.0",
    "vue-router": "^4.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

写入 `portal-frontweb/.gitignore`：

```
node_modules/
dist/
*.log
.env.local
```

- [ ] **Step 3: 创建 index.html**

写入 `portal-frontweb/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI 工作台 - jz</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: 创建 vite.config.js**

写入 `portal-frontweb/vite.config.js`：

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api/portal': {
        target: 'http://localhost:3012',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: 安装依赖**

Run: `cd portal-frontweb && npm install`
Expected: node_modules/ 出现，无报错。

- [ ] **Step 6: Commit**

```bash
git add portal-frontweb/package.json portal-frontweb/.gitignore portal-frontweb/index.html portal-frontweb/vite.config.js
git commit -m "feat(portal-frontweb): 项目骨架（package+vite+html）"
```

---

## Task 16: portal-frontweb 主入口 + Pinia + Element Plus

**Files:**
- Create: `portal-frontweb/src/main.js`
- Create: `portal-frontweb/src/App.vue`

- [ ] **Step 1: 创建 src/main.js**

写入 `portal-frontweb/src/main.js`：

```js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus);
app.mount('#app');
```

- [ ] **Step 2: 创建 src/App.vue**

写入 `portal-frontweb/src/App.vue`：

```vue
<template>
  <router-view />
</template>

<script setup>
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add portal-frontweb/src/main.js portal-frontweb/src/App.vue
git commit -m "feat(portal-frontweb): main + App 根组件"
```

---

## Task 17: portal-frontweb HTTP 客户端 + 用户 store + 路由守卫

**Files:**
- Create: `portal-frontweb/src/api/request.js`
- Create: `portal-frontweb/src/api/auth.js`
- Create: `portal-frontweb/src/api/modules.js`
- Create: `portal-frontweb/src/api/admin.js`
- Create: `portal-frontweb/src/stores/user.js`
- Create: `portal-frontweb/src/router/index.js`

- [ ] **Step 1: 创建 src/api/request.js**

写入 `portal-frontweb/src/api/request.js`：

```js
import axios from 'axios';

const TOKEN_KEY = 'portal_token';
const USER_KEY = 'portal_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
export function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

const request = axios.create({ baseURL: '/api/portal', timeout: 30000 });

request.interceptors.request.use(cfg => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

request.interceptors.response.use(
  res => res.data,
  err => {
    if (err.response && err.response.status === 401) {
      clearToken();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?from=' + encodeURIComponent(window.location.pathname);
      }
    }
    return Promise.reject(err);
  }
);

export default request;
```

- [ ] **Step 2: 创建 src/api/auth.js**

写入 `portal-frontweb/src/api/auth.js`：

```js
import request from './request';
export const login = (username, password) => request.post('/auth/login', { username, password });
export const me = () => request.get('/auth/me');
export const logout = () => request.post('/auth/logout');
```

- [ ] **Step 3: 创建 src/api/modules.js**

写入 `portal-frontweb/src/api/modules.js`：

```js
import request from './request';
export const listMyModules = () => request.get('/modules');
export const issueSso = (module_code) => request.post('/sso/issue', { module_code });
```

- [ ] **Step 4: 创建 src/api/admin.js**

写入 `portal-frontweb/src/api/admin.js`：

```js
import request from './request';

export const listUsers = (params) => request.get('/admin/users', { params });
export const createUser = (body) => request.post('/admin/users', body);
export const updateUser = (id, body) => request.patch(`/admin/users/${id}`, body);
export const resetPassword = (id, new_password) => request.post(`/admin/users/${id}/reset-password`, { new_password });

export const getUserModules = (id) => request.get(`/admin/users/${id}/modules`);
export const setUserModules = (id, module_codes) => request.put(`/admin/users/${id}/modules`, { module_codes });

export const listModules = () => request.get('/admin/modules');
export const createModule = (body) => request.post('/admin/modules', body);
export const updateModule = (code, body) => request.patch(`/admin/modules/${code}`, body);
export const deleteModule = (code) => request.delete(`/admin/modules/${code}`);
```

- [ ] **Step 5: 创建 src/stores/user.js**

写入 `portal-frontweb/src/stores/user.js`：

```js
import { defineStore } from 'pinia';
import { getUser, setUser, clearToken, setToken } from '@/api/request';
import { login as apiLogin, me as apiMe } from '@/api/auth';

export const useUserStore = defineStore('user', {
  state: () => ({ user: getUser() }),
  getters: {
    isLoggedIn: (s) => !!s.user,
    isSuperAdmin: (s) => s.user && s.user.role === 'super_admin',
  },
  actions: {
    async login(username, password) {
      const res = await apiLogin(username, password);
      setToken(res.data.token);
      setUser(res.data.user);
      this.user = res.data.user;
    },
    async refresh() {
      const res = await apiMe();
      setUser(res.data);
      this.user = res.data;
    },
    logout() {
      clearToken();
      this.user = null;
    },
  },
});
```

- [ ] **Step 6: 创建 src/router/index.js**

写入 `portal-frontweb/src/router/index.js`：

```js
import { createRouter, createWebHistory } from 'vue-router';
import { getToken, getUser } from '@/api/request';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/Login.vue'), meta: { public: true, title: '登录' } },
    { path: '/', component: () => import('@/views/Workspace.vue'), meta: { title: '工作台' } },
    { path: '/admin/users', component: () => import('@/views/admin/UserList.vue'), meta: { requireSuperAdmin: true, title: '用户管理' } },
    { path: '/admin/users/:id/modules', component: () => import('@/views/admin/UserModules.vue'), meta: { requireSuperAdmin: true, title: '配置模块' } },
    { path: '/admin/modules', component: () => import('@/views/admin/ModuleList.vue'), meta: { requireSuperAdmin: true, title: '模块管理' } },
  ],
});

router.beforeEach((to) => {
  if (to.meta.title) document.title = `${to.meta.title} - AI 工作台`;
  if (to.meta.public) return true;
  if (!getToken()) return { path: '/login', query: { from: to.fullPath } };
  if (to.meta.requireSuperAdmin) {
    const u = getUser();
    if (!u || u.role !== 'super_admin') return { path: '/' };
  }
  return true;
});

export default router;
```

- [ ] **Step 7: Commit**

```bash
git add portal-frontweb/src/api portal-frontweb/src/stores portal-frontweb/src/router
git commit -m "feat(portal-frontweb): axios+token+pinia store+路由守卫"
```

---

## Task 18: portal-frontweb 登录页 + 工作台

**Files:**
- Create: `portal-frontweb/src/views/Login.vue`
- Create: `portal-frontweb/src/views/Workspace.vue`
- Create: `portal-frontweb/src/components/ModuleCard.vue`

- [ ] **Step 1: 创建 src/views/Login.vue**

写入 `portal-frontweb/src/views/Login.vue`：

```vue
<template>
  <div class="login-wrap">
    <div class="login-card">
      <h2>AI 工作台</h2>
      <el-form :model="form" @submit.prevent="onSubmit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" autofocus />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" style="width:100%">登录</el-button>
        </el-form-item>
      </el-form>
      <div v-if="ssoError" class="sso-error">{{ ssoErrorMsg }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const form = ref({ username: '', password: '' });
const loading = ref(false);

const ssoError = computed(() => route.query.sso_error);
const ssoErrorMsg = computed(() => {
  const map = { invalid: 'SSO 链接无效或已被篡改', expired: 'SSO 链接已过期，请重新点击模块', replay: 'SSO 链接已被使用过', disabled: '账号已禁用' };
  return map[route.query.sso_error] || '';
});

async function onSubmit() {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await userStore.login(form.value.username, form.value.password);
    const from = route.query.from || '/';
    router.replace(from);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login-card {
  width: 360px;
  padding: 32px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
.login-card h2 { margin-top: 0; text-align: center; }
.sso-error { margin-top: 12px; color: #f56c6c; text-align: center; }
</style>
```

- [ ] **Step 2: 创建 src/components/ModuleCard.vue**

写入 `portal-frontweb/src/components/ModuleCard.vue`：

```vue
<template>
  <div class="module-card" :class="{ disabled: !authorized }" @click="onClick">
    <div class="icon">{{ module.icon || '📦' }}</div>
    <div class="name">{{ module.name }}</div>
    <div class="desc">{{ module.description || '' }}</div>
    <div v-if="!authorized" class="badge">未开通</div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { issueSso } from '@/api/modules';

const props = defineProps({
  module: { type: Object, required: true },
  authorized: { type: Boolean, default: true },
});

async function onClick() {
  if (!props.authorized) {
    ElMessage.info('该模块未开通，请联系管理员');
    return;
  }
  try {
    const res = await issueSso(props.module.code);
    window.location.href = res.data.jump_url;
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '跳转失败');
  }
}
</script>

<style scoped>
.module-card {
  width: 220px;
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  position: relative;
}
.module-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
.module-card.disabled { opacity: 0.6; cursor: not-allowed; }
.icon { font-size: 48px; }
.name { font-size: 18px; font-weight: 600; margin-top: 12px; }
.desc { font-size: 12px; color: #909399; margin-top: 6px; min-height: 32px; }
.badge { position: absolute; top: 12px; right: 12px; background: #f0f0f0; color: #909399; font-size: 12px; padding: 2px 8px; border-radius: 4px; }
</style>
```

- [ ] **Step 3: 创建 src/views/Workspace.vue**

写入 `portal-frontweb/src/views/Workspace.vue`：

```vue
<template>
  <div class="workspace">
    <header class="topbar">
      <div class="brand">AI 工作台</div>
      <div class="user-area">
        <span>{{ userStore.user?.display_name || userStore.user?.username }}</span>
        <el-button text @click="onLogout">退出</el-button>
      </div>
    </header>

    <main class="main">
      <h3>可用模块</h3>
      <div class="grid">
        <ModuleCard v-for="m in myModules" :key="m.code" :module="m" :authorized="true" />
      </div>

      <template v-if="userStore.isSuperAdmin">
        <h3 style="margin-top:32px">超管入口</h3>
        <div class="grid">
          <div class="module-card admin" @click="$router.push('/admin/users')">
            <div class="icon">👥</div>
            <div class="name">用户管理</div>
          </div>
          <div class="module-card admin" @click="$router.push('/admin/modules')">
            <div class="icon">⚙️</div>
            <div class="name">模块管理</div>
          </div>
        </div>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { listMyModules } from '@/api/modules';
import ModuleCard from '@/components/ModuleCard.vue';

const userStore = useUserStore();
const router = useRouter();
const myModules = ref([]);

async function load() {
  try {
    const res = await listMyModules();
    myModules.value = res.data;
  } catch (e) {
    ElMessage.error('加载模块失败');
  }
}

async function onLogout() {
  userStore.logout();
  router.replace('/login');
}

onMounted(load);
</script>

<style scoped>
.workspace { min-height: 100vh; background: #f5f7fa; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; background: #fff; border-bottom: 1px solid #ebeef5; }
.brand { font-size: 20px; font-weight: 600; }
.user-area { display: flex; align-items: center; gap: 12px; }
.main { padding: 32px; }
.main h3 { margin: 0 0 16px; color: #303133; }
.grid { display: flex; flex-wrap: wrap; gap: 16px; }
.module-card.admin { width: 220px; padding: 24px; background: #fff; border-radius: 8px; border: 1px solid #ebeef5; cursor: pointer; }
.module-card.admin:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.1); }
.module-card.admin .icon { font-size: 48px; }
.module-card.admin .name { font-size: 18px; font-weight: 600; margin-top: 12px; }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add portal-frontweb/src/views/Login.vue portal-frontweb/src/views/Workspace.vue portal-frontweb/src/components/ModuleCard.vue
git commit -m "feat(portal-frontweb): 登录页 + 工作台 + ModuleCard 组件"
```

---

## Task 19: portal-frontweb 超管页 - 用户列表

**Files:**
- Create: `portal-frontweb/src/views/admin/UserList.vue`

- [ ] **Step 1: 创建 src/views/admin/UserList.vue**

写入 `portal-frontweb/src/views/admin/UserList.vue`：

```vue
<template>
  <div class="page">
    <header class="topbar">
      <el-button @click="$router.push('/')">← 返回</el-button>
      <h2>用户管理</h2>
      <el-button type="primary" @click="onCreate">+ 创建用户</el-button>
    </header>

    <el-table :data="rows" border style="margin-top:16px">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="用户名" />
      <el-table-column prop="display_name" label="显示名" />
      <el-table-column prop="role" label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="row.role==='super_admin' ? 'danger' : 'info'">{{ row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status==='active' ? 'success' : 'warning'">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="320">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push(`/admin/users/${row.id}/modules`)">配模块</el-button>
          <el-button size="small" @click="onResetPassword(row)">重置密码</el-button>
          <el-button size="small" :type="row.status==='active' ? 'warning' : 'success'" @click="onToggleStatus(row)">
            {{ row.status === 'active' ? '禁用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="createDialog" title="创建用户" width="400px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="用户名"><el-input v-model="createForm.username" /></el-form-item>
        <el-form-item label="显示名"><el-input v-model="createForm.display_name" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="createForm.password" type="password" show-password /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role">
            <el-option label="普通用户" value="user" />
            <el-option label="超级管理员" value="super_admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog=false">取消</el-button>
        <el-button type="primary" @click="onSubmitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listUsers, createUser, updateUser, resetPassword } from '@/api/admin';

const rows = ref([]);
const createDialog = ref(false);
const createForm = ref({ username: '', password: '', display_name: '', role: 'user' });

async function load() {
  const res = await listUsers({ limit: 100 });
  rows.value = res.data.items;
}

function onCreate() {
  createForm.value = { username: '', password: '', display_name: '', role: 'user' };
  createDialog.value = true;
}

async function onSubmitCreate() {
  try {
    await createUser(createForm.value);
    ElMessage.success('创建成功');
    createDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '创建失败');
  }
}

async function onResetPassword(row) {
  try {
    const { value } = await ElMessageBox.prompt(`重置 ${row.username} 的密码`, '重置密码', {
      inputType: 'password', inputValidator: v => !!v || '请输入新密码',
    });
    await resetPassword(row.id, value);
    ElMessage.success('密码已重置');
  } catch (_) {}
}

async function onToggleStatus(row) {
  try {
    const next = row.status === 'active' ? 'disabled' : 'active';
    await updateUser(row.id, { status: next });
    ElMessage.success('已更新');
    await load();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '操作失败');
  }
}

onMounted(load);
</script>

<style scoped>
.page { padding: 24px; min-height: 100vh; background: #f5f7fa; }
.topbar { display: flex; align-items: center; gap: 16px; }
.topbar h2 { margin: 0; flex: 1; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add portal-frontweb/src/views/admin/UserList.vue
git commit -m "feat(portal-frontweb): 用户管理页（列表+创建+重置密码+启停）"
```

---

## Task 20: portal-frontweb 超管页 - 用户授权 + 模块管理

**Files:**
- Create: `portal-frontweb/src/views/admin/UserModules.vue`
- Create: `portal-frontweb/src/views/admin/ModuleList.vue`
- Create: `portal-frontweb/src/components/ModuleFormDialog.vue`

- [ ] **Step 1: 创建 src/views/admin/UserModules.vue**

写入 `portal-frontweb/src/views/admin/UserModules.vue`：

```vue
<template>
  <div class="page">
    <el-button @click="$router.back()">← 返回</el-button>
    <h2>为用户 #{{ userId }} 配置模块</h2>

    <div v-for="(group, tag) in grouped" :key="tag" class="group">
      <h3>{{ tag }}</h3>
      <el-checkbox-group v-model="selected">
        <el-checkbox v-for="m in group" :key="m.code" :label="m.code">
          {{ m.icon }} {{ m.name }} <span class="desc">— {{ m.description }}</span>
        </el-checkbox>
      </el-checkbox-group>
    </div>

    <div class="actions">
      <el-button @click="$router.back()">取消</el-button>
      <el-button type="primary" @click="onSave">保存</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { listModules, getUserModules, setUserModules } from '@/api/admin';

const route = useRoute();
const router = useRouter();
const userId = route.params.id;
const allModules = ref([]);
const selected = ref([]);

const grouped = computed(() => {
  const map = {};
  for (const m of allModules.value) {
    if (!m.enabled) continue;
    const tag = m.product_tag || 'default';
    if (!map[tag]) map[tag] = [];
    map[tag].push(m);
  }
  return map;
});

async function load() {
  const [mods, mine] = await Promise.all([listModules(), getUserModules(userId)]);
  allModules.value = mods.data;
  selected.value = mine.data;
}

async function onSave() {
  try {
    await setUserModules(userId, selected.value);
    ElMessage.success('已保存');
    router.back();
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '保存失败');
  }
}

onMounted(load);
</script>

<style scoped>
.page { padding: 24px; min-height: 100vh; background: #f5f7fa; }
h2 { margin-top: 8px; }
.group { background: #fff; padding: 16px; margin-top: 16px; border-radius: 6px; }
.group h3 { margin: 0 0 12px; color: #606266; font-size: 14px; }
.desc { color: #909399; font-size: 12px; }
.actions { margin-top: 24px; text-align: right; }
</style>
```

- [ ] **Step 2: 创建 src/components/ModuleFormDialog.vue**

写入 `portal-frontweb/src/components/ModuleFormDialog.vue`：

```vue
<template>
  <el-dialog :model-value="visible" :title="isEdit ? '编辑模块' : '新建模块'" width="500px"
    @update:model-value="$emit('update:visible', $event)">
    <el-form :model="form" label-width="100px">
      <el-form-item label="code"><el-input v-model="form.code" :disabled="isEdit" /></el-form-item>
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="form.description" /></el-form-item>
      <el-form-item label="图标"><el-input v-model="form.icon" placeholder="emoji 或图片 URL" /></el-form-item>
      <el-form-item label="目标 URL"><el-input v-model="form.target_url" placeholder="https://..." /></el-form-item>
      <el-form-item label="SSO 路径"><el-input v-model="form.sso_path" placeholder="/api/auth/sso" /></el-form-item>
      <el-form-item label="落地路径"><el-input v-model="form.redirect_path" placeholder="/" /></el-form-item>
      <el-form-item label="产品标签"><el-input v-model="form.product_tag" placeholder="novel / drama" /></el-form-item>
      <el-form-item label="排序"><el-input-number v-model="form.sort_order" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="onSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { createModule, updateModule } from '@/api/admin';

const props = defineProps({
  visible: Boolean,
  initial: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);
const isEdit = ref(false);
const form = ref({
  code: '', name: '', description: '', icon: '', target_url: '',
  sso_path: '/api/auth/sso', redirect_path: '/', product_tag: '',
  sort_order: 0, enabled: true,
});

watch(() => props.initial, (val) => {
  if (val) {
    isEdit.value = true;
    form.value = { ...val };
  } else {
    isEdit.value = false;
    form.value = {
      code: '', name: '', description: '', icon: '', target_url: '',
      sso_path: '/api/auth/sso', redirect_path: '/', product_tag: '',
      sort_order: 0, enabled: true,
    };
  }
});

async function onSubmit() {
  try {
    if (isEdit.value) await updateModule(form.value.code, form.value);
    else await createModule(form.value);
    ElMessage.success('已保存');
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '保存失败');
  }
}
</script>
```

- [ ] **Step 3: 创建 src/views/admin/ModuleList.vue**

写入 `portal-frontweb/src/views/admin/ModuleList.vue`：

```vue
<template>
  <div class="page">
    <header class="topbar">
      <el-button @click="$router.push('/')">← 返回</el-button>
      <h2>模块管理</h2>
      <el-button type="primary" @click="onCreate">+ 新建模块</el-button>
    </header>

    <el-table :data="rows" border style="margin-top:16px">
      <el-table-column prop="code" label="code" width="160" />
      <el-table-column prop="name" label="名称" width="160" />
      <el-table-column prop="product_tag" label="产品" width="120" />
      <el-table-column prop="target_url" label="目标 URL" />
      <el-table-column prop="redirect_path" label="落地" width="160" />
      <el-table-column prop="sort_order" label="排序" width="80" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="onEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ModuleFormDialog v-model:visible="dialog" :initial="editing" @saved="load" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listModules, deleteModule } from '@/api/admin';
import ModuleFormDialog from '@/components/ModuleFormDialog.vue';

const rows = ref([]);
const dialog = ref(false);
const editing = ref(null);

async function load() {
  const res = await listModules();
  rows.value = res.data;
}

function onCreate() { editing.value = null; dialog.value = true; }
function onEdit(row) { editing.value = { ...row }; dialog.value = true; }

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除模块 ${row.code}？该模块的所有用户授权也会被删除。`, '确认', { type: 'warning' });
    await deleteModule(row.code);
    ElMessage.success('已删除');
    await load();
  } catch (_) {}
}

onMounted(load);
</script>

<style scoped>
.page { padding: 24px; min-height: 100vh; background: #f5f7fa; }
.topbar { display: flex; align-items: center; gap: 16px; }
.topbar h2 { margin: 0; flex: 1; }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add portal-frontweb/src/views/admin/UserModules.vue portal-frontweb/src/views/admin/ModuleList.vue portal-frontweb/src/components/ModuleFormDialog.vue
git commit -m "feat(portal-frontweb): 用户授权页 + 模块管理 CRUD 页"
```

---

## Task 21: portal-frontweb 构建验证

- [ ] **Step 1: 跑构建**

Run: `cd portal-frontweb && npm run build`
Expected: 输出 `dist/` 目录，无报错（warn 可以接受）。

- [ ] **Step 2: 联调启动验证**

终端 A：`cd portal-backend && node src/server.js`
Expected: 监听 3012。

终端 B：`cd portal-frontweb && npm run dev`
Expected: 监听 5174，proxy /api/portal → 3012。

浏览器访问 `http://localhost:5174/` → 跳到 /login → 用 `admin` / `admin123` 登录 → 进工作台 → 看到两张模块卡片（IP 改编、网文改写）和两个超管入口。

进入 `/admin/users` 创建一个普通用户 → `/admin/users/<id>/modules` 勾选 IP 改编 保存 → 退出 → 用普通用户登录 → 工作台只看到 IP 改编一张卡片。

- [ ] **Step 3: 无新提交（仅验证）**

如果上一步全部通过，进入 Task 22。

---

## Task 22: miniDrama users 表加 portal_user_id

**Files:**
- Create: `backend-node/migrations/24_users_portal_user_id.sql`

- [ ] **Step 1: 检查现有 migration 编号**

Run: `ls backend-node/migrations/ | tail -3`
Expected: 看到 `23_user_credits.sql` 是最后一条。

- [ ] **Step 2: 创建 24_users_portal_user_id.sql**

写入 `backend-node/migrations/24_users_portal_user_id.sql`：

```sql
ALTER TABLE users ADD COLUMN portal_user_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_portal_user_id ON users(portal_user_id) WHERE portal_user_id IS NOT NULL;
```

> 注：SQLite 的 ALTER TABLE 不支持 ADD COLUMN UNIQUE，所以用 partial unique index 实现"非 NULL 时唯一"，允许多行 NULL。

- [ ] **Step 3: 启动 miniDrama 后端验证 migration 跑过**

Run: `cd backend-node && node src/server.js`
Expected: 输出包含类似 `migration applied: 24_users_portal_user_id.sql`，无 SQL 错误。Ctrl+C。

Run: `node -e "const Database=require('better-sqlite3'); const db=new Database('backend-node/data/drama_generator.db'); console.log(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));"`
Expected: 数组里包含 `portal_user_id`。

- [ ] **Step 4: Commit**

```bash
git add backend-node/migrations/24_users_portal_user_id.sql
git commit -m "feat(minidrama): users 表增加 portal_user_id 列（partial unique index）"
```

---

## Task 23: miniDrama userService 增加 portal 投影方法

**Files:**
- Modify: `backend-node/src/services/userService.js`

- [ ] **Step 1: 看现有 userService 结构**

Run: `grep -n "module.exports" backend-node/src/services/userService.js`
Expected: 找到 module.exports 行号，确认现有导出函数。

Run: `head -30 backend-node/src/services/userService.js`
Expected: 看清现有 user row 转换 + create 套路。

- [ ] **Step 2: 在文件末尾的 module.exports 之前追加两个函数**

打开 `backend-node/src/services/userService.js`，定位到 `module.exports = {` 行，**在其上方**插入：

```js
function findByPortalUserId(db, portalUserId) {
  if (!portalUserId) return null;
  return db.prepare('SELECT * FROM users WHERE portal_user_id = ?').get(portalUserId);
}

function createFromPortal(db, { portalUserId, username, displayName, role }) {
  // 处理 username 撞名：如果本地已有同名 user 但 portal_user_id 是空或不同，加后缀
  const existing = db.prepare('SELECT id, portal_user_id FROM users WHERE username = ?').get(username);
  let finalUsername = username;
  if (existing && existing.portal_user_id !== portalUserId) {
    finalUsername = `${username}_p${portalUserId}`;
  }
  // 用一个不会被使用的占位 hash（用户走 SSO 不能用本地密码登录）
  const placeholderHash = '$2a$10$portalSsoUserNoLocalPasswordPlaceholder.HashXxxxx';
  const info = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, status, portal_user_id)
    VALUES (?, ?, ?, ?, 'active', ?)`).run(
      finalUsername, placeholderHash, displayName || finalUsername,
      role || 'user', portalUserId
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}
```

然后在 `module.exports = { ... }` 里追加两个名字：

```js
module.exports = {
  // ... 现有导出
  findByPortalUserId,
  createFromPortal,
};
```

如果不能确认现有 module.exports 的结构，先 `Read` 整个文件再决定追加方式。

- [ ] **Step 3: Commit**

```bash
git add backend-node/src/services/userService.js
git commit -m "feat(minidrama): userService 增加 portal 投影函数（findByPortalUserId/createFromPortal）"
```

---

## Task 24: miniDrama portalSso 中间件 + 路由挂载

**Files:**
- Create: `backend-node/src/middleware/portalSso.js`
- Modify: `backend-node/src/routes/index.js`
- Create: `backend-node/keys/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: 拷贝公钥**

Run: `mkdir -p backend-node/keys && cp portal-backend/keys/portal-public.pem backend-node/keys/portal-public.pem`

确认: Run: `ls backend-node/keys/`
Expected: `portal-public.pem` 存在。

- [ ] **Step 2: 把 keys/ 加入 .gitignore（仓库根）**

打开仓库根 `.gitignore`，追加（如果还没有）：

```
backend-node/keys/
portal-backend/keys/
portal-backend/data/
portal-backend/tmp/
portal-frontweb/dist/
```

- [ ] **Step 3: 创建 backend-node/src/middleware/portalSso.js**

写入 `backend-node/src/middleware/portalSso.js`：

```js
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { signToken } = require('./auth');
const userService = require('../services/userService');

const PRODUCT_TAG = 'drama';
const PUBKEY_PATH = path.join(__dirname, '..', '..', 'keys', 'portal-public.pem');

let cachedPublicKey = null;
function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  if (!fs.existsSync(PUBKEY_PATH)) {
    throw new Error(`portal-public.pem 不存在: ${PUBKEY_PATH}。请从 portal-backend/keys/ 拷过来。`);
  }
  cachedPublicKey = fs.readFileSync(PUBKEY_PATH, 'utf8');
  return cachedPublicKey;
}

function ensureConsumedTokensTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS consumed_sso_tokens (
    jti TEXT PRIMARY KEY,
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
}

function cleanupConsumedTokens(db) {
  db.prepare("DELETE FROM consumed_sso_tokens WHERE used_at < datetime('now', '-1 hour')").run();
}

function buildSsoHandler(db) {
  ensureConsumedTokensTable(db);
  cleanupConsumedTokens(db);
  setInterval(() => { try { cleanupConsumedTokens(db); } catch (_) {} }, 3600 * 1000).unref();

  return function ssoHandler(req, res) {
    const token = req.query.token;
    const redirect = (req.query.redirect && String(req.query.redirect)) || '/';
    if (!token) return res.redirect('/login?sso_error=invalid');

    let payload;
    try {
      payload = jwt.verify(token, getPublicKey(), {
        algorithms: ['RS256'],
        issuer: 'portal',
        audience: PRODUCT_TAG,
        clockTolerance: 30,
      });
    } catch (e) {
      const code = e.name === 'TokenExpiredError' ? 'expired' : 'invalid';
      return res.redirect(`/login?sso_error=${code}`);
    }

    if (!payload.jti) return res.redirect('/login?sso_error=invalid');
    try {
      db.prepare('INSERT INTO consumed_sso_tokens (jti) VALUES (?)').run(payload.jti);
    } catch (e) {
      return res.redirect('/login?sso_error=replay');
    }

    let userRow = userService.findByPortalUserId(db, payload.sub);
    if (!userRow) {
      userRow = userService.createFromPortal(db, {
        portalUserId: payload.sub,
        username: payload.username,
        displayName: payload.display_name,
        role: 'user',
      });
    }
    if (userRow.status === 'disabled') {
      return res.redirect('/login?sso_error=disabled');
    }

    const localToken = signToken({
      id: userRow.id, username: userRow.username, role: userRow.role,
    });

    // 把 token 注入 URL（前端读 query.token 入 localStorage 后跳走）
    const safeRedirect = redirect.startsWith('/') ? redirect : '/';
    const sep = safeRedirect.includes('?') ? '&' : '?';
    res.redirect(`${safeRedirect}${sep}sso_token=${encodeURIComponent(localToken)}`);
  };
}

module.exports = { buildSsoHandler };
```

> 设计说明：miniDrama 现有前端用 localStorage 存 token，因此 SSO 中间件把 token 通过 URL query 回传，由前端 `App.vue`/路由守卫读到 `?sso_token=xxx` 后写 localStorage 并去掉 query 参数。这一步前端改动在 Task 25。

- [ ] **Step 4: 在 backend-node/src/routes/index.js 挂载路由**

Run: `Read backend-node/src/routes/index.js` 看现有结构。

定位到导出 setupRouter 的位置，找到 auth 路由挂载附近。在 `/api/v1/auth` 路由之外（注意 SSO 不走 /api/v1 前缀，是子产品对外的纯 GET 入口）补一个**顶层路由**。这通过修改 `app.js` 实现更直接 —— 但我们先按"在路由聚合层加"的方式实现：

打开 `backend-node/src/routes/index.js`，在文件顶部加：

```js
const { buildSsoHandler } = require('../middleware/portalSso');
```

在 setupRouter 函数体里 router 创建后、其他 use 之前加一行（路径相对于 `/api/v1`，所以这里挂载到 `/auth/sso`）：

```js
router.get('/auth/sso', buildSsoHandler(db));
```

如果 setupRouter 接收的是 (config, db, log) 三个参数，这里 db 直接可用；如果不是，按实际签名调整。

> 注：路由是 `/api/v1/auth/sso`，与 portal 那边 module 表里的 `sso_path` 必须一致。**回头改 portal seed 的 sso_path 为 `/api/v1/auth/sso`**（如果 miniDrama 的 drama 模块由超管在 UI 上添加，要在 UI 里填这个路径）。

- [ ] **Step 5: 启动验证**

Run: `cd backend-node && node src/server.js`
Expected: 启动无报错，日志有 ssoHandler 初始化。

测试 SSO 端点（用一个明显非法的 token）：
```bash
curl -i "http://localhost:3011/api/v1/auth/sso?token=fake"
```
Expected: HTTP/302，Location 包含 `/login?sso_error=invalid`。

Ctrl+C 关闭。

- [ ] **Step 6: Commit**

```bash
git add backend-node/src/middleware/portalSso.js backend-node/src/routes/index.js .gitignore
git commit -m "feat(minidrama): SSO 中间件 + /api/v1/auth/sso 路由（验签+找/建user+发本地token+302）"
```

---

## Task 25: miniDrama 前端识别 SSO token 并写入 localStorage

**Files:**
- Modify: `frontweb/src/views/Login.vue` 或 `frontweb/src/main.js`（按现有结构选）
- 备选：`frontweb/src/router/index.js`

- [ ] **Step 1: 看现有 main.js 和 router 结构**

Run: `Read frontweb/src/main.js`
Run: `Read frontweb/src/utils/request.js`（找 setToken 函数）

- [ ] **Step 2: 在 router 守卫前置中识别 sso_token query**

打开 `frontweb/src/router/index.js`，在 `router.beforeEach((to) => {` 函数体的最开头，加一段：

```js
// SSO 跳转回来：?sso_token=xxx → 写 localStorage，去掉 query
if (to.query.sso_token) {
  const t = String(to.query.sso_token);
  // 沿用 utils/request 的 setToken（如果导出了），否则直接用 localStorage
  try {
    localStorage.setItem('token', t);
  } catch (_) {}
  const next = Object.assign({}, to.query);
  delete next.sso_token;
  return { path: to.path, query: next, replace: true };
}
```

注意：上面的 `localStorage` key 必须和 `frontweb/src/utils/request.js` 里 getToken 用的 key 一致。先 grep 确认：

Run: `grep -n "localStorage" frontweb/src/utils/request.js`
Expected: 看到具体 key，比如 `'token'`。如果不是 `'token'`，把上面的代码改成实际 key。

- [ ] **Step 3: 启动前后端联调验证**

终端 A：`cd portal-backend && node src/server.js`（3012）
终端 B：`cd backend-node && node src/server.js`（3011）
终端 C：`cd frontweb && npm run dev`（vite 代理 /api/v1 → 3011）

浏览器：
1. 在 portal 端 `http://localhost:5174/admin/modules` 新建一个 drama 模块：code=drama, target_url=`http://localhost:5173`（vite dev 端口），sso_path=`/api/v1/auth/sso`，redirect_path=`/`，product_tag=`drama`
2. portal 端 `/admin/users/<某用户>/modules` 给该用户授权 drama
3. 该用户登录 portal，工作台点 AI 漫剧 卡片 → 跳转到 `http://localhost:5173/?sso_token=xxx` → 路由守卫识别 → 落地漫剧主页且已登录态

> 如果浏览器 URL 跳到了 `localhost:5173`（vite dev）但 vite 不识别 `/api/v1/auth/sso` 这个路径（vite 默认 proxy 在 `/api/v1`），实际跳转流程是：portal 跳到 `localhost:5173/api/v1/auth/sso?token=xxx` → vite proxy 转发到 backend 3011 → backend 302 到 `/?sso_token=yyy` → vite 处理 SPA。这条链路需要 vite proxy 也代理 `/api/v1/auth/sso`，看现有 vite.config.js 确认无误。

Run: `grep -A 5 "proxy" frontweb/vite.config.js`
Expected: `/api/v1` 已被代理到 3011。

- [ ] **Step 4: Commit**

```bash
git add frontweb/src/router/index.js
git commit -m "feat(minidrama-fe): 路由守卫识别 ?sso_token=xxx 并写入 localStorage"
```

---

## Task 26: 端到端集成验证

- [ ] **Step 1: 启动三个服务**

终端 A：`cd portal-backend && node src/server.js`
终端 B：`cd backend-node && node src/server.js`
终端 C：`cd frontweb && npm run dev`
终端 D：`cd portal-frontweb && npm run dev`

- [ ] **Step 2: 完整链路浏览器验证**

1. 打开 `http://localhost:5174/login`
2. 用 admin / admin123 登录
3. 进入 `/admin/users` 创建用户 zhx（普通用户，密码 zhx123）
4. 进入 `/admin/users/<zhx_id>/modules` 勾选「IP 改编」「网文改写」+「AI 漫剧」（如已添加）保存
5. 退出 admin，登录 zhx
6. 工作台看到三张卡片
7. 点「AI 漫剧」 → 浏览器跳到 `http://localhost:5173`，自动登录，看到漫剧主页 ✅
8. 检查 miniDrama 数据库：
   ```bash
   node -e "const Database=require('better-sqlite3'); const db=new Database('backend-node/data/drama_generator.db'); console.log(db.prepare('SELECT id, username, portal_user_id FROM users WHERE portal_user_id IS NOT NULL').all());"
   ```
   Expected: 看到一行 zhx 对应的 portal_user_id

- [ ] **Step 3: 重放测试**

复制 portal 工作台点击卡片时的 jump_url（在 Network 面板看），用 curl 访问两次：
```bash
curl -i "<jump_url>"
curl -i "<jump_url>"
```
Expected: 第一次 302 → /，第二次 302 → /login?sso_error=replay

- [ ] **Step 4: 撤销授权测试**

portal 端把 zhx 的 AI 漫剧授权去掉 → zhx 工作台刷新 → 漫剧卡片消失 → 即使手动调 `/sso/issue {module_code:'drama'}` 应该 403

- [ ] **Step 5: fallback 测试**

关掉 portal-backend → 直接访问 `http://localhost:5173/login` → 用本地账号登录仍可用 ✅

- [ ] **Step 6: 全部测试通过后无新提交**

里程碑 1 完成。

---

## Task 27: 里程碑 1 总结提交

- [ ] **Step 1: git log 查看本里程碑提交**

Run: `git log --oneline | head -30`
Expected: 看到 ~25 条新 commit（task 1-26）

- [ ] **Step 2: 写一份本里程碑的进度记忆**

写入 `C:\Users\sangr12\.claude\projects\D--claude-miniDrama\memory\project_jz_portal_milestone_1.md`：

```markdown
---
name: jz Portal 里程碑 1：portal 闭环 + miniDrama SSO 接入
description: portal-backend/portal-frontweb 已实现登录/工作台/三个超管页/SSO 签发；miniDrama 已接入 SSO 中间件
type: project
---
2026-05-07 完成里程碑 1。

**已交付:**
- portal-backend (port 3012)：portal_users/portal_modules/portal_user_modules 三表 + 登录/me/logout + SSO issue（RSA-256 JWT）+ 用户管理 + 模块 CRUD + 用户授权全链路；37 个单测全过
- portal-frontweb (port 5174)：登录页+工作台+用户管理+用户授权+模块管理；vite proxy /api/portal → 3012
- miniDrama: users 表加 portal_user_id 列；middleware/portalSso.js 验签+找/建user+回写 sso_token；前端路由守卫识别 query

**关键决策痕迹:**
- portal_modules.sso_path 默认值 `/api/auth/sso`，但 miniDrama 实际是 `/api/v1/auth/sso`，超管在 UI 配 drama 模块时要填带 v1 的版本
- SSO token 通过 URL query `?sso_token=` 回传给前端 localStorage，因为漫剧前端没用 cookie 登录态

**未交付（里程碑 2/3）:**
- Novel 仓库改动（独立提交）
- 服务器部署 + DNS + nginx + certbot
- 一次性用户迁移脚本（migrate-existing-users.cjs）
- portal 默认管理员密码 admin/admin123 仅开发用，部署前务必改

**Memory entry to add to MEMORY.md**：
- [jz Portal 里程碑 1](project_jz_portal_milestone_1.md) — 本地三服务联调通过，未上线
```

并在 `MEMORY.md` 加一行：
```
- [jz Portal 里程碑 1](project_jz_portal_milestone_1.md) — 本地三服务联调通过，未上线
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-07-jz-portal-milestone-1.md
git commit -m "docs(plan): jz portal 里程碑 1 实现计划"
```

---

## 里程碑 1 完成标记

完成全部 27 个任务后，本里程碑交付物：

1. **portal-backend**：3012 端口运行，37 单测过
2. **portal-frontweb**：5174 端口运行，登录+工作台+三个超管页可用
3. **miniDrama**：5173/3011 端口运行，能从 portal 单点跳转登录
4. **本地全链路**：portal 登录 → 点漫剧卡片 → 落地 aimj 已登录 ✅

**未交付（后续里程碑 2、3）：**

- 里程碑 2：Novel 仓库改动（SSO 中间件 + Prisma migration），需要在 `D:\claude\Novel` 切目录独立提交
- 里程碑 3：服务器部署（DNS + nginx + certbot + PM2 + 数据迁移脚本）

继续做下一里程碑前必须完成的人工确认：
- [ ] 本地全链路在浏览器实跑通过（zhx 用户从 portal 跳到 aimj）
- [ ] 用户决定 portal 初始 admin 密码（部署前会用到）
