const response = require('../response');
const creditService = require('../services/creditService');
const userService = require('../services/userService');
const { isSuperAdmin } = require('../middleware/permissions');

// admin 只能管自己创建的 user；super_admin 不限
function ensureCanManage(operator, targetId, db) {
  if (!operator) return { ok: false, status: 401, message: '未登录' };
  if (isSuperAdmin(operator)) return { ok: true };
  const target = userService.findById(db, targetId);
  if (!target) return { ok: false, status: 404, message: '用户不存在' };
  if (target.role !== 'user') return { ok: false, status: 403, message: '管理员只能操作普通用户' };
  if (target.created_by !== operator.id) return { ok: false, status: 403, message: '只能管理自己创建的用户' };
  return { ok: true };
}

function buildCreditRoutes(db, log) {
  return {
    // ──── 自己 ────
    myBalance: (req, res) => {
      try {
        response.success(res, { balance: creditService.getBalance(db, req.user.id) });
      } catch (err) {
        log.error('credits.myBalance', { error: err.message });
        response.internalError(res, err);
      }
    },
    myLedger: (req, res) => {
      try {
        const data = creditService.listLedger(db, {
          userId: req.user.id,
          status: req.query.status,
          scope: req.query.scope,
          type: req.query.type,
          page: req.query.page,
          pageSize: req.query.page_size,
        });
        response.success(res, data);
      } catch (err) {
        log.error('credits.myLedger', { error: err.message });
        response.internalError(res, err);
      }
    },

    // ──── admin/super_admin 看某用户 ────
    userBalance: (req, res) => {
      try {
        const id = Number(req.params.id);
        const guard = ensureCanManage(req.user, id, db);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: 'FORBIDDEN', message: guard.message } });
        response.success(res, { balance: creditService.getBalance(db, id) });
      } catch (err) {
        log.error('credits.userBalance', { error: err.message });
        response.internalError(res, err);
      }
    },
    userLedger: (req, res) => {
      try {
        const id = Number(req.params.id);
        const guard = ensureCanManage(req.user, id, db);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: 'FORBIDDEN', message: guard.message } });
        const data = creditService.listLedger(db, {
          userId: id,
          status: req.query.status, scope: req.query.scope, type: req.query.type,
          page: req.query.page, pageSize: req.query.page_size,
        });
        response.success(res, data);
      } catch (err) {
        log.error('credits.userLedger', { error: err.message });
        response.internalError(res, err);
      }
    },
    grant: (req, res) => {
      try {
        const id = Number(req.params.id);
        const guard = ensureCanManage(req.user, id, db);
        if (!guard.ok) return res.status(guard.status).json({ success: false, error: { code: 'FORBIDDEN', message: guard.message } });
        const amount = Number(req.body?.amount);
        const note = String(req.body?.note || '').trim();
        if (!amount || amount <= 0) return response.badRequest(res, 'amount 必须大于 0');
        if (!note) return response.badRequest(res, '备注必填');
        creditService.grant(db, id, amount, req.user.id, note);
        response.success(res, { balance: creditService.getBalance(db, id) });
      } catch (err) {
        log.error('credits.grant', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    deduct: (req, res) => {
      try {
        if (!isSuperAdmin(req.user)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '需要超级管理员权限' } });
        const id = Number(req.params.id);
        const amount = Number(req.body?.amount);
        const note = String(req.body?.note || '').trim();
        if (!amount || amount <= 0) return response.badRequest(res, 'amount 必须大于 0');
        if (!note) return response.badRequest(res, '备注必填');
        const real = creditService.deduct(db, id, amount, req.user.id, note);
        response.success(res, { deducted: real, balance: creditService.getBalance(db, id) });
      } catch (err) {
        log.error('credits.deduct', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    // ──── super_admin only ────
    listPricing: (req, res) => {
      try {
        const rows = db.prepare('SELECT * FROM credit_pricing ORDER BY service_type, model, unit').all();
        response.success(res, rows);
      } catch (err) { response.internalError(res, err); }
    },
    createPricing: (req, res) => {
      try {
        const { service_type, model, unit, price, is_active = 1, note } = req.body || {};
        if (!service_type || !model || !unit || price == null) return response.badRequest(res, '缺字段 service_type/model/unit/price');
        const now = new Date().toISOString();
        const info = db.prepare(`
          INSERT INTO credit_pricing (service_type, model, unit, price, is_active, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(service_type, model, unit, Math.ceil(price), is_active ? 1 : 0, note || null, now, now);
        response.success(res, { id: info.lastInsertRowid });
      } catch (err) {
        log.error('credits.createPricing', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    updatePricing: (req, res) => {
      try {
        const { price, is_active, note } = req.body || {};
        const fields = []; const params = [];
        if (price != null) { fields.push('price=?'); params.push(Math.ceil(price)); }
        if (is_active != null) { fields.push('is_active=?'); params.push(is_active ? 1 : 0); }
        if (note !== undefined) { fields.push('note=?'); params.push(note || null); }
        if (!fields.length) return response.success(res, {});
        fields.push('updated_at=?'); params.push(new Date().toISOString());
        params.push(Number(req.params.id));
        db.prepare(`UPDATE credit_pricing SET ${fields.join(', ')} WHERE id=?`).run(...params);
        response.success(res, {});
      } catch (err) { response.internalError(res, err); }
    },
    deletePricing: (req, res) => {
      try {
        db.prepare('DELETE FROM credit_pricing WHERE id=?').run(Number(req.params.id));
        response.success(res, {});
      } catch (err) { response.internalError(res, err); }
    },
    stats: (req, res) => {
      try { response.success(res, creditService.getStats(db)); }
      catch (err) { response.internalError(res, err); }
    },
    globalLedger: (req, res) => {
      try {
        const data = creditService.listLedger(db, {
          userId: req.query.user_id,
          status: req.query.status, scope: req.query.scope, type: req.query.type,
          page: req.query.page, pageSize: req.query.page_size,
        });
        response.success(res, data);
      } catch (err) { response.internalError(res, err); }
    },
    getSettings: (req, res) => {
      try {
        const rows = db.prepare(`SELECT key, value FROM global_settings WHERE key LIKE 'credits.%'`).all();
        const map = {};
        rows.forEach((r) => { map[r.key] = r.value; });
        response.success(res, map);
      } catch (err) { response.internalError(res, err); }
    },
    updateSettings: (req, res) => {
      try {
        const updates = req.body || {};
        const now = new Date().toISOString();
        const upd = db.prepare(`
          INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        `);
        const tx = db.transaction(() => {
          for (const [k, v] of Object.entries(updates)) {
            if (k.startsWith('credits.')) upd.run(k, String(v), now);
          }
        });
        tx();
        response.success(res, {});
      } catch (err) {
        log.error('credits.updateSettings', { error: err.message });
        response.internalError(res, err);
      }
    },
  };
}

module.exports = buildCreditRoutes;
