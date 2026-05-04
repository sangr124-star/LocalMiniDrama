const response = require('../response');
const userService = require('../services/userService');
const { isSuperAdmin } = require('../middleware/permissions');

// admin 角色只能操作普通 user；super_admin 不限
function ensureCanActOn(operator, target) {
  if (!target) return { ok: false, status: 404, message: '用户不存在' };
  if (isSuperAdmin(operator)) return { ok: true };
  // operator 是 admin
  if (target.role !== 'user') {
    return { ok: false, status: 403, message: '管理员只能操作普通用户' };
  }
  return { ok: true };
}

function buildAdminRoutes(db, log) {
  return {
    listUsers: (req, res) => {
      try {
        response.success(res, { items: userService.listUsers(db) });
      } catch (err) {
        log.error('admin.listUsers', { error: err.message });
        response.internalError(res, err);
      }
    },

    createUser: (req, res) => {
      try {
        const { username, password, nickname } = req.body || {};
        let { role } = req.body || {};
        // admin 只能创建 user；super_admin 不限
        if (!isSuperAdmin(req.user)) {
          role = 'user';
        }
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
        const target = userService.findById(db, id);
        const guard = ensureCanActOn(req.user, target ? userService.rowToUser(target) : null);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: guard.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: guard.message } });
        // 不允许把超级管理员 admin 降级
        if (req.body && req.body.role && req.body.role !== 'super_admin') {
          if (target && target.username === 'admin') return response.badRequest(res, '不能修改超级管理员 admin 的角色');
        }
        // admin 不能升级目标用户的 role（必须保持 user）
        const patch = { ...(req.body || {}) };
        if (!isSuperAdmin(req.user) && patch.role !== undefined && patch.role !== 'user') {
          return response.badRequest(res, '管理员不能修改用户角色');
        }
        const user = userService.updateUser(db, id, patch);
        response.success(res, { user });
      } catch (err) {
        log.error('admin.updateUser', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    resetPassword: (req, res) => {
      try {
        const id = Number(req.params.id);
        const target = userService.findById(db, id);
        const guard = ensureCanActOn(req.user, target ? userService.rowToUser(target) : null);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: guard.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: guard.message } });
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
        const target = userService.findById(db, id);
        const guard = ensureCanActOn(req.user, target ? userService.rowToUser(target) : null);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: guard.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: guard.message } });
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
