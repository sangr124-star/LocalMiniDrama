# 用户级数据隔离 + 三角色权限体系 设计文档

> 日期：2026-05-04
> 状态：已批准，待实施
> 作者：Claude × sangr12

## 背景

当前系统存在以下问题：

1. **没有数据归属**：`dramas` 表无 `user_id` 列，所有登录用户看到同一份内容
2. **角色二分粒度太粗**：现状只有 `super_admin` 和 `user`。zhx 被设成 super_admin，但产品期望他是"团队管理员"——能管账号但不能动 AI 配置/提示词
3. **临时 hack 机制需要清理**：之前用 `featureGates.PROMPT_HIDDEN_USERS = ['zhx']` 给 zhx 单独打补丁，引入正式角色后这个 hack 就该删掉

## 目标

1. dramas / 三个素材库的内容按用户隔离，每个用户只能看到自己的
2. 引入"管理员"角色：能管用户、不能动系统配置
3. super_admin 可通过开关切换"我的 / 全部"视图，跨用户查看
4. 删除 featureGates 临时模块

## 三角色权限矩阵

| 能力 | super_admin (admin 账号) | admin (zhx) | user (普通用户) |
|---|---|---|---|
| 登录 / 改自己密码 | ✅ | ✅ | ✅ |
| 看自己创建的内容 / 创建内容 | ✅ | ✅ | ✅ |
| 跨用户查看（「全部」开关 + creator 标签） | ✅ | ❌ | ❌ |
| 看用户列表 | ✅ | ✅ | ❌ |
| 创建 user 账号 | ✅ | ✅ | ❌ |
| 创建 admin 账号 | ✅ | ❌ | ❌ |
| 创建 super_admin 账号 | ✅ | ❌ | ❌ |
| 删除/禁用/重置密码 user | ✅ | ✅ | ❌ |
| 删除/禁用/重置密码 admin/super_admin | ✅ | ❌ | ❌ |
| AI 配置 list（脱敏） | ✅ | ✅ | ✅ |
| AI 配置看明文 key | ✅ | ❌ | ❌ |
| AI 配置增删改/换 key/测试 | ✅ | ❌ | ❌ |
| 编辑提示词 | ✅ | ❌ | ❌ |
| 编辑业务场景模型映射 | ✅ | ❌ | ❌ |
| 编辑生成设置（并发数等） | ✅ | ❌ | ❌ |

## 数据模型

### users 表（已存在）

`role` 列值域扩展：`'super_admin' | 'admin' | 'user'`

迁移：
- admin (id=1)：保持 super_admin
- zhx (id=4)：super_admin → **admin**
- test (id=3)：保持 user

### 4 张顶层表加 `user_id` 列

```sql
ALTER TABLE dramas              ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE character_libraries ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE scene_libraries     ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE prop_libraries      ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX idx_dramas_user_id              ON dramas(user_id);
CREATE INDEX idx_character_libraries_user_id ON character_libraries(user_id);
CREATE INDEX idx_scene_libraries_user_id     ON scene_libraries(user_id);
CREATE INDEX idx_prop_libraries_user_id      ON prop_libraries(user_id);
```

### 现有数据归属（手工指定）

| 表.id | 名称 | user_id |
|---|---|---|
| dramas.1 | 江河 | 1 (admin) |
| dramas.2 | 日上 | 1 (admin) |
| dramas.3 | 测试 | 4 (zhx) |
| character_libraries.* | 15 行 | 1 (admin) |
| scene_libraries.* | 2 行 | 1 (admin) |
| prop_libraries.* | 9 行 | 1 (admin) |

### 下游表不动 schema

下游表 (episodes / scenes / characters / props / storyboards / image_generations / video_generations / video_merges / assets / 关联表) **不加 user_id 列**。

归属判断通过 `drama_id` 反查 dramas.user_id（A 方案）。

## 后端实现

### 1. 权限中间件

`backend-node/src/middleware/permissions.js`（新建，重构现有 auth 中间件结构）：

```js
const ROLES = { super_admin: 3, admin: 2, user: 1 };

function hasRoleAtLeast(user, level) {
  return user && ROLES[user.role] >= ROLES[level];
}

function requireSuperAdmin(req, res, next) {
  if (!hasRoleAtLeast(req.user, 'super_admin')) return _403(res, '需要超级管理员权限');
  next();
}

function requireAdminOrAbove(req, res, next) {
  if (!hasRoleAtLeast(req.user, 'admin')) return _403(res, '需要管理员或以上权限');
  next();
}
```

### 2. Ownership middleware

```js
// 资源 → SQL 解析器
const OWNERSHIP_RESOLVERS = {
  drama:    { sql: 'SELECT user_id FROM dramas WHERE id = ?' },
  episode:  { sql: 'SELECT d.user_id FROM episodes e JOIN dramas d ON d.id = e.drama_id WHERE e.id = ?' },
  scene:    { sql: 'SELECT d.user_id FROM scenes s JOIN dramas d ON d.id = s.drama_id WHERE s.id = ?' },
  character:{ sql: 'SELECT d.user_id FROM characters c JOIN dramas d ON d.id = c.drama_id WHERE c.id = ?' },
  prop:     { sql: 'SELECT d.user_id FROM props p JOIN dramas d ON d.id = p.drama_id WHERE p.id = ?' },
  storyboard:{ sql: 'SELECT d.user_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id JOIN dramas d ON d.id = e.drama_id WHERE s.id = ?' },
  image_generation: { sql: 'SELECT d.user_id FROM image_generations i JOIN dramas d ON d.id = i.drama_id WHERE i.id = ?' },
  video_generation: { sql: 'SELECT d.user_id FROM video_generations v JOIN dramas d ON d.id = v.drama_id WHERE v.id = ?' },
  video_merge: { sql: 'SELECT d.user_id FROM video_merges m JOIN dramas d ON d.id = m.drama_id WHERE m.id = ?' },
  asset:    { sql: 'SELECT d.user_id FROM assets a JOIN dramas d ON d.id = a.drama_id WHERE a.id = ?' },
  character_library: { sql: 'SELECT user_id FROM character_libraries WHERE id = ?' },
  scene_library:     { sql: 'SELECT user_id FROM scene_libraries WHERE id = ?' },
  prop_library:      { sql: 'SELECT user_id FROM prop_libraries WHERE id = ?' },
};

function buildOwnershipMiddleware(db) {
  return function requireOwnership(kind, paramName) {
    const resolver = OWNERSHIP_RESOLVERS[kind];
    if (!resolver) throw new Error(`Unknown ownership kind: ${kind}`);
    return (req, res, next) => {
      const id = req.params[paramName || 'id'];
      const row = db.prepare(resolver.sql).get(id);
      if (!row) return res.status(404).json({...});
      // super_admin + ?scope=all 跨用户访问
      if (req.user.role === 'super_admin' && req.query.scope === 'all') return next();
      if (row.user_id !== req.user.id) return res.status(403).json({...});
      next();
    };
  };
}
```

### 3. List 接口过滤 helper

```js
// 在 service 层用，handler 拼 SQL 时调用
function buildScopeFilter(req, table = '') {
  const prefix = table ? `${table}.` : '';
  if (req.user.role === 'super_admin' && req.query.scope === 'all') {
    return { whereClause: '', params: [] };
  }
  return { whereClause: ` AND ${prefix}user_id = ?`, params: [req.user.id] };
}
```

### 4. routes/index.js 改造（核心摘录）

```js
// 删除：const { isPromptHidden } = require('../constants/featureGates');
// 删除：function denyIfPromptHidden(...)

// 新增：
const { requireSuperAdmin, requireAdminOrAbove } = require('../middleware/permissions');
const { buildOwnershipMiddleware } = require('../middleware/ownership');
const requireOwnership = buildOwnershipMiddleware(db);

// 用户管理：从 requireSuperAdmin 放宽到 requireAdminOrAbove（service 层做更细粒度控制）
r.get('/admin/users', requireAdminOrAbove, admin.listUsers);
r.post('/admin/users', requireAdminOrAbove, admin.createUser);
r.put('/admin/users/:id', requireAdminOrAbove, admin.updateUser);
r.post('/admin/users/:id/reset-password', requireAdminOrAbove, admin.resetPassword);
r.delete('/admin/users/:id', requireAdminOrAbove, admin.deleteUser);

// AI 配置写入：保持 requireSuperAdmin
// （已经是这样，无需改）

// dramas / 下游：每个 :id 路由加 ownership middleware
r.get('/dramas/:id', requireOwnership('drama'), drama.getDrama);
r.put('/dramas/:id', requireOwnership('drama'), drama.updateDrama);
r.delete('/dramas/:id', requireOwnership('drama'), drama.deleteDrama);
// ... 数十个端点同样模式

// list 接口不挂 middleware，handler 内部用 buildScopeFilter 过滤
r.get('/dramas', drama.listDramas);  // listDramas 内部读 req.user 过滤

// 提示词 / 业务场景模型映射 / 生成设置：collapsing 到 requireSuperAdmin
r.get('/settings/prompts', requireSuperAdmin, promptOverrides.list);
r.put('/settings/prompts/:key', requireSuperAdmin, promptOverrides.update);
r.delete('/settings/prompts/:key', requireSuperAdmin, promptOverrides.reset);
r.put('/settings/generation', requireSuperAdmin, settings.updateGenerationSettings);
r.post('/scene-model-map', requireSuperAdmin, sceneModelMap.create);
// ... 业务场景写入路由
```

### 5. service 层改造

**dramaService / list 类接口**：每个 list 接口在 SQL 里加 `WHERE ... AND user_id = ?`，用 `buildScopeFilter`。

**dramaService.create / 三个素材库 create**：
```js
db.prepare('INSERT INTO dramas (..., user_id) VALUES (..., ?)').run(..., req.user.id);
```

**adminService（用户管理）**：
- `createUser`：admin 调用时强制 `role='user'`，super_admin 不限
- `updateUser` / `resetPassword` / `deleteUser`：admin 调用时只能操作 `target.role === 'user'`，否则 403

### 6. 清理 featureGates

- 删除 `backend-node/src/constants/featureGates.js`
- 删除 `userService.rowToUser` 里的 `u.hide_prompts = isPromptHidden(u);`
- 删除 routes/index.js 里 `denyIfPromptHidden` middleware
- 删除前端 `AIConfigContent.vue` 的 `hidePrompts` 计算属性 → 改用 `currentUser?.role === 'super_admin'`

### 7. List 响应需要带 creator 信息

super_admin 切到「全部」模式时，前端需要展示 creator。所以 dramas list / 三个素材库 list 的响应增加 `creator_username` 字段：

```sql
SELECT d.*, u.username AS creator_username
FROM dramas d
LEFT JOIN users u ON u.id = d.user_id
WHERE d.deleted_at IS NULL
  ${scopeFilter.whereClause}
ORDER BY d.created_at DESC
```

普通模式下因为只看自己，creator 都是自己，前端可以选择不展示。

## 前端实现

### 1. FilmList.vue

- 顶部用户标签：
  - super_admin → "超级管理员"
  - admin → "管理员"
  - user → nickname || username
- super_admin 显示「显示所有用户的项目」开关
  - `v-model="showAllUsers"`，watch 切换时重新请求
  - 切到 true 时 GET /dramas?scope=all，否则 GET /dramas
- 「全部」模式下卡片右上角加 `<el-tag>{{ row.creator_username }}</el-tag>`

### 2. 素材库三个页面（角色/场景/道具）

- 跟 FilmList 同样模式：开关 + creator 标签

### 3. AIConfigContent.vue

- "高级设置（提示词）" tab：`v-if="currentUser?.role === 'super_admin'"`
- "高级设置（业务场景）" tab：同上
- "生成设置" tab：同上
- AI 配置 tab 的"添加配置 / 编辑 / 删除 / 测试 / 一键换Key" 按钮：仅 super_admin 显示（admin / user 只能看脱敏 list）

### 4. 用户管理页

- 路由守卫从"super_admin only"改为"admin or super_admin"
- "新建用户"对话框 role 下拉：
  - super_admin: `[user, admin, super_admin]`
  - admin: 固定 `user`（不显示下拉，写死）
- 列表里的"编辑 / 删除 / 重置密码"按钮：admin 看到的列表中，对 admin/super_admin 行隐藏这些按钮

## 测试

### 单元测试（Node 自跑脚本）

`backend-node/scripts/test-permissions.js`（替换 test-feature-gates.js）：

- `hasRoleAtLeast` 各角色组合
- `buildScopeFilter` 在不同 user/scope 下的输出
- `requireOwnership('drama')` 用 mock db 测试

### 集成测试（curl 矩阵）

部署后用 admin / zhx / 新建 user 三身份分别打：
- GET /dramas
- GET /dramas?scope=all
- GET /dramas/1（江河，admin 拥有）
- GET /dramas/3（测试，zhx 拥有）
- POST /dramas（创建）
- POST /admin/users（admin 试图创建 super_admin → 应该 403）
- DELETE /settings/prompts/* （admin 应该 403）

预期：
- admin 打 /dramas/3 应 200（管理员账号也是数据所有者之一情况会出现这种）；其实 admin 打不属于 admin 的 dramas/3 应 403
- zhx 打 /dramas/1 应 403
- super_admin (admin) 打 /dramas?scope=all 看到全部 3 条
- zhx (admin role) 打 /dramas?scope=all → 仍然只看到自己的 1 条（参数被忽略）

## 上线步骤

按 `docs/deploy-standards.md` 标准流程：

1. **本地全部完成 + 测试通过**
2. **生产 db 备份**：`ssh deploy@... "cd .../backend-node/data && sqlite3 drama_generator.db 'VACUUM INTO \"./drama_generator.db.backup-2026-05-04\"'"`（按 feedback_scp_sqlite 教训：用 VACUUM INTO 而非直接 cp）
3. commit → push → ssh git pull
4. 不需要手动跑 migration（启动时自动跑）
5. scp dist + pm2 restart
6. 立即验证：admin 看自己 + 切「全部」/ zhx 看自己 + 用户管理 / 创建一个新 user 登录看自己

## 风险与回滚

### 风险

1. **下游记录孤儿数据**：如果某个 image_generations / video_generations 的 drama_id 指向已删除（deleted_at IS NOT NULL）的 drama，归属判断走 LEFT JOIN 会得到 NULL，按代码逻辑会 403。**需要在 migration 完成后跑一致性检查**：`SELECT COUNT(*) FROM image_generations i LEFT JOIN dramas d ON d.id = i.drama_id WHERE d.id IS NULL`，>0 就报告。
2. **路由层 ownership middleware 漏挂**：项目里下游路由 ~50 个，必须全部覆盖。漏挂等于权限漏洞。**部署前用 grep 审计**：`grep -E '/(dramas|episodes|scenes|characters|props|storyboards|images|videos|video-merges|assets|character-library|scene-library|prop-library)/:id' src/routes/index.js | grep -v requireOwnership` 必须返回空（或仅未受影响的 list 接口）。
3. **前端开关切换的 cache 问题**：上一次部署后用户撞过浏览器缓存导致 tab 没消失（feedback_frontend_cache_after_deploy）。这次涉及更多前端改动，部署后必须强提示用户 hard reload。

### 回滚

1. **代码回滚**：`git checkout HEAD~1` 后 pm2 restart。
2. **数据回滚**：从 VACUUM INTO 备份的 db 恢复（user_id 列会丢失，role 改动会丢失）。

## 实施步骤（顶层视图）

工作量评估：5-8 小时（取决于路由数量真实情况）

1. SQL migration 文件（22_user_data_isolation.sql + 程序化的 NOT NULL 检查）
2. 后端权限模块（permissions.js + ownership.js）
3. 后端 service 层加 user_id 写入和 scope 过滤
4. routes/index.js 全量加 ownership middleware（最大块）
5. 后端用户管理接口加 role 校验（admin 不能造 admin+/不能动 admin+）
6. 删除 featureGates 模块
7. 前端 FilmList + 三个素材库加开关 + creator 标签
8. 前端 AIConfigContent 多个 tab v-if
9. 前端用户管理改造
10. 单测脚本
11. 提交 + push + 部署 + curl 矩阵验证

每完成 2-3 步建议交一次 commit，避免一个巨大 commit 难以审查。

## 文件清单（预期改动）

**新增**：
- `backend-node/migrations/22_user_data_isolation.sql`
- `backend-node/src/middleware/permissions.js`
- `backend-node/src/middleware/ownership.js`
- `backend-node/scripts/test-permissions.js`

**删除**：
- `backend-node/src/constants/featureGates.js`

**修改**：
- `backend-node/src/middleware/auth.js`（保留 authenticate，把 requireSuperAdmin 移到 permissions.js）
- `backend-node/src/services/userService.js`（去掉 hide_prompts 注入；createUser 加 role 字段范围校验）
- `backend-node/src/services/dramaService.js`（list 加 scope 过滤；create 加 user_id）
- `backend-node/src/services/characterLibraryService.js`、`sceneLibraryService.js`、`propLibraryService.js`（同上）
- `backend-node/src/routes/admin.js`（service 层 admin 角色细粒度控制）
- `backend-node/src/routes/index.js`（大量加 ownership middleware）
- `frontweb/src/views/FilmList.vue`
- `frontweb/src/views/CharacterLibrary.vue` 或对应素材库页面（确认文件名）
- `frontweb/src/views/SceneLibrary.vue`
- `frontweb/src/views/PropLibrary.vue`
- `frontweb/src/views/UserManagement.vue`
- `frontweb/src/components/AIConfigContent.vue`
- `frontweb/src/components/PromptEditor.vue`（如果需要 role 守卫）
