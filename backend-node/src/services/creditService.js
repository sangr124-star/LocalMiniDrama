const { InsufficientCreditsError } = require('../errors/InsufficientCreditsError');

function nowIso() { return new Date().toISOString(); }

function getBalance(db, userId) {
  if (!userId) return 0;
  const row = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
  return row ? row.credit_balance : 0;
}

// 预扣：原子事务内校验 + 扣余额 + 写 reserved 流水。返回 ledgerId
function reserve(db, userId, amount, scope, biz = {}) {
  if (!userId) throw new Error('reserve: userId required');
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  if (amount === 0) {
    // 0 积分调用（计价漏配）：仍写一条流水方便审计，但不动余额
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, service_type, model, estimated, real_cost,
       price_snapshot, drama_id, episode_id, scene_key, created_at, updated_at)
      VALUES (?, 'consume', 'reserved', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(userId), scope || null,
      biz.service_type || null, biz.model || null,
      JSON.stringify(biz.price_snapshot || {}),
      biz.drama_id || null, biz.episode_id || null, biz.scene_key || null,
      now, now,
    );
    return info.lastInsertRowid;
  }
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new Error(`User ${userId} not found`);
    if (u.credit_balance < amount) {
      throw new InsufficientCreditsError({
        required: amount,
        balance: u.credit_balance,
        scope,
        service_type: biz.service_type,
        model: biz.model,
      });
    }
    const now = nowIso();
    db.prepare('UPDATE users SET credit_balance = credit_balance - ?, updated_at=? WHERE id=?')
      .run(amount, now, Number(userId));
    const info = db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, service_type, model, estimated, real_cost,
       price_snapshot, drama_id, episode_id, scene_key, created_at, updated_at)
      VALUES (?, 'consume', 'reserved', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(userId), scope || null,
      biz.service_type || null, biz.model || null,
      amount,
      JSON.stringify(biz.price_snapshot || {}),
      biz.drama_id || null, biz.episode_id || null, biz.scene_key || null,
      now, now,
    );
    return info.lastInsertRowid;
  });
  return tx();
}

// 结算：realCost == null 时按 estimated 全额结算
function settle(db, ledgerId, realCost, snapshot) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM credit_ledger WHERE id=?').get(Number(ledgerId));
    if (!row) throw new Error(`ledger ${ledgerId} not found`);
    if (row.status !== 'reserved') return; // 幂等
    const finalCost = realCost == null
      ? row.estimated
      : Math.max(0, Math.ceil(Number(realCost)));
    const delta = row.estimated - finalCost; // >0 退还，<0 补扣
    const now = nowIso();
    if (delta !== 0) {
      db.prepare('UPDATE users SET credit_balance = credit_balance + ?, updated_at=? WHERE id=?')
        .run(delta, now, Number(row.user_id));
    }
    db.prepare('UPDATE users SET credit_total_consumed = credit_total_consumed + ? WHERE id=?')
      .run(finalCost, Number(row.user_id));
    db.prepare(`
      UPDATE credit_ledger
         SET status='settled', real_cost=?, price_snapshot=?, updated_at=?
       WHERE id=?
    `).run(
      finalCost,
      snapshot ? JSON.stringify(snapshot) : row.price_snapshot,
      now, Number(ledgerId),
    );
  });
  tx();
}

// 退款：reserved → refunded，全额回滚
function refund(db, ledgerId, reason) {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM credit_ledger WHERE id=?').get(Number(ledgerId));
    if (!row) return;
    if (row.status !== 'reserved') return; // 幂等
    const now = nowIso();
    if (row.estimated > 0) {
      db.prepare('UPDATE users SET credit_balance = credit_balance + ?, updated_at=? WHERE id=?')
        .run(row.estimated, now, Number(row.user_id));
    }
    db.prepare(`
      UPDATE credit_ledger SET status='refunded', error=?, updated_at=? WHERE id=?
    `).run(String(reason || '').slice(0, 500), now, Number(ledgerId));
  });
  tx();
}

// 充值（grant）：管理员/系统给用户加积分
function grant(db, userId, amount, operatorId, note, scope = 'admin.grant') {
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  if (amount <= 0) throw new Error('grant amount must be > 0');
  if (!note || !String(note).trim()) throw new Error('grant note is required');
  const tx = db.transaction(() => {
    const now = nowIso();
    db.prepare(`
      UPDATE users
         SET credit_balance = credit_balance + ?,
             credit_total_recharged = credit_total_recharged + ?,
             updated_at=?
       WHERE id=?
    `).run(amount, amount, now, Number(userId));
    db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, estimated, real_cost, operator_id, note, created_at, updated_at)
      VALUES (?, 'grant', 'done', ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(userId), scope, amount, amount, operatorId || null, String(note).trim(), now, now);
  });
  tx();
}

// 扣减（deduct）：super_admin 行政扣减；扣到 0 为止
function deduct(db, userId, amount, operatorId, note) {
  amount = Math.max(0, Math.ceil(Number(amount) || 0));
  if (amount <= 0) throw new Error('deduct amount must be > 0');
  if (!note || !String(note).trim()) throw new Error('deduct note is required');
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT credit_balance FROM users WHERE id=?').get(Number(userId));
    if (!u) throw new Error(`User ${userId} not found`);
    const real = Math.min(amount, u.credit_balance);
    const now = nowIso();
    if (real > 0) {
      db.prepare('UPDATE users SET credit_balance = credit_balance - ?, updated_at=? WHERE id=?')
        .run(real, now, Number(userId));
    }
    db.prepare(`
      INSERT INTO credit_ledger
      (user_id, type, status, scope, estimated, real_cost, operator_id, note, created_at, updated_at)
      VALUES (?, 'deduct', 'done', 'admin.deduct', ?, ?, ?, ?, ?, ?)
    `).run(Number(userId), real, real, operatorId || null, String(note).trim(), now, now);
    return real;
  });
  return tx();
}

function listLedger(db, { userId, status, scope, type, page = 1, pageSize = 20 } = {}) {
  const conds = [];
  const params = [];
  if (userId) { conds.push('user_id=?'); params.push(Number(userId)); }
  if (status) { conds.push('status=?'); params.push(status); }
  if (scope) { conds.push('scope=?'); params.push(scope); }
  if (type) { conds.push('type=?'); params.push(type); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM credit_ledger ${where}`).get(...params).c;
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safeSize;
  const rows = db.prepare(`
    SELECT * FROM credit_ledger ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?
  `).all(...params, safeSize, offset);
  return { total, page: safePage, pageSize: safeSize, rows };
}

function getStats(db) {
  const sumBalance = db.prepare(`SELECT COALESCE(SUM(credit_balance),0) s FROM users WHERE deleted_at IS NULL`).get().s;
  const sumRech = db.prepare(`SELECT COALESCE(SUM(credit_total_recharged),0) s FROM users WHERE deleted_at IS NULL`).get().s;
  const sumCons = db.prepare(`SELECT COALESCE(SUM(credit_total_consumed),0) s FROM users WHERE deleted_at IS NULL`).get().s;
  const top = db.prepare(`
    SELECT id, username, nickname, credit_total_consumed
      FROM users
     WHERE deleted_at IS NULL
     ORDER BY credit_total_consumed DESC
     LIMIT 10
  `).all();
  return {
    total_balance: sumBalance,
    total_recharged: sumRech,
    total_consumed: sumCons,
    top_consumers: top,
  };
}

module.exports = {
  getBalance,
  reserve, settle, refund,
  grant, deduct,
  listLedger,
  getStats,
};
