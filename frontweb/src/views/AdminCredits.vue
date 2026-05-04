<template>
  <div class="admin-credits">
    <div class="header-bar">
      <el-button link @click="$router.push('/')">← 返回首页</el-button>
      <h2 class="title">积分管理</h2>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- 总览 -->
      <el-tab-pane label="总览" name="stats">
        <div class="stat-grid">
          <el-card>
            <div class="stat-label">系统总余额</div>
            <div class="stat-value primary">💎 {{ stats.total_balance }}</div>
          </el-card>
          <el-card>
            <div class="stat-label">累计充值</div>
            <div class="stat-value success">{{ stats.total_recharged }}</div>
          </el-card>
          <el-card>
            <div class="stat-label">累计消耗</div>
            <div class="stat-value danger">{{ stats.total_consumed }}</div>
          </el-card>
        </div>

        <el-card style="margin-top: 16px;">
          <template #header><b>消耗 Top 10 用户</b></template>
          <el-table :data="stats.top_consumers" border stripe>
            <el-table-column prop="id" label="ID" width="60" />
            <el-table-column prop="username" label="用户名" width="180" />
            <el-table-column prop="nickname" label="昵称" width="160" />
            <el-table-column label="累计消耗">
              <template #default="{ row }">
                <b style="color: #f56c6c;">{{ row.credit_total_consumed }}</b>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 计价表 -->
      <el-tab-pane label="计价表" name="pricing">
        <el-card>
          <template #header>
            <div class="card-header">
              <b>模型计价表</b>
              <el-button size="small" type="primary" @click="addPricingDialog = true">新增计价</el-button>
            </div>
          </template>
          <el-table :data="pricing" border stripe v-loading="pricingLoading">
            <el-table-column prop="service_type" label="服务" width="100">
              <template #default="{ row }">
                <el-tag :type="serviceTagType(row.service_type)" size="small">{{ row.service_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="model" label="模型" width="220" show-overflow-tooltip />
            <el-table-column prop="unit" label="单位" width="180" />
            <el-table-column label="单价（积分）" width="160">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.price"
                  :min="0"
                  :max="9999999"
                  controls-position="right"
                  size="small"
                  @change="(p) => onPriceChange(row, p)"
                />
              </template>
            </el-table-column>
            <el-table-column label="启用" width="80">
              <template #default="{ row }">
                <el-switch v-model="row.is_active" :active-value="1" :inactive-value="0" @change="(v) => onActiveChange(row, v)" />
              </template>
            </el-table-column>
            <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button size="small" type="danger" link @click="removePricing(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 全局流水 -->
      <el-tab-pane label="全局流水" name="ledger">
        <el-card>
          <template #header>
            <el-form inline @submit.prevent="loadGlobalLedger">
              <el-form-item label="user_id">
                <el-input v-model="globalFilter.user_id" placeholder="用户 ID" clearable style="width: 140px;" />
              </el-form-item>
              <el-form-item label="类型">
                <el-select v-model="globalFilter.type" clearable placeholder="全部" style="width: 130px;">
                  <el-option label="消耗" value="consume" />
                  <el-option label="充值" value="grant" />
                  <el-option label="扣减" value="deduct" />
                </el-select>
              </el-form-item>
              <el-form-item label="状态">
                <el-select v-model="globalFilter.status" clearable placeholder="全部" style="width: 130px;">
                  <el-option label="预扣中" value="reserved" />
                  <el-option label="已结算" value="settled" />
                  <el-option label="已退还" value="refunded" />
                  <el-option label="完成" value="done" />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="loadGlobalLedger">查询</el-button>
              </el-form-item>
            </el-form>
          </template>
          <el-table :data="globalRows" border stripe v-loading="globalLoading">
            <el-table-column prop="created_at" label="时间" width="170">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column prop="user_id" label="user_id" width="80" />
            <el-table-column label="类型" width="80">
              <template #default="{ row }">
                <el-tag :type="typeTagType(row.type)" size="small">{{ typeLabel(row.type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="scope" label="场景" width="160" />
            <el-table-column prop="model" label="模型" width="200" show-overflow-tooltip />
            <el-table-column prop="estimated" label="预扣" width="80" />
            <el-table-column prop="real_cost" label="实扣" width="80" />
            <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
          </el-table>
          <el-pagination
            background
            layout="prev, pager, next, total"
            :total="globalTotal"
            v-model:current-page="globalFilter.page"
            :page-size="20"
            style="margin-top: 16px; text-align: right;"
            @current-change="loadGlobalLedger"
          />
        </el-card>
      </el-tab-pane>

      <!-- 系统设置 -->
      <el-tab-pane label="系统设置" name="settings">
        <el-card>
          <el-form label-width="240px" style="max-width: 600px;">
            <el-form-item label="新用户注册赠送积分">
              <el-input-number v-model="settings.signup_bonus" :min="0" :max="9999999" controls-position="right" style="width: 200px;" />
              <span style="margin-left: 12px; color: #909399; font-size: 12px;">role='user' 注册时自动赠送</span>
            </el-form-item>
            <el-form-item label="低余额提示阈值">
              <el-input-number v-model="settings.low_balance_threshold" :min="0" :max="9999999" controls-position="right" style="width: 200px;" />
              <span style="margin-left: 12px; color: #909399; font-size: 12px;">前端徽章余额低于此值时变红</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingSettings" @click="saveSettings">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增计价对话框 -->
    <el-dialog v-model="addPricingDialog" title="新增计价" width="460px">
      <el-form :model="newPricing" label-width="100px">
        <el-form-item label="服务类型">
          <el-select v-model="newPricing.service_type" style="width: 100%;">
            <el-option label="text 文本" value="text" />
            <el-option label="image 图片" value="image" />
            <el-option label="video 视频" value="video" />
            <el-option label="tts 语音" value="tts" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="newPricing.model" placeholder="claude-opus-4 等；'*' 为该 service_type 兜底价" />
        </el-form-item>
        <el-form-item label="计价单位">
          <el-select v-model="newPricing.unit" style="width: 100%;">
            <el-option v-for="u in unitsForType(newPricing.service_type)" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="单价（积分）">
          <el-input-number v-model="newPricing.price" :min="0" :max="9999999" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="newPricing.note" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addPricingDialog = false">取消</el-button>
        <el-button type="primary" @click="submitNewPricing">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { creditsAPI } from '@/api/credits'
import { ElMessage } from 'element-plus'

const activeTab = ref('stats')

const stats = ref({ total_balance: 0, total_recharged: 0, total_consumed: 0, top_consumers: [] })

const pricing = ref([])
const pricingLoading = ref(false)

const globalRows = ref([])
const globalTotal = ref(0)
const globalLoading = ref(false)
const globalFilter = ref({ user_id: '', type: '', status: '', page: 1 })

const settings = ref({ signup_bonus: 5000, low_balance_threshold: 1000 })
const savingSettings = ref(false)

const addPricingDialog = ref(false)
const newPricing = ref({ service_type: 'text', model: '', unit: 'per_1k_input', price: 10, note: '' })

async function loadStats() {
  stats.value = await creditsAPI.getStats()
}
async function loadPricing() {
  pricingLoading.value = true
  try {
    pricing.value = await creditsAPI.listPricing()
  } finally { pricingLoading.value = false }
}
async function loadGlobalLedger() {
  globalLoading.value = true
  try {
    const r = await creditsAPI.getGlobalLedger({ ...globalFilter.value, page_size: 20 })
    globalRows.value = r.rows
    globalTotal.value = r.total
  } finally { globalLoading.value = false }
}
async function loadSettings() {
  const r = await creditsAPI.getSettings()
  settings.value = {
    signup_bonus: Number(r['credits.signup_bonus']) || 0,
    low_balance_threshold: Number(r['credits.low_balance_threshold']) || 0,
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await creditsAPI.updateSettings({
      'credits.signup_bonus': String(settings.value.signup_bonus),
      'credits.low_balance_threshold': String(settings.value.low_balance_threshold),
    })
    ElMessage.success('已保存')
  } catch (e) { ElMessage.error(e.message || '保存失败') }
  finally { savingSettings.value = false }
}

async function onPriceChange(row, p) {
  try {
    await creditsAPI.updatePricing(row.id, { price: p })
    ElMessage.success('单价已更新')
  } catch (e) { ElMessage.error(e.message || '更新失败') }
}
async function onActiveChange(row, v) {
  try {
    await creditsAPI.updatePricing(row.id, { is_active: v })
  } catch (e) { ElMessage.error(e.message || '更新失败') }
}
async function removePricing(row) {
  try {
    await creditsAPI.deletePricing(row.id)
    ElMessage.success('已删除')
    await loadPricing()
  } catch (e) { ElMessage.error(e.message || '删除失败') }
}
async function submitNewPricing() {
  try {
    await creditsAPI.createPricing(newPricing.value)
    ElMessage.success('已添加')
    addPricingDialog.value = false
    newPricing.value = { service_type: 'text', model: '', unit: 'per_1k_input', price: 10, note: '' }
    await loadPricing()
  } catch (e) { ElMessage.error(e.message || '新增失败') }
}

function unitsForType(t) {
  if (t === 'text') return ['per_1k_input', 'per_1k_output']
  if (t === 'image') return ['per_image']
  if (t === 'video') return ['per_second']
  if (t === 'tts') return ['per_1k_chars']
  return []
}

function onTabChange(name) {
  if (name === 'pricing' && pricing.value.length === 0) loadPricing()
  if (name === 'ledger' && globalRows.value.length === 0) loadGlobalLedger()
  if (name === 'settings' && !settings.value.signup_bonus) loadSettings()
}

function formatTime(s) { return s ? s.slice(0, 19).replace('T', ' ') : '' }
function typeLabel(t) { return ({ consume: '消耗', grant: '充值', deduct: '扣减' })[t] || t }
function typeTagType(t) { return ({ consume: 'info', grant: 'success', deduct: 'danger' })[t] || '' }
function statusLabel(s) { return ({ reserved: '预扣中', settled: '已结算', refunded: '已退还', done: '完成' })[s] || s }
function statusTagType(s) { return ({ reserved: 'warning', settled: 'success', refunded: 'info', done: 'success' })[s] || '' }
function serviceTagType(s) { return ({ text: '', image: 'success', video: 'warning', tts: 'info' })[s] || '' }

onMounted(async () => {
  await Promise.all([loadStats(), loadPricing(), loadSettings()])
})
</script>

<style scoped>
.admin-credits {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}
.header-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.title { margin: 0; font-size: 22px; }
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.stat-label { color: #909399; font-size: 13px; margin-bottom: 8px; }
.stat-value { font-size: 28px; font-weight: 700; }
.stat-value.primary { color: #409eff; }
.stat-value.success { color: #67c23a; }
.stat-value.danger { color: #f56c6c; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
