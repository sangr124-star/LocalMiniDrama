import request from '@/utils/request'

export const creditsAPI = {
  // 自己
  getMyBalance: () => request.get('/credits/balance'),
  getMyLedger: (params) => request.get('/credits/ledger', { params }),

  // admin / super_admin 看某用户
  getUserBalance: (id) => request.get(`/credits/users/${id}/balance`),
  getUserLedger: (id, params) => request.get(`/credits/users/${id}/ledger`, { params }),
  grant: (id, amount, note) => request.post(`/credits/users/${id}/grant`, { amount, note }),
  deduct: (id, amount, note) => request.post(`/credits/users/${id}/deduct`, { amount, note }),

  // super_admin only
  listPricing: () => request.get('/credits/pricing'),
  createPricing: (payload) => request.post('/credits/pricing', payload),
  updatePricing: (id, patch) => request.put(`/credits/pricing/${id}`, patch),
  deletePricing: (id) => request.delete(`/credits/pricing/${id}`),
  getStats: () => request.get('/credits/stats'),
  getGlobalLedger: (params) => request.get('/credits/ledger/global', { params }),
  getSettings: () => request.get('/credits/settings'),
  updateSettings: (payload) => request.put('/credits/settings', payload),
}
