<template>
  <el-dialog
    v-model="visible"
    title="积分不足"
    width="440px"
    :show-close="true"
    :close-on-click-modal="false"
  >
    <div style="text-align: center; padding: 8px 0;">
      <div style="font-size: 16px; color: #f56c6c; margin-bottom: 14px;">
        本次调用需要 <b>{{ data.required }}</b> 积分
      </div>
      <div style="margin-bottom: 8px; color: #303133; font-size: 15px;">
        当前余额：<b>{{ data.current_balance }}</b>
      </div>
      <div style="color: #909399; margin-bottom: 14px;">
        还差 <b style="color:#f56c6c;">{{ data.shortfall }}</b> 积分
      </div>
      <div style="background: #f4f4f5; padding: 10px; border-radius: 4px; font-size: 13px; color: #606266;">
        <div v-if="data.scope">调用场景：{{ data.scope }}</div>
        <div v-if="data.model">使用模型：{{ data.model }}</div>
      </div>
      <div style="margin-top: 14px; font-size: 13px; color: #606266;">
        {{ data.hint }}
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" @click="goCredits">查看消耗明细</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { insufficientCreditsPayload } from '@/utils/request'

const router = useRouter()
const visible = ref(false)
const data = ref({})

watch(insufficientCreditsPayload, (val) => {
  if (val) {
    data.value = val
    visible.value = true
    // 重置全局 ref，方便下次同一错误能再次触发
    setTimeout(() => { insufficientCreditsPayload.value = null }, 50)
  }
})

function goCredits() {
  visible.value = false
  router.push('/my/credits')
}
</script>
