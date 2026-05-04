<template>
  <el-button link @click="$router.push('/my/credits')" :title="`当前积分余额：${balance}`" style="font-weight: 600;">
    <span style="font-size: 16px; margin-right: 4px;">💎</span>
    <span :style="{ color: lowBalance ? '#f56c6c' : '#409eff' }">{{ balance }}</span>
  </el-button>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { creditsAPI } from '@/api/credits'
import { creditsChangedTick, insufficientCreditsPayload } from '@/utils/request'

const balance = ref(0)
const threshold = ref(1000)
const lowBalance = computed(() => balance.value < threshold.value)

async function refresh() {
  try {
    const r = await creditsAPI.getMyBalance()
    balance.value = r.balance
  } catch (_) {}
}
onMounted(refresh)
watch(creditsChangedTick, refresh)
watch(insufficientCreditsPayload, (val) => { if (val) refresh() })

defineExpose({ refresh })
</script>
