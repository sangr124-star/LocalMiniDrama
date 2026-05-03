// 角色权限工具：super_admin > admin > user
const ROLE_LEVELS = { super_admin: 3, admin: 2, user: 1 };

function roleLevel(role) {
  return ROLE_LEVELS[role] || 0;
}

function hasRoleAtLeast(user, level) {
  if (!user || !user.role) return false;
  return roleLevel(user.role) >= roleLevel(level);
}

function isSuperAdmin(user) {
  return !!user && user.role === 'super_admin';
}

function isAdminOrAbove(user) {
  return hasRoleAtLeast(user, 'admin');
}

function _403(res, msg) {
  return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: msg } });
}

function _401(res) {
  return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } });
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return _401(res);
  if (!isSuperAdmin(req.user)) return _403(res, '需要超级管理员权限');
  next();
}

function requireAdminOrAbove(req, res, next) {
  if (!req.user) return _401(res);
  if (!isAdminOrAbove(req.user)) return _403(res, '需要管理员或以上权限');
  next();
}

// list 接口的过滤 helper：返回 { whereClause, params }
// super_admin + ?scope=all → 不加过滤；否则限制到自己的 user_id
function buildScopeFilter(req, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  if (isSuperAdmin(req.user) && req.query && req.query.scope === 'all') {
    return { whereClause: '', params: [] };
  }
  return { whereClause: ` AND ${prefix}user_id = ?`, params: [req.user.id] };
}

// 是否当前请求是 super_admin 在「全部」模式下
function isGlobalScope(req) {
  return isSuperAdmin(req.user) && req.query && req.query.scope === 'all';
}

module.exports = {
  ROLE_LEVELS,
  roleLevel,
  hasRoleAtLeast,
  isSuperAdmin,
  isAdminOrAbove,
  requireSuperAdmin,
  requireAdminOrAbove,
  buildScopeFilter,
  isGlobalScope,
};
