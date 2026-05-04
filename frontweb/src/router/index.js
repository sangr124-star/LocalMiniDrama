import { createRouter, createWebHistory } from 'vue-router'
import { getToken, getUser } from '@/utils/request'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { title: '登录', public: true }
    },
    {
      path: '/',
      name: 'list',
      component: () => import('@/views/FilmList.vue'),
      meta: { title: '项目列表' }
    },
    {
      path: '/drama/:id',
      name: 'drama-detail',
      component: () => import('@/views/DramaDetail.vue'),
      meta: { title: '剧集管理' }
    },
    {
      path: '/film/:id',
      name: 'film',
      component: () => import('@/views/FilmCreate.vue'),
      meta: { title: 'AI 视频生成' }
    },
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置', requireSuperAdmin: true }
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: () => import('@/views/UserManagement.vue'),
      meta: { title: '用户管理', requireAdminOrAbove: true }
    },
    {
      path: '/free-create',
      name: 'free-create',
      component: () => import('@/views/FreeCreate.vue'),
      meta: { title: '自由创作' }
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '媒体素材库' }
    },
    {
      path: '/my/credits',
      name: 'my-credits',
      component: () => import('@/views/MyCredits.vue'),
      meta: { title: '我的积分' }
    },
    {
      path: '/admin/credits',
      name: 'admin-credits',
      component: () => import('@/views/AdminCredits.vue'),
      meta: { title: '积分管理', requireSuperAdmin: true }
    }
  ]
})

router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - AI漫剧`
  }
  // 公共页（登录页）
  if (to.meta.public) return true
  // 强制登录
  if (!getToken()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  // 需要超级管理员的页面
  if (to.meta.requireSuperAdmin) {
    const user = getUser()
    if (!user || user.role !== 'super_admin') {
      return { path: '/' }
    }
  }
  // 需要管理员或以上的页面
  if (to.meta.requireAdminOrAbove) {
    const user = getUser()
    if (!user || !['admin', 'super_admin'].includes(user.role)) {
      return { path: '/' }
    }
  }
  return true
})

export default router
