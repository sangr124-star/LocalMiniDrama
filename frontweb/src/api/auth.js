import request from '@/utils/request'

export const authAPI = {
  login: (username, password) => request.post('/auth/login', { username, password }),
  me: () => request.get('/auth/me'),
  changePassword: (old_password, new_password) => request.post('/auth/change-password', { old_password, new_password }),
}

export const adminAPI = {
  listUsers: () => request.get('/admin/users'),
  createUser: (payload) => request.post('/admin/users', payload),
  updateUser: (id, patch) => request.put(`/admin/users/${id}`, patch),
  resetPassword: (id, new_password) => request.post(`/admin/users/${id}/reset-password`, { new_password }),
  deleteUser: (id) => request.delete(`/admin/users/${id}`),
}
