# 测试规范

> 本文档包含单元测试、集成测试的编写规范和最佳实践。
> 基于 adcast 同名规范裁剪适配（路径换成 `backend-node` / `frontweb`，端口换成 3011）。

## 核心原则

**涉及数据解析、格式转换、正则匹配、AI 返回结构解析的功能必须先写测试。**

---

## 集成测试流程

代码迁移或功能开发完成后，**必须按顺序**执行以下测试步骤：

### 1. 前端构建测试（最重要）

```bash
cd frontweb && npm run build
```

**能发现的问题：**
- `import` 路径错误（如 `@/utils/request` vs `@/api/request`）
- 缺失的依赖文件（组件、API 模块）
- 语法错误
- 未导出的函数或组件

**为什么必须先做：**
- 开发模式（`npm run dev`）使用懒加载，只有访问到的页面才会编译
- 登录页可能正常，但其他页面的 import 错误不会暴露
- 构建会编译**所有**文件，一次性发现全部问题

### 2. 后端启动测试

```bash
cd backend-node && npm run dev
```

**检查点：**
- 服务是否正常启动（无 Error）
- 端口 3011 是否被占用（EADDRINUSE）
- migrations 是否成功执行（启动时自动跑 `backend-node/migrations/`）
- SQLite 数据库连接是否正常

### 3. 后端 API 测试

```bash
# 健康检查
curl http://localhost:3011/api/health

# 登录获取 Token
curl -X POST http://localhost:3011/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456"}'

# 带 Token 测试业务接口
curl http://localhost:3011/api/xxx \
  -H "Authorization: Bearer <token>"
```

**检查点：**
- 返回正确的 JSON 结构 `{ code, message, data }`
- 状态码符合预期
- 业务逻辑正确（特别注意：`super_admin` 切「全部」模式与普通 user 的数据隔离）

### 4. 前端运行测试

```bash
cd frontweb && npm run dev
```

在浏览器访问并测试：
- 登录流程
- 主要页面渲染
- 核心功能交互（生成漫剧、TTS、视频合成等）

---

## 必须编写单元测试的场景

| 场景 | 说明 | 示例 |
|------|------|------|
| 正则表达式解析 | 从文本中提取数据 | 解析故事题材、人物信息 |
| 数据格式转换 | JSON / 字符串 / 数组之间的转换 | 解析 AI 返回结果 |
| 多格式兼容 | 需要支持多种输入格式 | 支持 Markdown / 纯文本格式 |
| 跨模块数据传递 | 导入 / 导出功能 | 剧本导入、模板导出 |
| 复杂业务逻辑 | 涉及多个条件判断 | 权限校验、积分状态机（reserve→settle/refund） |
| 字幕 / 时间轴解析 | ASR、SRT、VTT 等 | 字幕格式互转、时间单位统一 |

---

## 测试文件规范

| 规范项 | 要求 |
|--------|------|
| 命名 | `{模块名}.test.js`，与被测试文件同目录 |
| 位置 | `backend-node/src/services/*.test.js` |
| 运行 | `node {测试文件路径}` |

---

## 测试用例编写要求

### 基本结构

```javascript
// 示例：scriptParser.test.js

// 1. 提取核心解析函数（便于测试）
function parseStoryThemes(text) {
  const match = text.match(/(?:\*\*故事题材\*\*|故事题材|【故事题材】)[：:]?\s*(.+?)(?:\n|$)/)
  if (!match) return []
  return match[1].split(/[,，、\s]+/).filter(Boolean)
}

// 2. 定义测试用例（覆盖所有预期格式）
const testCases = [
  {
    name: '测试1：Markdown格式',
    input: '**故事题材**：都市逆袭、系统',
    expected: ['都市逆袭', '系统']
  },
  {
    name: '测试2：纯文本格式',
    input: '故事题材：重生、复仇',
    expected: ['重生', '复仇']
  },
  {
    name: '测试3：中括号格式',
    input: '【故事题材】甜宠、霸总',
    expected: ['甜宠', '霸总']
  },
  {
    name: '测试4：空值',
    input: '',
    expected: []
  }
]

// 3. 运行测试并输出结果
console.log('=== 故事题材解析测试 ===\n')

let passed = 0
let failed = 0

testCases.forEach(testCase => {
  const result = parseStoryThemes(testCase.input)
  const isPass = JSON.stringify(result) === JSON.stringify(testCase.expected)

  if (isPass) {
    console.log('✅', testCase.name)
    passed++
  } else {
    console.log('❌', testCase.name)
    console.log('   输入:', testCase.input)
    console.log('   期望:', testCase.expected)
    console.log('   实际:', result)
    failed++
  }
})

console.log(`\n=== 测试结果: ${passed}/${passed + failed} 通过 ===`)

if (failed > 0) {
  process.exit(1)  // 测试失败时返回非零状态码
}
```

---

## 测试用例设计原则

### 1. 边界情况
```javascript
{ name: '边界：空字符串', input: '', expected: [] },
{ name: '边界：null 值', input: null, expected: [] },
{ name: '边界：undefined', input: undefined, expected: [] }
```

### 2. 格式变体
```javascript
{ name: '分隔符：逗号', input: '题材：A,B,C', expected: ['A', 'B', 'C'] },
{ name: '分隔符：顿号', input: '题材：A、B、C', expected: ['A', 'B', 'C'] },
{ name: '分隔符：空格', input: '题材：A B C', expected: ['A', 'B', 'C'] }
```

### 3. 真实数据
```javascript
{
  name: '真实数据：AI 返回的 Markdown 格式',
  input: `**故事题材**：都市逆袭、系统流
**核心看点**：主角重生后利用系统改变命运`,
  expected: ['都市逆袭', '系统流']
}
```

### 4. 错误输入
```javascript
{ name: '异常：格式错误', input: '这是一段没有标签的文本', expected: [] },
{ name: '异常：字段缺失', input: '**其他字段**：一些内容', expected: [] }
```

---

## 开发流程（TDD 优先）

```
1. 先写测试 → 根据需求设计测试用例
      ↓
2. 运行失败 → 确认测试框架正常工作
      ↓
3. 编写代码 → 实现功能使测试通过
      ↓
4. 重构优化 → 保持测试通过的前提下优化代码
      ↓
5. 提交代码 → 测试通过后才能认为功能完成
```

---

## 测试运行

### 单个测试
```bash
node backend-node/src/services/scriptParser.test.js
```

### 运行所有测试
```bash
# Windows PowerShell
Get-ChildItem backend-node/src -Recurse -Filter *.test.js | ForEach-Object { node $_.FullName }

# Bash / macOS / Linux
for f in backend-node/src/**/*.test.js; do node "$f"; done
```

### CI / CD 集成
```bash
node backend-node/src/services/scriptParser.test.js || exit 1
```

---

## 测试最佳实践

### 1. 测试函数独立性
```javascript
// ✅ 好：每个测试用例独立
testCases.forEach(tc => {
  const result = parseFunction(tc.input)
  // 断言
})

// ❌ 差：测试用例之间有依赖
let sharedState = {}
test1() { sharedState.data = parse(input1) }
test2() { assert(sharedState.data) }
```

### 2. 清晰的测试命名
```javascript
// ✅ 好：描述具体场景
{ name: '测试：Markdown 加粗格式的题材解析' }

// ❌ 差：模糊的命名
{ name: '测试1' }
```

### 3. 断言明确
```javascript
// ✅ 好：精确比较
const isPass = JSON.stringify(result) === JSON.stringify(expected)

// ❌ 差：模糊比较
const isPass = result.length > 0
```

### 4. 失败信息详尽
```javascript
if (!isPass) {
  console.log('❌', testCase.name)
  console.log('   输入:', JSON.stringify(testCase.input))
  console.log('   期望:', JSON.stringify(testCase.expected))
  console.log('   实际:', JSON.stringify(result))
}
```

---

## 测试检查清单

### 代码迁移后

```
[ ] frontweb 的 npm run build 构建成功
[ ] backend-node 的 npm run dev 启动成功
[ ] migrations 全部执行（看启动日志）
[ ] 核心 API 返回正确（health / login）
[ ] 浏览器登录成功
[ ] 主要页面无报错
[ ] super_admin 与 user 角色数据隔离生效
```

### 新功能开发后

```
[ ] 单元测试通过（如有）
[ ] frontweb 的 npm run build 构建成功
[ ] 相关 API 测试通过（curl + Token）
[ ] 浏览器功能测试通过
[ ] 涉及积分的功能：reserve / settle / refund 三态全跑通
[ ] 涉及 AI 调用的功能：成功 + 失败两条路径都验证
```

---

## 常见问题速查

| 错误类型 | 表现 | 解决方法 |
|---------|------|---------|
| Failed to resolve import | 浏览器红色错误覆盖层 | 检查 import 路径，创建缺失文件 |
| EADDRINUSE | 后端启动失败（3011 占用） | Windows: `netstat -ano \| findstr :3011`；杀掉旧进程 |
| 401 Unauthorized | API 返回认证失败 | 检查 Token 是否过期；前端是否裸 fetch 没带 token |
| migrations 报错 | 启动失败 | 检查 SQL 语法 / 是否重复列；考虑写 idempotent SQL |
| better-sqlite3 报错 | "was compiled against a different Node.js version" | 重新跑 `npm install`，让原生模块按当前 Node 版本编译 |

---

## 自动化测试脚本（可选）

可在项目根目录创建 `test-integration.ps1`（Windows）或 `test-integration.sh`（Linux）：

```bash
#!/bin/bash
set -e

echo "=== 1. 前端构建测试 ==="
cd frontweb && npm run build
echo "✅ 前端构建成功"

echo ""
echo "=== 2. 后端启动测试 ==="
cd ../backend-node
timeout 10 npm run dev &
sleep 5

echo ""
echo "=== 3. API 测试 ==="
curl -s http://localhost:3011/api/health | grep -q '"status":"ok"' && echo "✅ 健康检查通过"

# 清理
pkill -f "node.*src/app.js" || true

echo ""
echo "=== 全部测试通过 ==="
```

---

更新日期：2026-05-05（基于 adcast 2026-01-20 版裁剪适配）
