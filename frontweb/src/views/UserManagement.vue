<template>
  <div class="user-mgmt">
    <div class="header">
      <h2>用户管理</h2>
      <div class="header-actions">
        <el-button type="primary" @click="openCreate">新建用户</el-button>
        <el-button @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回首页
        </el-button>
      </div>
    </div>

    <el-table :data="users" v-loading="loading" border stripe style="width: 100%">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="username" label="用户名" width="160" />
      <el-table-column prop="nickname" label="昵称" width="160" />
      <el-table-column label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="roleTagType(row.role)">{{ roleLabel(row.role) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'warning'">
            {{ row.status === 'active' ? '正常' : '已禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="积分余额" width="120">
        <template #default="{ row }">
          <span style="font-weight: 600; color: #409eff;">💎 {{ row.credit_balance ?? 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180">
        <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" min-width="380">
        <template #default="{ row }">
          <template v-if="canActOn(row)">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" @click="openReset(row)">重置密码</el-button>
            <el-button size="small" type="success" @click="openGrant(row)">充值</el-button>
            <el-button v-if="isSuperAdmin" size="small" type="danger" @click="openDeduct(row)">扣减</el-button>
            <el-button v-if="row.username !== 'admin'" size="small" type="warning" @click="toggleStatus(row)">
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
            <el-button v-if="row.username !== 'admin' && row.id !== currentUserId" size="small" type="danger" @click="onDelete(row)">删除</el-button>
          </template>
          <span v-else class="readonly-hint">（无权操作）</span>
        </template>
      </el-table-column>
    </el-table>

    <GrantCreditsDialog ref="grantDialogRef" @updated="loadUsers" />

    <!-- 新建/编辑 -->
    <el-dialog v-model="formVisible" :title="editingId ? '编辑用户' : '新建用户'" width="460px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="!!editingId" placeholder="登录用户名（不可修改）" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" placeholder="选填" />
        </el-form-item>
        <el-form-item v-if="!editingId" label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="至少 6 位" show-password />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" :disabled="form.username === 'admin' || !isSuperAdmin" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option v-if="isSuperAdmin" label="管理员" value="admin" />
            <el-option v-if="isSuperAdmin" label="超级管理员" value="super_admin" />
          </el-select>
          <p v-if="!isSuperAdmin" style="margin: 4px 0 0; font-size: 12px; color: #71717a;">仅超级管理员可创建管理员/超级管理员</p>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="resetVisible" title="重置密码" width="420px">
      <el-form :model="resetForm" label-width="100px">
        <el-form-item label="目标用户">
          <el-tag>{{ resetForm.username }}</el-tag>
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="resetForm.new_password" type="password" placeholder="至少 6 位" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { adminAPI } from '@/api/auth'
import { getUser } from '@/utils/request'
import GrantCreditsDialog from '@/components/GrantCreditsDialog.vue'

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const users = ref([])
const formVisible = ref(false)
const resetVisible = ref(false)
const formRef = ref(null)
const editingId = ref(null)
const currentUser = getUser()
const currentUserId = currentUser?.id
const isSuperAdmin = computed(() => currentUser?.role === 'super_admin')

function roleLabel(role) {
  if (role === 'super_admin') return '超级管理员'
  if (role === 'admin') return '管理员'
  return '普通用户'
}
function roleTagType(role) {
  if (role === 'super_admin') return 'danger'
  if (role === 'admin') return 'warning'
  return 'info'
}
// admin 只能操作普通 user；super_admin 不限
function canActOn(row) {
  if (isSuperAdmin.value) return true
  return row.role === 'user'
}

const form = ref({ username: '', nickname: '', password: '', role: 'user' })
const resetForm = ref({ id: null, username: '', new_password: '' })

const formRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }, { min: 2, message: '至少 2 个字符', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }, { min: 6, message: '密码至少 6 位', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
}

async function loadUsers() {
  loading.value = true
  try {
    const r = await adminAPI.listUsers()
    users.value = r.items || []
  } catch (_) { users.value = [] } finally { loading.value = false }
}

function goHome() { router.push('/') }

function openCreate() {
  editingId.value = null
  form.value = { username: '', nickname: '', password: '', role: 'user' }
  formVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  form.value = { username: row.username, nickname: row.nickname || '', password: '', role: row.role }
  formVisible.value = true
}

async function onSave() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch (_) { return }
  saving.value = true
  try {
    if (editingId.value) {
      await adminAPI.updateUser(editingId.value, { nickname: form.value.nickname, role: form.value.role })
      ElMessage.success('已更新')
    } else {
      await adminAPI.createUser({
        username: form.value.username.trim(),
        password: form.value.password,
        nickname: form.value.nickname || null,
        role: form.value.role,
      })
      ElMessage.success('已创建')
    }
    formVisible.value = false
    await loadUsers()
  } catch (_) {} finally { saving.value = false }
}

function openReset(row) {
  resetForm.value = { id: row.id, username: row.username, new_password: '' }
  resetVisible.value = true
}

async function onReset() {
  if (!resetForm.value.new_password || resetForm.value.new_password.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  saving.value = true
  try {
    await adminAPI.resetPassword(resetForm.value.id, resetForm.value.new_password)
    ElMessage.success('已重置')
    resetVisible.value = false
  } catch (_) {} finally { saving.value = false }
}

async function toggleStatus(row) {
  const next = row.status === 'active' ? 'disabled' : 'active'
  try {
    await adminAPI.updateUser(row.id, { status: next })
    ElMessage.success(next === 'active' ? '已启用' : '已禁用')
    await loadUsers()
  } catch (_) {}
}

const grantDialogRef = ref(null)
function openGrant(row) { grantDialogRef.value?.open(row, 'grant') }
function openDeduct(row) { grantDialogRef.value?.open(row, 'deduct') }
function formatTime(s) { return s ? s.slice(0, 19).replace('T', ' ') : '' }

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.username}」？此操作不可撤销。`, '提示', { type: 'warning' })
  } catch (_) { return }
  try {
    await adminAPI.deleteUser(row.id)
    ElMessage.success('已删除')
    await loadUsers()
  } catch (_) {}
}

onMounted(loadUsers)
</script>

<style scoped>
.user-mgmt {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.header h2 {
  margin: 0;
}
.header .header-actions {
  display: flex;
  gap: 8px;
}
</style>
