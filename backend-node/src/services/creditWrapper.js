const creditService = require('./creditService');

/**
 * 高阶包装：把 reserve → 调用 → settle/refund 状态机封装一处
 *
 * @param {string} scope                    'text.chat' / 'image.gen' / 'video.gen' / 'tts.synth' …
 * @param {(db, log, opts) => Promise<any>} originalFn  被包装的原函数
 * @param {{
 *   estimate: (db, opts) => { estimated: number, snapshot: object },
 *   settle:   (result, snapshot) => number | null,
 * }} hooks
 *
 * 约束：
 * - originalFn 必须是 (db, log, opts) 三参签名
 * - opts.user_id 必填
 * - estimate 必须返回 { estimated, snapshot }，snapshot 至少含 service_type 和 model
 * - settle 返回 null 时按 estimated 全额结算（无对账信号）
 */
function withCredits(scope, originalFn, hooks) {
  if (typeof originalFn !== 'function') throw new Error(`withCredits(${scope}): originalFn must be function`);
  if (typeof hooks?.estimate !== 'function') throw new Error(`withCredits(${scope}): estimate required`);
  if (typeof hooks?.settle !== 'function') throw new Error(`withCredits(${scope}): settle required`);

  return async function billed(db, log, opts) {
    const userId = opts && opts.user_id;
    if (!userId) {
      const err = new Error(`withCredits(${scope}): opts.user_id is required`);
      err.code = 'USER_ID_REQUIRED';
      throw err;
    }

    let estimated = 0;
    let snapshot = {};
    try {
      const r = hooks.estimate(db, opts);
      estimated = r?.estimated || 0;
      snapshot = r?.snapshot || {};
    } catch (e) {
      if (log) log.warn('credits estimate failed, treating as 0', { scope, err: e.message });
    }

    const ledgerId = creditService.reserve(db, userId, estimated, scope, {
      service_type: snapshot.service_type,
      model: snapshot.model,
      drama_id: opts.drama_id,
      episode_id: opts.episode_id,
      scene_key: opts.scene_key,
      price_snapshot: snapshot,
    });

    if (log) log.info('credits reserve', { scope, user_id: userId, estimated, ledger_id: ledgerId });

    try {
      const result = await originalFn(db, log, opts);
      let realCost = null;
      try { realCost = hooks.settle(result, snapshot); }
      catch (e) { if (log) log.warn('credits settle hook error', { err: e.message, ledger_id: ledgerId }); }
      try { creditService.settle(db, ledgerId, realCost, snapshot); }
      catch (e) { if (log) log.error('credits settle failed', { err: e.message, ledger_id: ledgerId }); }
      if (log) log.info('credits settle', { scope, ledger_id: ledgerId, real_cost: realCost ?? estimated });
      return result;
    } catch (err) {
      try { creditService.refund(db, ledgerId, err.message || 'unknown'); }
      catch (e2) { if (log) log.error('credits refund failed', { err: e2.message, ledger_id: ledgerId }); }
      if (log) log.info('credits refunded', { scope, ledger_id: ledgerId, reason: err.message });
      throw err;
    }
  };
}

module.exports = { withCredits };
