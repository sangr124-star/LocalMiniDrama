const response = require('../response');
const userService = require('../services/userService');
const { signToken } = require('../middleware/auth');

function buildAuthRoutes(db, log) {
  return {
    login: (req, res) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) return response.badRequest(res, '用户名和密码不能为空');
        const row = userService.findByUsername(db, username);
        if (!row) return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } });
        if (row.status === 'disabled') return res.status(403).json({ success: false, error: { code: 'USER_DISABLED', message: '账号已禁用' } });
        if (!userService.verifyPassword(password, row.password)) {
          return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } });
        }
        const user = userService.rowToUser(row);
        const token = signToken(user);
        response.success(res, { token, user });
      } catch (err) {
        log.error('auth.login', { error: err.message });
        response.internalError(res, err);
      }
    },

    me: (req, res) => {
      response.success(res, { user: req.user });
    },

    changePassword: (req, res) => {
      try {
        const { old_password, new_password } = req.body || {};
        userService.changeOwnPassword(db, req.user.id, old_password, new_password);
        response.success(res, { message: '密码已更新' });
      } catch (err) {
        log.error('auth.changePassword', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = buildAuthRoutes;
