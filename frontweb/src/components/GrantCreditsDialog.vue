<template>
  <el-dialog
    v-model="visible"
    :title="`${actionLabel} - ${user?.username || ''}`"
    width="440px"
    :close-on-click-modal="false"
  >
    <el-form label-width="100px">
      <el-form-item label="目标用户">
        <el-tag>{{ user?.username }}</el-tag>
        <span style="margin-left: 8px; color: #909399; font-size: 12px;">
          当前余额 <b style="color: #409eff;">{{ user?.credit_balance ?? 0 }}</b>
        </span>
      </el-form-item>
      <el-form-item :label="`${actionLabel}金额`">
        <el-input-number v-model="amount" :min="1" :max="999999999" controls-position="right" style="width: 200px;" />
      </el-form-item>
      <el-form-item label="备注（必填）">
        <el-input v-model="note" type="textarea" :rows="3" placeholder="例如：5月活动赠送 / 客户充值 10 元" />
        <div v-if="!note.trim()" style="color:#e6a23c;font-size:12px;margin-top:4px;">
          ⚠ 请填写备注后再提交
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        :type="action === 'grant' ? 'primary' : 'danger'"
        :loading="submitting"
        @click="submit"
      >确认{{ actionLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { creditsAPI } from '@/api/credits'
import { ElMessage } from 'element-plus'

const visible = ref(false)
const user = ref(null)
const action = ref('grant')
const amount = ref(1000)
const note = ref('')
const submitting = ref(false)

const actionLabel = computed(() => action.value === 'grant' ? '充值' : '扣减')

const emit = defineEmits(['updated'])

function open(u, act = 'grant') {
  user.value = u
  action.value = act
  amount.value = 1000
  note.value = ''
  visible.value = true
}

async function submit() {
  if (!note.value.trim()) {
    ElMessage.warning('备注必填，请填写后再提交')
    return
  }
  if (amount.value <= 0) {
    ElMessage.warning('金额必须大于 0')
    return
  }
  submitting.value = true
  try {
    if (action.value === 'grant') {
      await creditsAPI.grant(user.value.id, amount.value, note.value.trim())
    } else {
      await creditsAPI.deduct(user.value.id, amount.value, note.value.trim())
    }
    ElMessage.success(`${actionLabel.value}成功`)
    visible.value = false
    emit('updated')
  } catch (e) {
    ElMessage.error(e?.response?.data?.error?.message || e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

defineExpose({ open })
</script>
