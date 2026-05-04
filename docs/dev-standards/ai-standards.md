# AI 功能开发规范

> 本文档包含所有 AI 功能开发相关的规范，新增 AI 功能时必须遵循。
> 基于 adcast 同名规范裁剪：去掉 adcast 业务专属 stage、UI 示例改为 Element Plus。**Langfuse 与 adcast 一样是宪法级强制**，所有 AI 调用必须推 trace。

---

## AI 模型配置规范（前端）

**核心原则：所有需要调用 AI 模型的新功能，必须使用统一的 AI 配置入口组件**

> 项目内若已有 `AiConfigDialog`（或同义组件），新功能必须复用，**禁止**为新功能单独开发 AI 模型下拉框。如果尚未抽出，先 grep 现有页面是否有重复实现，再决定抽组件还是先用已有 pattern。

### 放置位置规范（强制）
**AI 配置组件必须放在对应的 AI 生成或处理按钮旁边**，而不是放在页面头部。

示例：
- ✅ 正确：在"开始分析"按钮旁边放置 AI 配置按钮
- ❌ 错误：在页面右上角统一放置 AI 配置按钮

```vue
<!-- ✅ 正确：AI 配置按钮紧邻功能按钮 -->
<div class="action-buttons">
  <el-button type="primary" @click="startAnalysis">开始分析</el-button>
  <el-button @click="showAiConfig = true">
    <el-icon><Setting /></el-icon>
    AI 配置{{ currentModelName ? ` ${currentModelName}` : '' }}
  </el-button>
</div>
```

### 使用规范
- **必须复用**：禁止为新功能单独开发 AI 模型下拉选择框
- **统一配置管理**：AI 配置通过统一接口管理（项目当前用 `ai_service_configs` 表 + 前端 `AI 配置` 页面）
- **stage 命名规范**：新功能的 stage 命名格式为 `模块-功能`（小写连字符）

### 已支持的 stageType 列表（待补全）

> 当 miniDrama 内的 AI 功能稳定后，在此处维护 stageType 表格。新增 AI stage 时**必须**同步更新此清单。

| stageType | 功能说明 |
|-----------|----------|
| `tts` | 文本转语音 |
| `script-generate` | 剧本生成 |
| `storyboard` | 分镜生成 |
| `video-generate` | 视频生成 |
| `audio-generate` | 音频 / 音效生成 |
| ...（待补全） | ... |

---

## 默认模型规范

**特定功能应使用推荐的默认模型，确保最佳效果**

| 功能类型 | 默认模型（候选） | 说明 |
|----------|----------|------|
| **视频理解 / 多模态** | `doubao-seed-2-0-pro-260215`（豆包 Seed 2.0 Pro） | 多模态旗舰，原生视频输入 |
| **文本生成 / 分析** | DashScope `qwen-plus` 或豆包 `doubao-seed-2-0-pro-260215` | 项目内长文本任务 |
| **TTS 文本转语音** | 火山豆包 TTS / 阿里 CosyVoice | 见 `configuration.md` |

> 具体模型版本以项目数据库 `ai_service_configs` 表的实际配置为准。CLAUDE.md 强调过：**AI Key 不在 .env，而在 SQLite 表里**。

---

## 前后端模型配置一致性规范（强制）

**核心原则：前端 AI 配置组件选择的模型，必须与后端实际调用的模型完全一致。**

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 前端切换模型后不生效 | 后端没有从数据库读取配置 | 后端必须从 `ai_service_configs` 表读取 |
| 后端硬编码模型名称 | 没有使用数据库配置 | 用 `db.prepare('SELECT ... FROM ai_service_configs WHERE ...').get()` |
| stageType 与后端不匹配 | 前端用 `script-generate`，后端用 `script` | 统一使用相同的标识符 |

### 实现要求

#### 后端读取配置（better-sqlite3 风格）

```javascript
// ✅ 正确：从数据库读取配置
import db from '../db/index.js'

const config = db.prepare(`
  SELECT model, temperature, max_tokens
  FROM ai_service_configs
  WHERE stage_type = ?
`).get('script-generate')

const modelName = config?.model || 'doubao-seed-2-0-pro-260215'
const temperature = config?.temperature ?? 0.3
const maxTokens = config?.max_tokens ?? 4000

// ❌ 错误：硬编码模型名称
const modelName = 'doubao-seed-2-0-pro-260215'
```

#### stageType 命名一致性

前端组件传的 `stageType` 必须与后端查询的 `stage_type` 完全一致：

```vue
<!-- 前端 -->
<AiConfigDialog
  stage-type="script-generate"
  stage-name="剧本生成"
/>
```

```javascript
// 后端 - 必须使用相同的值
const config = db.prepare(`
  SELECT * FROM ai_service_configs WHERE stage_type = ?
`).get('script-generate')
```

### 调试检查清单

当发现前端配置与后端调用不一致时，按以下步骤排查：

1. **检查前端 stageType**：确认配置组件的 `stage-type` 属性值
2. **检查保存接口**：确认 POST 接口是否真的写到数据库（用 SQLite 客户端打开 db 验证）
3. **检查后端读取**：确认后端是否从正确的 stage_type 读取配置
4. **检查日志**：后端必须打印实际使用的模型名称

```javascript
console.log(`[${stageType}] 使用模型: ${modelName}, temperature: ${temperature}, maxTokens: ${maxTokens}`)
```

---

### ⚠️ 已知风险：前端修改提示词不生效

**症状**：用户在 AI 配置弹窗中修改提示词并保存，但后端实际执行时仍使用旧提示词。

**根本原因**：如果 AI 服务在模块加载时把提示词读到内存对象一次后就不再更新，前端调用"保存配置"接口 → 写入 DB → 但内存缓存未刷新，导致实际调用时仍读旧值。

**修复原则**：
- 每次 AI 调用前，必须从 DB 或文件**实时读取**最新提示词，不能依赖模块级缓存
- 如有性能考虑，可使用**请求级缓存**（在每次请求内复用），但不能跨请求缓存

---

## AI 模型调用规范（后端）

- **统一封装**：所有 AI 模型调用应集中在 `backend-node/src/services/aiService.js`（或类似入口），便于切换厂商
- **禁止直接硬编码模型参数**：不要在每个业务函数中单独判断模型类型并加特殊参数
- **统一处理模型特殊参数**：各模型的特殊参数集中维护

### 模型特殊参数说明

| 模型 | 特殊参数 | 说明 |
|------|----------|------|
| **豆包 Seed-2.0**（`doubao-seed-2-0-*`） | `reasoning_effort` | 思考深度：`minimal`（最快）/ `low` / `medium` / `high`（最慢深度思考），默认 `minimal` |
| **DashScope 通义** | `enable_thinking` 等 | 见 DashScope 官方文档 |
| **本地 Ollama** | `num_ctx`、`temperature` 等 | 由本地服务直接控制 |

> 详见 `docs/configuration.md` 各厂商章节。

---

## ⚡ AI 功能五件套（宪法级强制规则）

> **这是最高优先级的强制规则。新增任何 AI 功能，必须同时具备以下五件套，缺一不可。没有例外。**

| 序号 | 组件 | 功能说明 |
|------|------|----------|
| 1 | **AI 配置入口** | 选择模型、查看 / 编辑提示词（区分 System / User） |
| 2 | **调试日志面板** | 显示 API 调用过程、耗时、token 消耗等（**仅 admin / super_admin 可见**） |
| 3 | **停止按钮** | 长任务必须可中止，并联动后端 refund 积分 |
| 4 | **进度显示** | 进度条 + 计时器（已耗时） |
| 5 | **Langfuse 追踪** | 所有 AI 调用必须推 trace 到 mj 自托管 Langfuse 实例（详见下文 Langfuse 章节） |

### 调试日志组件规范

**功能**：显示 AI API 调用的详细过程，便于调试和问题排查。

> ⚠️ **UI 必须统一**：所有页面的调试日志面板外观应保持一致——黑色背景（`#1e1e1e`）、深灰标题栏（`#2d2d2d`）、等宽字体、放大全屏按钮。不允许各页面自行定制样式。

> ⚠️ **调用细节必须完整**：每次 AI API 调用，以下信息必须全部记录到调试日志中：
> 1. 调用开始时间、使用模型名称
> 2. System Prompt 长度（字符数）、User Prompt 长度（字符数）
> 3. API 响应耗时（秒）
> 4. 输入 token 数、输出 token 数、总 token 数
> 5. 返回结果摘要（前 100 字符）
> 6. requestId（如果 API 返回）
> 7. 失败时的完整错误信息

**权限控制（强制）**：

```javascript
// 管理员权限判断
import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
const isAdminOrAbove = computed(() =>
  userStore.role === 'super_admin' || userStore.role === 'admin'
)
```

```vue
<!-- 调试日志面板（仅 admin / super_admin 可见） -->
<div v-if="isAdminOrAbove && currentTask" class="debug-panel">
  <!-- 面板内容 -->
</div>
```

**适用范围**：以下所有类型的运行日志 / 调试日志都必须加 `isAdminOrAbove` 限制：

| 日志类型 | 说明 | 示例 |
|----------|------|------|
| **SSE 运行日志** | 生成 / 分析过程中的实时日志 | `[01:42:10] [一步分析] 完成 (20.0秒)` |
| **调试面板** | 详细的 API 调用过程 | 模型名称、token 消耗、耗时 |
| **AI 配置按钮** | 模型选择和提示词配置 | AiConfigDialog 的入口按钮 |

#### UI 规范

**整体布局**：

```
┌────────────────────────────────────────────────────────────┐
│ ∨ 调试日志                              6条  [清空] [⛶] │  ← 标题栏
├────────────────────────────────────────────────────────────┤
│ ┃ 15:51:03  [状态] 开始逐集大纲分析...                    │  ← status 类型（左侧竖线）
│   15:51:04  [E1] [0.00s] 开始分析，模型：doubao-seed-...  │  ← info 类型
│   15:51:04  [E1] [0.00s] URL 类型: signed_video, ...      │
└────────────────────────────────────────────────────────────┘
```

**日志条目格式（必需）**：

```
时间戳    [标识符] [耗时] 消息内容
15:51:04  [E1]    [0.00s] 开始分析，模型：doubao-seed-2-0-pro-260215
```

| 字段 | 格式 | 颜色 | 说明 |
|------|------|------|------|
| 时间戳 | `HH:MM:SS` | `#888` | 固定宽度 70px |
| 标识符 | `[E1]` / `[状态]` | `#64b5f6` | 集数或状态标识 |
| 耗时 | `[0.00s]` | `#888` | 从任务开始的累计时间 |
| 消息 | 自由文本 | 根据类型 | 日志内容 |

**日志类型样式**：

| type | 颜色 | 特殊样式 | 用途 |
|------|------|----------|------|
| `info` | `#d4d4d4` 白色 | 无 | 一般信息 |
| `success` | `#4caf50` 绿色 | 无 | 成功完成 |
| `error` | `#f44336` 红色 | 无 | 错误信息 |
| `warning` | `#ff9800` 橙色 | 无 | 警告信息 |
| `status` | `#18a058` 青色 | **左侧竖线** | 状态变更 |

**数据结构**：

```javascript
const debugLogs = ref([])
const taskStartTime = ref(null)

function addDebugLog(episode, message, type = 'info', requestId = '') {
  const now = Date.now()
  const elapsed = taskStartTime.value
    ? ((now - taskStartTime.value) / 1000).toFixed(2) + 's'
    : '0.00s'

  debugLogs.value.push({
    timestamp: new Date().toLocaleTimeString(),
    episode,
    message,
    type,
    requestId,
    elapsed
  })
  // 限制日志数量，防止内存溢出
  if (debugLogs.value.length > 200) {
    debugLogs.value.shift()
  }
}
```

---

## AI 调用停止按钮规范（强制）

**核心原则：所有 AI 调用都应该有"停止"按钮，允许用户中止长时间运行的任务。**

### 实现要求

1. **保存请求引用**：SSE 连接 / fetch AbortController 必须保存引用，以便停止时关闭
2. **组件卸载时清理**：在 `onUnmounted` 中关闭未完成的连接，防止内存泄漏
3. **状态更新**：停止后需要更新相关状态变量（清进度条、关弹窗）
4. **后端联动**：如有积分预扣（reserve），停止时必须 refund，**不能只在前端关连接**

### 代码示例

```javascript
const phase1Running = ref(false)
let eventSourceRef = null

function stopPhase1() {
  if (eventSourceRef) {
    eventSourceRef.close()
    eventSourceRef = null
    phase1Running.value = false
    ElMessage.warning('已停止')
  }
  // 通知后端释放积分预扣
  request.post('/api/script/stop', { taskId: currentTaskId.value })
}

onUnmounted(() => {
  if (eventSourceRef) {
    eventSourceRef.close()
    eventSourceRef = null
  }
})
```

**模板示例**：

```vue
<div class="progress-with-stop">
  <el-progress :percentage="extractProgress" />
  <el-button v-if="phase1Running" type="danger" size="small" @click="stopPhase1">
    停止
  </el-button>
</div>
```

---

## 等待类按钮计时器规范（强制）

**核心原则：所有需要等待的操作（AI 生成、视频处理、文件导出等）必须显示计时器，让用户了解等待时间。**

> 此规则在 miniDrama 已稳定执行（见 commit `f5006ab feat(ui): 所有「生成中」类前端按钮/Placeholder 显示已耗时`、`a027ab2 feat(ui): 分镜「正在生成视频...」加上已耗时显示`）。新增 AI 调用按钮时必须遵守。

### 适用场景

| 场景 | 说明 |
|------|------|
| AI 生成 | 剧本生成、分镜生成、TTS、视频生成等 |
| 视频处理 | 视频合并、字幕烧录、对白烧录、帧提取等 |
| 文件导出 | PDF 导出、视频导出等 |
| 批量操作 | 批量生成、批量处理等 |

### 格式要求

- 小于 60 秒：`Xs`（如 `45s`）
- 1-60 分钟：`Xm Xs`（如 `2m 30s`）
- 超过 1 小时：`Xh Xm`（如 `1h 15m`）

### 代码示例

```javascript
function formatElapsed(seconds) {
  if (seconds < 60) {
    return `${seconds}s`
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  } else {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${mins}m`
  }
}
```

**按钮模板**：

```vue
<el-button type="primary" :loading="isRunning" @click="startOperation">
  {{ isRunning ? `生成中 ${timerDisplay}` : '开始生成' }}
</el-button>
```

---

## 进度弹窗规范（前端）

详见 `docs/dev-standards/frontend-standards.md` 的"进度弹窗规范"章节（Element Plus 版本）。

---

## 视频理解组件（后端）

**核心原则：所有涉及视频分析的功能，必须使用统一的视频理解服务。**

### 默认模型配置

**视频理解功能强制使用支持视频原生输入的模型**

| 配置项 | 值 | 说明 |
|--------|----|----- |
| 模型类型 | `doubao` | 豆包 (火山引擎) |
| 模型 ID | `doubao-seed-2-0-pro-260215` | Seed-2.0-Pro 多模态旗舰模型 |
| API 地址 | `https://ark.cn-beijing.volces.com/api/v3` | 火山引擎 ARK 平台 |

> **为什么只支持豆包？** 视频理解需要模型原生支持视频输入，目前只有豆包的 Seed 系列支持直接传入视频文件 / URL。后续若 DashScope 推出视频原生模型可补充。

---

## Langfuse 追踪规范（强制）

**核心原则：所有 AI 调用必须通过 Langfuse 记录 trace，便于监控、调试和成本分析。无例外。**

### Langfuse 实例信息（mj 自托管）

| 项 | 值 |
|---|---|
| Web 控制台 | https://mjlf.aijianshou.com |
| 部署位置 | mj 服务器（115.191.45.199），与 miniDrama 后端共置 |
| Nginx 站点 | `mjlf-langfuse`（mj 服务器 `/etc/nginx/sites-available/`） |
| Trace 链接示例 | `https://mjlf.aijianshou.com/project/<projectId>/traces/<traceId>` |

### 凭证存放（与 adcast 一致）

凭证存在 SQLite 表 `ai_service_configs`（**不是 .env**），与其它 AI Key 走同一套机制：

| 模式 | model_type | 说明 |
|------|-----------|------|
| 自托管（当前生产） | `langfuse-selfhosted` | 指向 https://mjlf.aijianshou.com |
| 云端（备用） | `langfuse-cloud` | 指向 https://cloud.langfuse.com |

后端 `langfuseService.js` 启动时从 `ai_service_configs` 读出 `secret_key` / `public_key` / `host` 三件，初始化 Langfuse client。前端不直接接触 Langfuse 凭证，只在「AI 配置」页录入。

### 接入要求

每次 AI 调用必须记录：

1. **Trace 信息**：任务 ID、用户 ID、用户名、功能模块（中文）、环境标签
2. **Generation 信息**：模型名称（**具体模型 ID，不是厂商类型**）、输入 prompt（System + User 完整内容）、输出结果
3. **统计信息**：input tokens、output tokens、total tokens、耗时、成本（如能算）
4. **失败信息**：失败时 trace 必须 `level: 'ERROR'` + 完整 error message

### 接入清单（每个新 AI 调用必走）

```
[ ] 服务文件顶部 import langfuseService
[ ] 任务开始时 createTrace（带 userId、username、stage 中文名、metadata）
[ ] 每次 AI API 调用前后 createGeneration / updateGeneration
[ ] 任务结束时 finalizeTrace（success: true/false + totalTokens）
[ ] 异常分支也要 finalizeTrace（不要让 trace 悬空）
[ ] 本地跑一次确认 https://mjlf.aijianshou.com 控制台能看到这条 trace
```

### 模型名记录规范

```javascript
// ✅ 正确：使用具体模型 ID
const modelName = userModelName || 'doubao-seed-2-0-pro-260215'
// 追踪显示：doubao-seed-2-0-pro-260215

// ❌ 错误：使用厂商类型
const modelName = task.modelType || 'doubao'
// 追踪显示：doubao（无法区分具体模型版本，调试时分不清是哪个模型出的问题）
```

**fallback 链**：

```javascript
// ✅ 正确：从 AI 配置解析出来的具体模型名优先
const actualModelName = userModelName || 'doubao-seed-2-0-pro-260215'

// ❌ 错误：把厂商类型当模型名兜底
const actualModelName = task.userModelName || task.modelType || 'doubao-seed-2-0-pro-260215'
```

### 标签规范（强制使用中文）

> ⚠️ 所有 Langfuse 标签必须使用中文，包括 trace name、generation name、tags、metadata 的 key 和 value。英文标签在 Langfuse 控制台难以辨认。

| 用途 | 正确（中文） | 错误（英文） |
|------|------------|------------|
| 环境标识 | `生产环境` / `开发环境` | `Production` / `Development` |
| 模块：剧本生成 | `剧本生成` | `script` |
| 模块：分镜 | `分镜生成` | `storyboard` |
| 模块：TTS | `文本转语音` / `对白配音` | `tts` |
| 模块：视频生成 | `视频生成` | `video-gen` |
| 模块：参考图 | `参考图生成` | `reference-image` |
| 操作类型 | `视频理解` / `文本生成` / `数据分析` | `video` / `text` / `analysis` |

**metadata 字段命名也必须中文**：

```javascript
// ✅ 正确
metadata: {
  '功能模块': '剧本生成',
  '剧目ID': dramaId,
  '集数': episodeNumber,
  '模型名称': modelName,
  '用户角色': userRole
}

// ❌ 错误
metadata: {
  module: 'script',
  dramaId,
  episode: episodeNumber,
  model: modelName
}
```

### 使用示例（新增 AI 服务时按此模板）

```javascript
import langfuseService from './langfuseService.js'

// 1. 创建 Trace（任务开始时）
const trace = await langfuseService.createTrace({
  name: '剧本生成',                          // 中文！
  userId: user.id,
  username: user.username,
  stage: 'script-generate',
  modelName: userModelName || 'doubao-seed-2-0-pro-260215',
  metadata: {
    '剧目ID': dramaId,
    '集数': episodeNumber,
    '功能模块': '剧本生成'
  }
})

// 2. 创建 Generation（每次 AI 调用前）
const generation = langfuseService.createGeneration(trace, {
  name: `第${episodeNumber}集-剧本生成`,
  input: { systemPrompt, userPrompt },
  model: userModelName || 'doubao-seed-2-0-pro-260215',
  modelParameters: { temperature: 0.7, maxTokens: 4000 }
})

// 3. 更新 Generation（AI 返回后）
langfuseService.updateGeneration(generation, {
  output: aiResponse,
  usage: {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens
  }
})

// 4. 完成 Trace（任务结束时，成功 / 失败都要走）
langfuseService.finalizeTrace(trace, {
  success: true,
  totalTokens,
  output: { dramaId }
})

// 5. 异常分支（catch 里）
catch (err) {
  langfuseService.finalizeTrace(trace, {
    success: false,
    error: err.message
  })
  throw err
}
```

### 验证 trace 已上报

新增 AI 调用接入 Langfuse 后，本地或测试环境跑一次完整任务，然后到 https://mjlf.aijianshou.com 控制台搜索本次 trace 名称（如「剧本生成」），**必须能看到这条 trace**且 input/output/usage 完整。看不到 = 没接入成功，**不能算完成**。

---

## 新增 AI 功能开发清单

**开发新 AI 功能时，必须按以下清单检查**：

- [ ] **AI 配置入口**：使用统一组件选择模型与提示词
- [ ] **调试日志**：添加调试日志面板（仅 admin / super_admin 可见），记录 API 调用过程
- [ ] **停止按钮**：提供停止按钮允许用户中止长时间任务，并联动后端 refund 积分
- [ ] **进度显示**：显示进度条和计时器（已耗时）
- [ ] **积分接入**：四大 AI client 已统一走 `reserve → settle / refund` 状态机，新功能必须接入（详见 auto-memory `project_minidrama_credits_system.md`）
- [ ] **Langfuse 追踪接入（强制）**：所有 AI 调用必须推 trace 到 https://mjlf.aijianshou.com，并到控制台肉眼验证一次
- [ ] **错误处理**：失败时给用户明确提示，不要静默失败
- [ ] **stageType 注册**：在本文件"已支持的 stageType 列表"中加一行

---

更新日期：2026-05-05（基于 adcast 2026-03-09 版裁剪适配为 Element Plus + better-sqlite3）
