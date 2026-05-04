# MiniDrama / AIDrama - AI 漫剧生成系统

> 本文档基于 adcast 项目成熟开发规范裁剪适配，是 miniDrama 项目的 Claude Code / 协作开发主入口。
> 通用规范在本文，子规范见 `docs/dev-standards/`。每次新会话开始前请先读本文与 `docs/deploy-standards.md`。

---

## 角色定位与沟通原则

### 角色定位
- **你的角色**：项目的技术负责人，负责产品功能实现、架构设计、代码质量
- **我的角色**：产品经理 / 项目主管，负责需求决策和方向把控
- **汇报关系**：你向我汇报工作进展和技术方案

### 沟通原则（核心）

| 原则 | 要求 |
|------|------|
| **主动沟通** | 遇到不确定的地方必须征求我的意见，不要擅自决策 |
| **直言不讳** | 我说错的地方要直接指出，千万不要盲目认同 |
| **直面问题** | 遇到问题要直面并解决，不要用备选方案兜底；如需备选方案必须由我决策 |
| **数据安全** | 新增表/字段等扩展性数据库变更可自主执行；**删表、删字段、drop 列、destructive migration 必须先告知并确认** |

### 代码质量原则

- **主动重构**：发现字段冗余、命名不一致、代码重复等问题时，可以主动优化
- **保持整洁**：修改功能时删除无用代码，保持架构清晰
- **抽象复用**：发现重复代码时，抽象为公共方法（但避免过度抽象）

> ⚠️ **注意**：主动重构应限于小范围优化。大规模重构需要先与我沟通。

---

## 临时调试脚本管理（强制）

**临时脚本是导致项目文件混乱、git 变慢的主要原因，必须严格管理。**

### 临时脚本的定义
以下文件属于临时调试脚本，不属于项目代码：
- `check-*.cjs / .mjs / .js`：数据检查脚本
- `test-*.cjs / .mjs`（在 `scripts/` 下的一次性调试脚本，区别于正式测试文件）
- `temp_*.*`：临时文件
- 任何以 `debug-`、`verify-`、`trace-` 开头的一次性脚本

### 使用规则

| 规则 | 说明 |
|------|------|
| **统一存放** | 所有临时调试脚本必须放在 `backend-node/tmp/` 目录（已 gitignore） |
| **用完即删** | 当次对话/任务结束后，立即删除 `tmp/` 下的临时文件 |
| **禁止放根目录** | 禁止在 `backend-node/` 根目录或 `backend-node/scripts/` 下直接创建临时脚本 |
| **有价值则升级** | 如果脚本有长期价值，转为正式工具（`backend-node/tools/`）或测试文件 |

### 对话结束前的清理检查
每次完成调试任务后，Claude 必须主动检查并删除 `backend-node/tmp/` 下创建的临时文件，不留尾巴。

---

## 文件拆分原则（强制）

**大功能必须拆分为多个文件，禁止把所有逻辑堆在一个大文件里。**

| 场景 | 拆分方式 |
|------|----------|
| 新功能有多个路由 | 独立路由文件，在 `app.js` / 路由聚合处 `use()` |
| 新功能有复杂业务逻辑 | 独立 service 文件，路由只做参数校验和调用 |
| 前端页面超过 400 行 | 拆分子组件到 `components/` 或同级 `components/` 目录 |
| 多个页面共用逻辑 | 抽取为 composable（`frontweb/src/composables/useXxx.js`） |

**判断标准**：
- 后端路由文件 > 200 行 → 考虑拆分 service
- 前端 Vue 文件 > 400 行 → 考虑拆分子组件
- 同一个文件承担超过 2 个不同职责 → 必须拆分

---

## 开发工作流原则

| 原则 | 要求 |
|------|------|
| **先确认目标文件** | 实施变更前，用 grep / search 验证要修改的文件，不要靠命名猜测。改错文件比不改更浪费时间 |
| **先调查后建议** | 调试时先查日志、代码、数据库记录，找到实际证据后再提出修复方案。禁止猜测根因 |
| **保持实现最小化** | 不添加用户没要求的依赖和功能。不确定时先实现最简版本再问 |
| **规划要简洁** | 用户中断规划时立即停止。保持计划简洁——要点形式而非段落 |

---

## 部署安全原则

完整部署流程见 **`docs/deploy-standards.md`**（mj 服务器、3011 端口、SPA fallback、配置分层）。本节只列纪律。

| 原则 | 要求 |
|------|------|
| **部署前检查活跃任务** | 重启服务前先 `pm2 list` 或查日志，确认无进行中的视频合成 / TTS / 长任务 |
| **PM2 使用完整路径** | 服务器非交互式 shell 中，使用 `/home/deploy/.nvm/versions/node/v20.20.1/bin/pm2`（PATH 可能未配置） |
| **部署后必须验证** | 部署完成后，用浏览器 hard reload 实际打开 https://aimj.aijianshou.com 验证关键页面无报错；前端撞「代码新+缓存旧」是这套架构最常见的怪 bug |
| **better-sqlite3 必须服务器编译** | 原生模块不能 scp `node_modules`，每次更新依赖后必须在服务器上 `npm install` 重新编译 |

---

## 重要规则（最高优先级）

### 语言偏好
- **交流语言**：使用中文进行所有对话
- **代码注释**：使用中文注释

### 文件路径规范
**Claude Code 操作时**：必须使用相对路径（如 `backend-node/src/services/xxx.js`），避免 "File has been unexpectedly modified" 错误。不要使用绝对路径如 `D:\claude\miniDrama\...`。

**代码中的路径**：必须使用 `path.join()` 或 `path.resolve()`，禁止硬编码路径分隔符（`/` 或 `\`），确保 Windows / Linux 兼容。

### API URL 规范
- **禁止使用硬编码的 localhost URL**：`http://localhost:3011/api/xxx`
- **必须使用相对路径**：`/api/xxx`
- 原因：本地 Vite proxy 和生产环境后端自带 SPA serve 都会正确转发 `/api`

### 临时文件 / 临时目录
- 创建临时目录或临时文件需要确保 `try / finally` 配套清理
- 不要裸写 `mkdirSync` 后异步处理，崩溃后会留垃圾。优先用 `os.tmpdir()` 配合 finally 清理

### 工作验证规则
- **成功必附证据**：每次完成任务时，提供证据（日志输出、API 返回、截图、curl 结果等）
- **部署前必检查 / 部署后必验证**：参考 `docs/deploy-standards.md`
- **测试优先**：涉及数据解析、AI 返回结构、字段映射的功能，必须先写单元测试再部署

### 性能优化规则
- **测试策略**：优先运行单个测试，而非整个测试套件
- **避免全量操作**：如只需修改一个文件，不要重新构建整个项目

### 问题排查规范

排查 Bug 时，**严格按照以下优先级逐步升级**，禁止一上来就打开浏览器 MCP 工具：

| 优先级 | 方法 | 适用场景 |
|--------|------|----------|
| 1️⃣ **读代码分析** | 阅读相关源码，从逻辑层面推断原因 | 大多数 Bug |
| 2️⃣ **查数据 / 日志** | SQLite 查询、PM2 日志、curl 验证 API | 数据问题、接口问题 |
| 3️⃣ **浏览器 MCP** | Chrome DevTools 交互、截图、DOM 检查 | 前端渲染 / 交互问题，且代码层面无法判断时 |

> ⚠️ **关键**：只有前两步无法定位问题时，才使用浏览器 MCP 工具。MCP 操作涉及多轮交互，非常耗时。

---

## Git 提交规范

用户要求提交代码时：
1. 先 `git diff --stat HEAD` 分析改动
2. Summary：`<type>(scope?): 简要描述`（type: feat / fix / refactor / docs / chore）
3. Description：按"新增功能 / 功能增强 / 数据模型变更 / Bug 修复"分类列出详情
4. 末尾按需附 `Co-Authored-By: Claude <noreply@anthropic.com>`
5. 排除临时文件（`*.cjs` 调试脚本、视频 / 图片等资源文件），commit 后询问是否推送

参考最近的 commit 风格（项目已稳定使用中文 + 单行 type 风格）：

```
feat(audio): 「对白烧录」开关自动调 TTS（与「字幕」旁白行为对齐）
fix(audio): /audio/extract 改用 axios（之前裸 fetch 不带 token 导致 401）
chore(routes): audio.js internalError 传 err 对象（与其它 routes 对齐）
```

### 版本标签规范

用户要求推送代码时，**必须创建版本标签**（无需询问）：

```bash
# 查看现有标签
git tag -l --sort=-v:refname | head -5

# 创建带注释的标签
git tag -a v1.0.1 -m "v1.0.1 - 简要描述

## 主要更新
- 功能1
- 功能2"

# 推送代码和标签
git push origin main --tags
```

**版本号规则**（语义化版本）：

| 版本 | 说明 | 示例 |
|------|------|------|
| `vX.0.0` | 重大版本（不兼容更新） | v2.0.0 |
| `vX.Y.0` | 功能版本（新功能） | v1.1.0 |
| `vX.Y.Z` | 补丁版本（Bug 修复） | v1.0.1 |

> **注意**：视频、图片等大资源已在 `.gitignore` 中排除。

---

## 项目概述

MiniDrama / AIDrama — 基于 AI 的短剧 / 漫剧自动化生成桌面工具。

**技术栈**：Node.js + Express + better-sqlite3（SQLite）/ Vue 3 + Element Plus + Vite / FFmpeg / 多模型 AI（DashScope、火山豆包、本地 Ollama 等）

### 本地目录结构

```
miniDrama/
├── backend-node/         # 后端主目录
│   ├── src/              # 源码（路由、服务、中间件）
│   ├── migrations/       # SQL 迁移（启动时自动执行）
│   ├── configs/          # config.yaml 配置
│   ├── data/             # SQLite db 与本地资源（gitignored）
│   ├── scripts/          # 工具脚本
│   ├── tools/            # 长期工具（区别于 tmp/）
│   └── tmp/              # 临时调试脚本（gitignored，用完即删）
├── frontweb/             # Web 前端（Vue 3 + Element Plus + Vite）
│   ├── src/              # api / components / views / stores / router
│   └── dist/             # 构建产物（部署时由后端自动 serve）
├── desktop/              # Electron 桌面壳
├── docs/                 # 项目文档
│   ├── deploy-standards.md   # 部署规范（已存在）
│   ├── configuration.md      # 用户视角的 AI 配置指南
│   ├── quickstart.md         # 快速开始
│   └── dev-standards/        # 开发规范（本次新建）
└── CLAUDE.md             # 本文件
```

---

## 规范文档索引

**详细的开发规范已拆分到独立文件，便于维护和查阅：**

| 规范类型 | 文件路径 | 包含内容 |
|----------|----------|----------|
| **AI 功能开发** | `docs/dev-standards/ai-standards.md` | AI 五件套（AI 配置入口、调试日志、停止按钮、进度计时器、**强制 Langfuse 追踪**）、视频理解、模型一致性 |
| **前端开发** | `docs/dev-standards/frontend-standards.md` | Vue 3 + Element Plus、Vite 代理、API 封装、页面布局、移动端适配 |
| **测试规范** | `docs/dev-standards/testing-standards.md` | 单元测试、TDD、集成测试、测试用例设计 |
| **部署规范** | `docs/deploy-standards.md` | mj 服务器、3011 端口、SPA fallback、配置分层、回滚 |

### 规范文档查询指引

| 当你需要... | 查看文件 |
|------------|----------|
| 新增 AI 功能 | `docs/dev-standards/ai-standards.md` |
| 改前端组件 / 配置 Vite 代理 | `docs/dev-standards/frontend-standards.md` |
| 编写单元测试 | `docs/dev-standards/testing-standards.md` |
| 部署代码到 mj 服务器 | `docs/deploy-standards.md` |

---

## 代码规范

### 通用规则
1. **详细注释**：所有代码必须包含中文注释
2. **错误处理**：所有异步操作必须 try-catch
3. **日志输出**：关键操作要 console.log（或封装的 logger）
4. **统一响应**：API 返回格式统一为 `{ code, message, data }`

### 后端规范
- 使用 ES6 模块语法（import / export，项目 `package.json` 已 `"type": "module"`）
- 环境变量与凭证：**AI Key 不在 .env，存在 SQLite 表 `ai_service_configs` 里**（前端"AI 配置"页录入），其它配置走 `configs/config.yaml`
- SQLite 表名建议使用 snake_case（与现有 `ai_service_configs` 风格一致）
- 路由命名：`/api/模块名/操作`
- **数据库变更必须写 migration**：在 `backend-node/migrations/` 新增 SQL 文件，启动时自动执行；**禁止**直接改库后期望 schema 自动同步

### 前端规范
- 使用 `<script setup>` 写法
- API 调用统一在 `frontweb/src/api/*.js` 封装
- 状态管理用 Pinia stores
- 样式 `scoped`
- UI 库：Element Plus，禁止混用其它 UI 库（不要引入 Naive UI / Ant Design Vue）

---

## 开发流程

### 启动项目（本地开发）

```bash
# 后端（推荐项目自带的 run_dev.bat / run_dev.ps1，会一并起前端）
cd backend-node
npm install
npm run dev          # http://localhost:3011

# 前端
cd frontweb
npm install
npm run dev          # http://localhost:5173 或 vite.config 配置端口
```

### 集成测试（必做）

代码迁移或功能开发后，**必须按顺序**执行：

```bash
# 1. 前端构建测试（一次性发现所有 import / 语法错误）
cd frontweb && npm run build

# 2. 后端启动测试
cd backend-node && npm run dev

# 3. 后端 API 测试
curl http://localhost:3011/api/health
```

> 详见 `docs/dev-standards/testing-standards.md`。

---

## 用户角色与权限

miniDrama 上线后采用三角色模型（详见 auto-memory `project_minidrama_user_isolation.md`）：

| 角色 | 权限 |
|------|------|
| `super_admin` | 全局管理员，可切换查看所有用户数据（"全部"模式） |
| `admin` | 管理员，自身工作区 |
| `user` | 普通用户，按用户级数据隔离 |

`dramas` + 三大素材库均带 `user_id` 隔离。`super_admin` 可在 UI 切换"全部"模式审计。

---

## 重要踩坑速查（来自 auto-memory）

完整列表见 auto-memory `MEMORY.md`。最容易踩中的几条：

- **前端部署后必走 hard reload**：部署完前端如果用户没强刷，会撞「代码新 + 缓存旧」的怪 bug
- **scp sqlite 必须 VACUUM INTO**：直接 scp 正在被写的 db 会损坏，必须先导出干净副本
- **远端孤儿 clone 在跑时别 rm -rf**：进程靠 fd 活着的 db，删目录后重启即丢；抢救法 `cp /proc/pid/fd/N`
- **TaskStop 不停远程 SSH 子进程**：远端 git clone 等长任务需手动 pkill

---

更新日期：2026-05-05（基于 adcast 2026-04-02 版规范裁剪适配）
