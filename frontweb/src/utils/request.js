import axios from 'axios'
import { ElMessage } from 'element-plus'

const TOKEN_KEY = 'minidrama_token'
const USER_KEY = 'minidrama_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setAuth(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch (_) { return null }
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' }
})

request.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

request.interceptors.response.use(
  (response) => {
    // blob 类型直接返回原始数据，不做 JSON 解包
    if (response.config?.responseType === 'blob') {
      return response.data
    }
    const res = response.data
    if (res.success !== false) {
      return res.data !== undefined ? res.data : res
    }
    return Promise.reject(new Error(res.error?.message || '请求失败'))
  },
  (error) => {
    // 401 / 403：清登录态并跳到登录页
    const status = error.response?.status
    if (status === 401) {
      clearAuth()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        const from = window.location.pathname + window.location.search
        window.location.href = `/login?redirect=${encodeURIComponent(from)}`
      }
    }
    // 提取后端实际错误信息（优先 API 返回的 message，而非 axios 通用 "status code 500"）
    const backendMsg = error.response?.data?.error?.message
    const msg = backendMsg || error.message || '网络错误'
    // 调用方可通过 config.silent = true 抑制错误提示（用于次要接口的 403 等场景）
    if (!error.config?.silent) ElMessage.error(msg)
    // 将真实错误信息写回 message，使组件 catch 块可直接用 e.message 获取可读内容
    if (backendMsg) error.message = backendMsg
    return Promise.reject(error)
  }
)

export default request
