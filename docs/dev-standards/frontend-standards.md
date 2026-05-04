# 前端开发规范

> 本文档包含 Vue 3 前端开发规范、Vite 代理配置、组件开发规范等。
> 基于 adcast 项目同名规范裁剪，**UI 库已替换为 Element Plus**（adcast 用 Naive UI，miniDrama 用 Element Plus，不要混用）。

## 技术栈

| 技术 | 版本/说明 |
|------|----------|
| Vue | 3.x（Composition API） |
| 语法 | `<script setup>` |
| UI 组件库 | **Element Plus** |
| 路由 | Vue Router 4 |
| 状态管理 | Pinia |
| 构建工具 | Vite |
| HTTP 客户端 | Axios |

---

## 基础规范

### 1. 组件写法
```vue
<template>
  <!-- 模板 -->
</template>

<script setup>
// 使用 Composition API + <script setup>
import { ref, onMounted } from 'vue'

const count = ref(0)
</script>

<style scoped>
/* 样式必须 scoped */
</style>
```

### 2. API 调用规范
- **统一封装**：所有 API 调用必须在 `frontweb/src/api/*.js` 中封装
- **禁止硬编码 URL**：不要使用 `http://localhost:3011/api/xxx`
- **必须使用相对路径**：`/api/xxx`
- **统一带 token**：使用项目封装的 axios 实例，不要裸用 `fetch`（裸 fetch 不会自动带 Authorization 头，会触发 401，参考 commit `0e4b230 fix(audio): /audio/extract 改用 axios`）

```javascript
// ✅ 正确：frontweb/src/api/user.js
import request from '@/api/request' // 项目内封装的 axios 实例

export function getUserList() {
  return request.get('/api/user/list')
}

// ❌ 错误：在组件中直接写 URL 或裸 fetch
axios.get('http://localhost:3011/api/user/list')
fetch('/api/audio/extract')
```

### 3. 状态管理
```javascript
// frontweb/src/stores/user.js
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    userInfo: null,
    role: 'user' // user | admin | super_admin
  }),
  actions: {
    async fetchUserInfo() {
      // ...
    }
  }
})
```

### 4. 目录结构
```
frontweb/src/
├── api/              # API 封装
├── components/       # 通用组件
├── views/            # 页面组件
├── stores/           # Pinia 状态管理
├── router/           # 路由配置
├── composables/      # 跨页面共享逻辑（useXxx.js）
└── assets/           # 静态资源
```

### 5. 页面布局规范

#### 返回按钮位置（强制）

**所有子页面、功能页面必须在页面右上角放置返回按钮**，便于用户快速返回。这是 miniDrama 全站一致性的硬规则，新页面**禁止**把返回按钮放在左上角或页面其它位置。

| 场景 | 返回目标 | 按钮文字 |
|------|---------|---------|
| 功能模块页面 | 首页 | 返回首页 |
| 详情页、子页面 | 上一级 | 返回 / 返回列表 |
| 弹窗内操作完成 | 关闭弹窗 | 关闭 / 完成 |

**与右上角原有按钮的关系**：右上角如已有功能按钮（如 AI 配置、继续/暂停、用户菜单等），新增返回按钮**放在最右侧**，原有按钮整体左移让位。返回按钮永远是右上角排序的第一位（最右）。

```vue
<!-- 页面头部模板（标准布局） -->
<template>
  <div class="page-container">
    <div class="page-header">
      <div class="header-left">
        <h2>页面标题</h2>
        <p class="subtitle">页面描述（可选）</p>
      </div>
      <div class="header-right">
        <el-button @click="$router.push('/')">
          <el-icon><HomeFilled /></el-icon>
          返回首页
        </el-button>
      </div>
    </div>
    <!-- 页面内容 -->
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.page-header .header-left h2 {
  margin: 0 0 8px 0;
}

.page-header .header-left .subtitle {
  margin: 0;
  color: #666;
}
</style>
```

---

## Vite 代理配置规范（强制）

**核心原则：新增后端 API 时，必须检查 `frontweb/vite.config.js` 的代理配置**

### 问题背景
本项目开发环境使用 Vite 代理转发 API 请求。**如果代理配置错误，请求会被转发到错误的服务器，导致功能异常。**

### 必须检查代理配置的场景

1. **新增后端路由**：检查新 API 路径是否被现有规则正确匹配
2. **新增静态资源目录**：如视频、图片等，需要添加代理规则
3. **修改 API 路径**：检查是否影响现有代理规则

### 修改 vite.config.js 后的提示

修改代理配置后，**必须主动提示用户重启前端服务**：

```
Vite 代理配置已修改，请重启前端服务：
cd frontweb
# 按 Ctrl+C 停止，然后重新启动
npm run dev
```

---

## 代码修改后提示重启（强制）

**修改后端代码后，必须主动提示用户是否需要重启服务**

| 修改的文件类型 | 是否需要重启 | 提示语 |
|--------------|-------------|--------|
| `backend-node/src/**/*.js` | ✅ 需要 | "后端代码已修改，请重启后端服务" |
| `backend-node/migrations/*.sql` | ✅ 需要 | "新增了 migration，重启后端时会自动执行" |
| `backend-node/configs/config.yaml` | ✅ 需要 | "配置已改，请重启后端" |
| `backend-node/prompts/**/*.txt`（如有） | ❌ 不需要 | 提示词文件实时读取，无需重启 |
| `frontweb/src/**/*.vue` | ❌ 不需要 | Vite HMR 自动热更新 |
| `frontweb/src/**/*.js` | ❌ 不需要 | Vite HMR 自动热更新 |

---

## 弹窗 / 对话框复用规范

> ⚠️ **禁止重复造轮子**：项目中已有的弹窗组件，新功能必须优先复用。新增前先 grep 是否已有同类组件。

### 通用使用规则

1. **AI 模型配置**：如项目内已有 `AiConfigDialog` 之类的统一组件，必须复用，禁止自行做下拉选择框
2. **进度展示**：长任务必须使用统一的进度弹窗（含计时、停止按钮），禁止自定义不同样式
3. **视频播放**：建议建一个全局视频播放器 store（参考 `stores/videoPlayer.js`），禁止在每个页面内嵌 `<video>` 标签各搞一套
4. **确认框**：使用 Element Plus 的 `ElMessageBox.confirm()`，禁止用浏览器原生 `confirm()`
5. **消息提示**：使用 Element Plus 的 `ElMessage.success/warning/error()`，禁止用 `alert()`

```javascript
// ✅ 正确：Element Plus 风格的确认框
import { ElMessageBox, ElMessage } from 'element-plus'

await ElMessageBox.confirm('确定删除这个分镜吗？', '提示', {
  type: 'warning',
  confirmButtonText: '删除',
  cancelButtonText: '取消'
})
ElMessage.success('删除成功')

// ❌ 错误：浏览器原生
if (confirm('确定删除？')) { ... }
alert('删除成功')
```

---

## Element Plus 常用组件

| 组件 | 用途 |
|------|------|
| `<el-button>` | 按钮 |
| `<el-card>` | 卡片 |
| `<el-dialog>` | 弹窗 |
| `<el-input>` | 输入框 |
| `<el-select>` | 下拉选择 |
| `<el-table>` | 表格 |
| `<el-progress>` | 进度条 |
| `<el-form>` + `<el-form-item>` | 表单 |
| `<el-icon>` + `@element-plus/icons-vue` | 图标 |

---

## 进度弹窗规范

**用于长时间运行的任务（如 AI 生成、视频合成、TTS 烧录），必须显示进度弹窗提升用户体验**

### 弹窗组件结构（Element Plus 版）

```vue
<el-dialog
  v-model="showProgressModal"
  :show-close="false"
  :close-on-click-modal="false"
  :close-on-press-escape="false"
  width="560px"
  custom-class="progress-dialog"
>
  <template #header>
    <div class="progress-header">
      <div class="progress-icon">✨</div>
      <div class="progress-title-group">
        <div class="progress-title">正在处理...</div>
        <div class="progress-subtitle">AI 正在为您智能处理...</div>
      </div>
    </div>
  </template>

  <div class="progress-content">
    <!-- 统计卡片（灰色背景） -->
    <div class="progress-stats">
      <div class="stat-item">
        <span class="stat-label">已完成</span>
        <span class="stat-value">{{ completedCount }} 个</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">总体进度</span>
        <span class="stat-value">{{ progressPercent }}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">已用时间</span>
        <span class="stat-value">{{ elapsedTimeText }}</span>
      </div>
    </div>

    <!-- 进度条 -->
    <el-progress
      :percentage="progressPercent"
      :stroke-width="24"
      :show-text="false"
      color="#18a058"
    />

    <!-- 提示区域 -->
    <div class="progress-tip">
      <span class="tip-icon">💡</span>
      <span class="tip-text">{{ progressMessage || '请耐心等待...' }}</span>
    </div>

    <!-- 停止按钮 -->
    <div class="progress-actions">
      <el-button type="warning" plain @click="handleStop">
        停止生成
      </el-button>
    </div>
  </div>
</el-dialog>
```

### 进度弹窗强制要求（3 项）

| 要求 | 说明 |
|------|------|
| **计时器** | 必须有"已用时间"统计卡片，实时显示秒数（格式：X 分 X 秒） |
| **停止按钮** | 必须有"停止生成"按钮，点击后中断请求、停止计时器、关闭弹窗 |
| **统计卡片** | 至少 3 个：已完成数量、总体进度 %、已用时间 |

### 必需的状态变量与计时器

```javascript
const showProgressModal = ref(false)
const completedCount = ref(0)
const totalCount = ref(0)
const progressMessage = ref('')
const elapsedSeconds = ref(0)
let progressTimer = null

const progressPercent = computed(() => {
  if (totalCount.value === 0) return 0
  return Math.round((completedCount.value / totalCount.value) * 100)
})

const elapsedTimeText = computed(() => {
  const m = Math.floor(elapsedSeconds.value / 60)
  const s = elapsedSeconds.value % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
})

function startProgressTimer() {
  elapsedSeconds.value = 0
  progressTimer = setInterval(() => { elapsedSeconds.value++ }, 1000)
}

function stopProgressTimer() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}
```

> 项目里所有「生成中」按钮 / Placeholder 已统一显示已耗时（参考 commit `f5006ab feat(ui): 所有「生成中」类前端按钮/Placeholder 显示已耗时`），新增功能时务必沿用此约定。

---

## 全局视频播放器组件（建议模式）

**用于播放视频的通用组件，支持跨页面持久化播放、可拖拽、可缩放**

### 组件架构

| 文件 | 说明 |
|------|------|
| `frontweb/src/stores/videoPlayer.js` | Pinia store，管理播放器全局状态 |
| `frontweb/src/components/VideoPlayerModal.vue` | 播放器 UI 组件，在 `App.vue` 中全局挂载 |

### 功能特性
- **跨页面持久化**：页面切换时播放器保持播放，直到用户关闭
- **可拖拽 / 可缩放**：悬浮窗口可自由移动和调整大小
- **HLS 支持**：支持 m3u8 流媒体（通过 hls.js）
- **集数切换**：上一集 / 下一集快速切换

### 使用方法

```javascript
import { useVideoPlayerStore } from '@/stores/videoPlayer'

const playerStore = useVideoPlayerStore()

playerStore.openPlayer({
  name: '剧名',
  episodes: [
    { episode: 1, url: 'https://...' },
    { episode: 2, url: 'https://...' },
  ],
  source: 'minidrama'
}, 1) // 从第1集开始播放

playerStore.playEpisode(5)
playerStore.playPrevEpisode()
playerStore.playNextEpisode()
playerStore.closePlayer()
```

---

## 启动项目

```bash
# 前端
cd frontweb && npm run dev
```

## 常见问题

- 页面空白 → 检查浏览器控制台错误
- API 调用失败 → 检查后端是否启动 / token 是否带上
- 401 → 是不是裸 fetch 没带 token，改用项目封装的 axios
- 组件报错 → 检查是否已 `import { ElXxx } from 'element-plus'`

---

## 页面导航规范

### "从哪来回哪去"原则

从 Tab 页或列表页进入详情页时，返回操作必须回到用户的来源位置（包括 tab 状态），而不是硬跳到默认页面。

**实现方式**：跳转时通过 query 参数传递来源信息，返回时读取并恢复。

```js
// 跳转时带来源参数
router.push(`/drama-detail/${row.id}?from=mylist`)

// 详情页返回时恢复来源 tab
function goBackToList() {
  const from = route.query.from
  if (from) {
    router.push({ path: '/dramas', query: { tab: from } })
  } else {
    router.push('/dramas')
  }
}

// 列表页从 query 恢复 tab 状态
const activeTab = ref(route.query.tab || 'defaultTab')
```

**注意事项**：
- 左上角返回箭头可用 `router.back()`（浏览器历史回退）
- "返回列表"按钮必须用 `router.push` + 来源参数（确保 tab 恢复）
- 所有带 Tab 的列表页进入详情页时，都应遵循此模式

---

## 移动端适配规范

> 统一断点：`@media (max-width: 767px)`，全局规则建议放在 `frontweb/src/assets/responsive.css`

### 通用布局规则

| 规则 | 说明 |
|------|------|
| **搜索框全屏宽** | 移动端 `el-input`、`el-autocomplete` 必须 `width: 100%`，不能用固定 px 宽度 |
| **筛选控件右对齐** | 筛选区域的 `el-select` 等控件用 `margin-left: auto` 右对齐 |
| **列表操作按钮右对齐** | 列表卡片内的操作按钮必须 `justify-content: flex-end` |
| **el-tabs 平均分布** | 每个 tab 等宽居中（全局 CSS 处理） |
| **el-table 横向滚动** | 移动端表格必须可横向滚动，不要强行截断 |
| **el-alert 提示可隐藏** | 说明性 tips 在移动端用 `v-if="!isMobile"` 隐藏，节省空间 |

### 组件使用

| 组件 | 移动端处理 |
|------|-----------|
| `useResponsive()`（自建 composable） | 通过 `isMobile` 控制条件渲染 |
| `el-dialog` | 全局或单独设置全屏化 |
| `el-drawer` | 移动端全屏宽 |

---

## 数据缓存与失效规范（强烈建议）

**长 TTL sessionStorage / 内存缓存遇到全局状态变化时，必须主动失效**：

- 写 sessionStorage 缓存的接口时，列出"哪些用户操作 / 后台事件会让缓存失效"——不只是设 TTL 就完事
- 父组件接收"会改变缓存数据"的事件时，调用所有相关子组件的 `invalidateCache + reload`
- 后台长跑任务（如批量生成 worker）影响多个表格时，受影响表格应订阅一个 `running` prop，运行期定期刷新
- 调试缓存陈旧 bug 时，**优先怀疑前端缓存**：浏览器 DevTools → Application → Storage 清掉 sessionStorage 重试

> 这是 adcast 在 v3 worker pool 里踩过的坑（"待扫描虚影"事故），跨项目通用。

---

更新日期：2026-05-05（基于 adcast 2026-04-07 版裁剪适配为 Element Plus）
