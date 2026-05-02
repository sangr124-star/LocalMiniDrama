<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-title">
        <img src="/favicon.svg" alt="AI漫剧" class="login-logo" />
        <h1>AI漫剧</h1>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" @keyup.enter="onSubmit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" size="large" autofocus />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="onSubmit">登录</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authAPI } from '@/api/auth'
import { setAuth } from '@/utils/request'

const router = useRouter()
const route = useRoute()
const formRef = ref(null)
const loading = ref(false)
const form = ref({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function onSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch (_) { return }
  loading.value = true
  try {
    const { token, user } = await authAPI.login(form.value.username.trim(), form.value.password)
    setAuth(token, user)
    ElMessage.success(`欢迎，${user.nickname || user.username}`)
    const redirect = route.query.redirect ? decodeURIComponent(String(route.query.redirect)) : '/'
    router.replace(redirect.startsWith('/login') ? '/' : redirect)
  } catch (_) {
    // 拦截器已弹错
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #5a4fcf 0%, #8b5cf6 100%);
}
.login-card {
  width: 380px;
  padding: 40px 32px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
}
.login-title {
  text-align: center;
  margin-bottom: 28px;
}
.login-logo {
  width: 56px;
  height: 56px;
  display: block;
  margin: 0 auto 12px;
  filter: drop-shadow(0 6px 16px rgba(124, 92, 255, 0.4));
}
.login-title h1 {
  margin: 0;
  font-size: 22px;
  color: #2d2d2d;
}
</style>
