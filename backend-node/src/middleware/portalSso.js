const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { signToken } = require('./auth');
const userService = require('../services/userService');

const PRODUCT_TAG = 'drama';
const PUBKEY_PATH = path.join(__dirname, '..', '..', 'keys', 'portal-public.pem');

let cachedPublicKey = null;
function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  if (!fs.existsSync(PUBKEY_PATH)) {
    throw new Error(`portal-public.pem 不存在: ${PUBKEY_PATH}。请从 JZAI/backend/keys/ 拷贝过来。`);
  }
  cachedPublicKey = fs.readFileSync(PUBKEY_PATH, 'utf8');
  return cachedPublicKey;
}

function ensureConsumedTokensTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS consumed_sso_tokens (
    jti TEXT PRIMARY KEY,
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
}

function cleanupConsumedTokens(db) {
  db.prepare("DELETE FROM consumed_sso_tokens WHERE used_at < datetime('now', '-1 hour')").run();
}

function buildSsoHandler(db) {
  ensureConsumedTokensTable(db);
  cleanupConsumedTokens(db);
  setInterval(() => { try { cleanupConsumedTokens(db); } catch (_) {} }, 3600 * 1000).unref();

  return function ssoHandler(req, res) {
    const token = req.query.token;
    const redirect = (req.query.redirect && String(req.query.redirect)) || '/';
    if (!token) return res.redirect('/login?sso_error=invalid');

    let payload;
    try {
      payload = jwt.verify(token, getPublicKey(), {
        algorithms: ['RS256'],
        issuer: 'portal',
        audience: PRODUCT_TAG,
        clockTolerance: 30,
      });
    } catch (e) {
      const code = e.name === 'TokenExpiredError' ? 'expired' : 'invalid';
      return res.redirect(`/login?sso_error=${code}`);
    }

    if (!payload.jti) return res.redirect('/login?sso_error=invalid');
    try {
      db.prepare('INSERT INTO consumed_sso_tokens (jti) VALUES (?)').run(payload.jti);
    } catch (e) {
      return res.redirect('/login?sso_error=replay');
    }

    let userRow = userService.findByPortalUserId(db, payload.sub);
    if (!userRow) {
      userRow = userService.createFromPortal(db, {
        portalUserId: payload.sub,
        username: payload.username,
        displayName: payload.display_name,
        role: 'user',
      });
    }
    if (userRow.status === 'disabled') {
      return res.redirect('/login?sso_error=disabled');
    }

    const localToken = signToken({
      id: userRow.id, username: userRow.username, role: userRow.role,
    });

    const safeRedirect = redirect.startsWith('/') ? redirect : '/';
    const sep = safeRedirect.includes('?') ? '&' : '?';
    let target = `${safeRedirect}${sep}sso_token=${encodeURIComponent(localToken)}`;
    // 透传门户 origin（仅 http(s) 协议），子页面「返回」按钮借此回门户
    const portalOrigin = req.query.portal_origin && String(req.query.portal_origin);
    if (portalOrigin && /^https?:\/\//i.test(portalOrigin)) {
      target += `&portal_origin=${encodeURIComponent(portalOrigin)}`;
    }
    res.redirect(target);
  };
}

module.exports = { buildSsoHandler };
