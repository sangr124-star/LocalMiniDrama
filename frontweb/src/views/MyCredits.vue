<template>
  <div class="my-credits">
    <div class="header-bar">
      <el-button link @click="$router.back()">← 返回</el-button>
      <h2 class="title">我的积分</h2>
    </div>

    <div class="balance-cards">
      <el-card>
        <div class="card-label">当前余额</div>
        <div class="card-value primary">💎 {{ balance }}</div>
      </el-card>
      <el-card>
        <div class="card-label">累计充值</div>
        <div class="card-value">{{ totalRecharged }}</div>
      </el-card>
      <el-card>
        <div class="card-label">累计消耗</div>
        <div class="card-value">{{ totalConsumed }}</div>
      </el-card>
    </div>

    <el-card class="ledger-card">
      <template #header>
        <div class="filter-row">
          <span style="font-weight: 600;">消费 / 充值流水</span>
          <el-form inline style="margin-left: auto;">
            <el-form-item>
              <el-select v-model="filter.type" placeholder="全部类型" clearable style="width: 130px;" @change="load">
                <el-option label="消耗" value="consume" />
                <el-option label="充值" value="grant" />
                <el-option label="扣减" value="deduct" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-select v-model="filter.status" placeholder="全部状态" clearable style="width: 130px;" @change="load">
                <el-option label="预扣中" value="reserved" />
                <el-option label="已结算" value="settled" />
                <el-option label="已退还" value="refunded" />
                <el-option label="完成" value="done" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button @click="load">刷新</el-button>
            </el-form-item>
          </el-form>
        </div>
      </template>

      <el-table :data="rows" border stripe v-loading="loading" empty-text="暂无流水">
        <el-table-column prop="created_at" label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="80">
          <template #default="{ row }">
            <el-tag :type="typeTagType(row.type)">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="scope" label="场景" width="160" />
        <el-table-column prop="model" label="模型" width="200" show-overflow-tooltip />
        <el-table-column label="预扣 / 实扣" width="120">
          <template #default="{ row }">
            <span v-if="row.type === 'consume'">
              <span style="color: #909399;">{{ row.estimated }}</span> /
              <b :style="{ color: row.real_cost ? '#67c23a' : '#909399' }">{{ row.real_cost }}</b>
            </span>
            <b v-else :style="{ color: row.type === 'grant' ? '#67c23a' : '#f56c6c' }">{{ row.real_cost }}</b>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
      </el-table>

      <div class="pagination">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :total="total"
          v-model:current-page="filter.page"
          :page-size="20"
          @current-change="load"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { creditsAPI } from '@/api/credits'
import { getUser } from '@/utils/request'

const balance = ref(0)
const totalRecharged = ref(0)
const totalConsumed = ref(0)
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const filter = ref({ type: '', status: '', page: 1 })

async function load() {
  loading.value = true
  try {
    const [b, l] = await Promise.all([
      creditsAPI.getMyBalance(),
      creditsAPI.getMyLedger({ ...filter.value, page_size: 20 }),
    ])
    balance.value = b.balance
    rows.value = l.rows
    total.value = l.total
    // 累计字段从本地 user 缓存读
    const u = getUser() || {}
    totalRecharged.value = u.credit_total_recharged || 0
    totalConsumed.value = u.credit_total_consumed || 0
  } finally {
    loading.value = false
  }
}

function formatTime(s) {
  if (!s) return ''
  return s.slice(0, 19).replace('T', ' ')
}
function typeLabel(t) {
  return ({ consume: '消耗', grant: '充值', deduct: '扣减' })[t] || t
}
function typeTagType(t) {
  return ({ consume: 'info', grant: 'success', deduct: 'danger' })[t] || ''
}
function statusLabel(s) {
  return ({ reserved: '预扣中', settled: '已结算', refunded: '已退还', done: '完成' })[s] || s
}
function statusTagType(s) {
  return ({ reserved: 'warning', settled: 'success', refunded: 'info', done: 'success' })[s] || ''
}

onMounted(load)
</script>

<style scoped>
.my-credits {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.header-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.title {
  margin: 0;
  font-size: 22px;
}
.balance-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.card-label {
  color: #909399;
  font-size: 13px;
  margin-bottom: 8px;
}
.card-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
}
.card-value.primary {
  color: #409eff;
}
.ledger-card {
  margin-top: 8px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pagination {
  margin-top: 16px;
  text-align: right;
}
</style>
