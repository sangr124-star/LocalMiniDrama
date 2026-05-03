const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'minidrama-secret-key';
const JWT_EXPIRES_IN = '7d';

function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function buildAuthMiddleware(db) {
  const userService = require('../services/userService');

  function authenticate(req, res, next) {
    let token = null;
    const header = req.headers && req.headers.authorization;
    if (header && header.startsWith('Bearer ')) token = header.slice('Bearer '.length).trim();
    if (!token && req.query && req.query.token) token = String(req.query.token);
    if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, error: { code: 'TOKEN_INVALID', message: 'Token 无效或已过期' } });
    }
    const user = userService.findById(db, decoded.userId);
    if (!user) return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: '用户不存在' } });
    if (user.status === 'disabled') return res.status(403).json({ success: false, error: { code: 'USER_DISABLED', message: '账号已禁用' } });
    req.user = userService.rowToUser(user);
    next();
  }

  return { authenticate };
}

module.exports = { buildAuthMiddleware, signToken, JWT_SECRET, JWT_EXPIRES_IN };
