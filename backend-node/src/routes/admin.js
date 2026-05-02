const response = require('../response');
const userService = require('../services/userService');

function buildAdminRoutes(db, log) {
  return {
    listUsers: (req, res) => {
      try {
        response.success(res, { items: userService.listUsers(db) });
      } catch (err) {
        log.error('admin.listUsers', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    createUser: (req, res) => {
      try {
        const { username, password, nickname, role } = req.body || {};
        const user = userService.createUser(db, { username, password, nickname, role });
        response.success(res, { user });
      } catch (err) {
        log.error('admin.createUser', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    updateUser: (req, res) => {
      try {
        const id = Number(req.params.id);
        // 不允许把超级管理员降级
        if (req.body && req.body.role && req.body.role !== 'super_admin') {
          const target = userService.findById(db, id);
          if (target && target.username === 'admin') return response.badRequest(res, '不能修改超级管理员 admin 的角色');
        }
        const user = userService.updateUser(db, id, req.body || {});
        response.success(res, { user });
      } catch (err) {
        log.error('admin.updateUser', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    resetPassword: (req, res) => {
      try {
        const id = Number(req.params.id);
        const { new_password } = req.body || {};
        userService.resetPassword(db, id, new_password);
        response.success(res, { message: '密码已重置' });
      } catch (err) {
        log.error('admin.resetPassword', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    deleteUser: (req, res) => {
      try {
        const id = Number(req.params.id);
        if (Number(req.user.id) === id) return response.badRequest(res, '不能删除自己');
        userService.deleteUser(db, id);
        response.success(res, { message: '已删除' });
      } catch (err) {
        log.error('admin.deleteUser', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = buildAdminRoutes;
