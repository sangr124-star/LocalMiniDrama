const bcrypt = require('bcryptjs');

const HARDCODED_ADMIN = { username: 'admin', password: '123456' };
const SALT_ROUNDS = 10;

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    nickname: r.nickname || '',
    role: r.role,
    status: r.status,
    created_by: r.created_by != null ? r.created_by : null,
    credit_balance: r.credit_balance != null ? r.credit_balance : 0,
    credit_total_recharged: r.credit_total_recharged != null ? r.credit_total_recharged : 0,
    credit_total_consumed: r.credit_total_consumed != null ? r.credit_total_consumed : 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function ensureAdminUser(db, log) {
  const existing = db.prepare('SELECT id, role FROM users WHERE username = ? AND deleted_at IS NULL').get(HARDCODED_ADMIN.username);
  const now = new Date().toISOString();
  if (!existing) {
    const hash = bcrypt.hashSync(HARDCODED_ADMIN.password, SALT_ROUNDS);
    db.prepare(
      `INSERT INTO users (username, password, nickname, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'super_admin', 'active', ?, ?)`
    ).run(HARDCODED_ADMIN.username, hash, '超级管理员', now, now);
    if (log) log.info('Bootstrapped super_admin user', { username: HARDCODED_ADMIN.username });
  } else if (existing.role !== 'super_admin') {
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run('super_admin', now, existing.id);
    if (log) log.info('Promoted admin to super_admin', { id: existing.id });
  }
}

function findByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL').get(username);
}

function findById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(Number(id));
}

function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try { return bcrypt.compareSync(plain, hash); } catch (_) { return false; }
}

function listUsers(db) {
  const rows = db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id ASC').all();
  return rows.map(rowToUser);
}

const VALID_ROLES = new Set(['user', 'admin', 'super_admin']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'user';
}

function createUser(db, { username, password, nickname, role, created_by = null }) {
  if (!username || !password) throw new Error('用户名和密码不能为空');
  if (String(password).length < 6) throw new Error('密码至少 6 位');
  const exists = findByUsername(db, username);
  if (exists) throw new Error('用户名已存在');
  const hash = bcrypt.hashSync(String(password), SALT_ROUNDS);
  const now = new Date().toISOString();
  const safeRole = normalizeRole(role);
  const info = db.prepare(
    `INSERT INTO users (username, password, nickname, role, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(username, hash, nickname || null, safeRole, created_by || null, now, now);
  const newUser = rowToUser(findById(db, info.lastInsertRowid));

  // 注册赠送：仅对 role='user' 触发；从 global_settings 读金额
  if (safeRole === 'user') {
    try {
      const row = db.prepare(`SELECT value FROM global_settings WHERE key='credits.signup_bonus'`).get();
      const bonus = Math.max(0, Math.ceil(Number(row?.value) || 0));
      if (bonus > 0) {
        const creditService = require('./creditService');
        creditService.grant(db, newUser.id, bonus, created_by || newUser.id, '注册赠送', 'system.signup_bonus');
        newUser.credit_balance = bonus;
        newUser.credit_total_recharged = bonus;
      }
    } catch (e) {
      // 赠送失败不阻塞用户创建
    }
  }
  return newUser;
}

function updateUser(db, id, patch) {
  const target = findById(db, id);
  if (!target) throw new Error('用户不存在');
  const fields = [];
  const params = [];
  if (patch.nickname !== undefined) { fields.push('nickname = ?'); params.push(patch.nickname || null); }
  if (patch.role !== undefined) {
    const safeRole = normalizeRole(patch.role);
    fields.push('role = ?'); params.push(safeRole);
  }
  if (patch.status !== undefined) {
    const safeStatus = patch.status === 'disabled' ? 'disabled' : 'active';
    fields.push('status = ?'); params.push(safeStatus);
  }
  if (fields.length === 0) return rowToUser(target);
  fields.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(Number(id));
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return rowToUser(findById(db, id));
}

function resetPassword(db, id, newPassword) {
  if (!newPassword || String(newPassword).length < 6) throw new Error('密码至少 6 位');
  const target = findById(db, id);
  if (!target) throw new Error('用户不存在');
  const hash = bcrypt.hashSync(String(newPassword), SALT_ROUNDS);
  db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), Number(id));
  return true;
}

function changeOwnPassword(db, id, oldPassword, newPassword) {
  const target = findById(db, id);
  if (!target) throw new Error('用户不存在');
  if (!verifyPassword(oldPassword, target.password)) throw new Error('原密码错误');
  if (!newPassword || String(newPassword).length < 6) throw new Error('新密码至少 6 位');
  const hash = bcrypt.hashSync(String(newPassword), SALT_ROUNDS);
  db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), Number(id));
  return true;
}

function deleteUser(db, id) {
  const target = findById(db, id);
  if (!target) throw new Error('用户不存在');
  if (target.username === HARDCODED_ADMIN.username) throw new Error('不能删除超级管理员 admin');
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), Number(id));
  return true;
}

// === jz portal SSO 投影 ===
function findByPortalUserId(db, portalUserId) {
  if (!portalUserId) return null;
  return db.prepare("SELECT * FROM users WHERE portal_user_id = ? AND (deleted_at IS NULL OR deleted_at = '')").get(portalUserId);
}

function createFromPortal(db, { portalUserId, username, displayName, role }) {
  // 处理 username 撞名：本地已有同名 user 但 portal_user_id 不同（或为 null）就加后缀
  const existing = db.prepare('SELECT id, portal_user_id FROM users WHERE username = ?').get(username);
  let finalUsername = username;
  if (existing && existing.portal_user_id !== portalUserId) {
    finalUsername = `${username}_p${portalUserId}`;
  }
  // 占位密码 hash：portal 用户走 SSO 不能用本地密码登录（hash 不可被任何明文 verify 通过）
  const placeholderHash = '$2a$10$portalSsoUserNoLocalPasswordPlaceholder.HashXxxxx';
  const safeRole = role === 'super_admin' ? 'super_admin' : (role === 'admin' ? 'admin' : 'user');
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO users (username, password, nickname, role, status, portal_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(finalUsername, placeholderHash, displayName || finalUsername, safeRole, portalUserId, now, now);
  return findById(db, info.lastInsertRowid);
}

module.exports = {
  ensureAdminUser,
  findByUsername,
  findById,
  verifyPassword,
  listUsers,
  createUser,
  updateUser,
  resetPassword,
  changeOwnPassword,
  deleteUser,
  rowToUser,
  findByPortalUserId,
  createFromPortal,
};
