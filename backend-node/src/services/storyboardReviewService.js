'use strict';

/**
 * 分镜图「Seedance 2.0 内容审核」— 走 mgate 素材库（与角色锁定共用同一组）
 *
 * 与 character 版的差异：分镜图没有"锁定"语义，结果只用作"通过/不通过"判定，
 * 但仍把 asset_url 落库——若同剧后续视频生成需要把分镜图作为参考图，可直接复用。
 *
 * 落库字段：storyboards.seedance2_review (TEXT JSON)
 *   { hub_provider, hub_task_id, hub_asset_id, asset_url, status, error, source_image_url, certified_image_url, certified_local_path, updated_at }
 */

const mgateAssetService = require('./mgateAssetService');

function readReviewJson(text) {
  if (!text) return null;
  try {
    return typeof text === 'string' ? JSON.parse(text) : text;
  } catch (_) {
    return null;
  }
}

/**
 * 解析分镜的"主图"图源：与前端 getSbImage 行为对齐。
 *
 * 真相：storyboards.image_url / local_path 现在多用于其它语义（甚至会写视频 mp4 路径），
 * 真正的"分镜主图"挂在 image_generations 表（按 storyboard_id），帧类型不能是 quad_grid / nine_grid。
 *
 * 取最新一条 completed + 非网格的 image_generations 记录；找不到时回退到 storyboards.image_url/local_path。
 *
 * @returns {{ id:number, storyboard_id:number, image_url:string|null, local_path:string|null, source:'image_generations'|'storyboards_fallback' }|null}
 */
function resolveStoryboardMainImage(db, storyboardId) {
  const id = Number(storyboardId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const ig = db
    .prepare(
      `SELECT id, storyboard_id, image_url, local_path, frame_type, status, created_at
         FROM image_generations
         WHERE storyboard_id = ?
           AND deleted_at IS NULL
           AND status = 'completed'
           AND (frame_type IS NULL OR frame_type NOT IN ('quad_grid','nine_grid'))
           AND (image_url IS NOT NULL OR local_path IS NOT NULL)
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
    )
    .get(id);
  if (ig) {
    return {
      id: ig.id,
      storyboard_id: ig.storyboard_id,
      image_url: ig.image_url || null,
      local_path: ig.local_path || null,
      source: 'image_generations',
    };
  }

  const sb = db
    .prepare('SELECT id, image_url, local_path FROM storyboards WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (!sb) return null;
  // 守卫：storyboards.local_path 可能是 .mp4（视频），不能当图片提交
  const lp = (sb.local_path || '').toString().trim();
  const looksLikeVideo = /\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(lp) || /\.(mp4|mov|webm|m4v|avi)(\?|$)/i.test(sb.image_url || '');
  if (looksLikeVideo) return null;
  if (!sb.image_url && !lp) return null;
  return {
    id: null,
    storyboard_id: sb.id,
    image_url: sb.image_url || null,
    local_path: lp || null,
    source: 'storyboards_fallback',
  };
}

/**
 * 单个分镜图审核
 */
async function reviewStoryboardImage(db, log, cfg, storyboardId) {
  const config = mgateAssetService.pickMgateConfig(db);
  if (!config) {
    return {
      ok: false,
      error:
        '未找到可用的 ModelGate 配置：请在「AI 配置」中新增或激活一条 api_protocol = modelgate 的配置',
    };
  }

  // 取分镜主图：与前端 getSbImage 对齐 — 优先 image_generations 最新一条 completed
  // 不能直接读 storyboards.image_url / local_path，因为那俩字段现在常被复用为视频路径
  const mainImg = resolveStoryboardMainImage(db, storyboardId);
  if (!mainImg) {
    // 还要检查 storyboard 本身是否存在以给更友好的错误
    const exists = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboardId));
    if (!exists) return { ok: false, error: 'storyboard not found' };
    return { ok: false, error: '分镜还没有可审核的图片（image_generations 中无 completed 主图记录）' };
  }
  const sbInfo = db
    .prepare('SELECT id, episode_id, seedance2_review FROM storyboards WHERE id = ? AND deleted_at IS NULL')
    .get(Number(storyboardId));

  // 把"主图记录"当成 row 喂给公共图床/URL 解析器
  const imgRow = { id: mainImg.id || sbInfo.id, image_url: mainImg.image_url, local_path: mainImg.local_path };

  const urlOut = mgateAssetService.buildPublicImageUrlForHub(imgRow, cfg);
  if (!urlOut.ok) return urlOut;
  const imageUrl = urlOut.url;
  if (String(imageUrl).startsWith('data:')) {
    return { ok: false, error: '不支持 base64 图片审核，请先使用上传或外网图链' };
  }

  const pub = await mgateAssetService.ensurePublicRegisterImageUrlForHub(db, log, cfg, imgRow, imageUrl, 'sd2_sb');
  if (!pub.ok) return pub;
  const registerImageUrl = pub.url;

  const grp = await mgateAssetService.ensureReviewGroup(config, log);
  if (!grp.ok) return { ok: false, error: grp.error };

  const assetName = `sb_${sbInfo.id}`.slice(0, 64);

  log.info('[SB审核] 提交参数', {
    storyboard_id: sbInfo.id,
    episode_id: sbInfo.episode_id,
    main_image_source: mainImg.source,
    image_generation_id: mainImg.id || null,
    image_url_picked: imgRow.image_url ? String(imgRow.image_url).slice(0, 240) : null,
    local_path_picked: imgRow.local_path || null,
    resolved_register_image_url: String(registerImageUrl).slice(0, 500),
    public_image_via: pub.via,
    mgate_group_id: grp.group_id,
  });

  const create = await mgateAssetService.createImageAsset(
    { config, group_id: grp.group_id },
    { url: registerImageUrl, name: assetName },
    log
  );
  if (!create.ok) {
    log.warn('[SB审核] mgate create_assets 失败', {
      storyboard_id: sbInfo.id,
      http_status: create.status,
      error: create.error,
    });
    return { ok: false, error: create.error };
  }

  const taskId = create.task_id;
  const now = new Date().toISOString();
  const certifiedLp = (imgRow.local_path || '').toString().trim() || null;
  const certifiedImg = (imgRow.image_url || '').toString().trim() || null;
  const basePayload = {
    hub_provider: 'mgate',
    hub_task_id: taskId,
    hub_asset_id: null,
    asset_url: null,
    status: 'processing',
    source_image_url: registerImageUrl,
    certified_local_path: certifiedLp,
    certified_image_url: certifiedImg,
    error: null,
    updated_at: now,
  };
  db.prepare('UPDATE storyboards SET seedance2_review = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(basePayload),
    now,
    Number(storyboardId)
  );

  const poll = await mgateAssetService.pollAssetUntilSettled(config, taskId, {
    maxMs: 120000,
    intervalMs: 2000,
    log,
  });
  if (!poll.ok) {
    log.warn('[SB审核] mgate pollAsset 失败', { storyboardId, taskId, error: poll.error });
    return { ok: false, error: poll.error };
  }
  const settled = poll.asset || {};
  const nextPayload = {
    ...basePayload,
    hub_asset_id: settled.id || null,
    asset_url: settled.asset_url || null,
    status: settled.status || basePayload.status,
    hub_url: settled.url || null,
    error: settled.error || null,
    poll_timed_out: !!poll.timedOut,
    updated_at: new Date().toISOString(),
  };
  db.prepare('UPDATE storyboards SET seedance2_review = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(nextPayload),
    nextPayload.updated_at,
    Number(storyboardId)
  );
  log.info('[SB审核] mgate 素材已结案', {
    storyboardId,
    task_id: taskId,
    hub_asset_id: nextPayload.hub_asset_id,
    status: nextPayload.status,
    poll_timed_out: nextPayload.poll_timed_out,
    error_code: nextPayload.error?.code || null,
  });
  return { ok: true, seedance2_review: nextPayload };
}

/**
 * 批量审核某剧下所有有图的分镜（按 drama_id），跳过已 active 的；可选 force = true 强制重审
 */
async function batchReviewStoryboardsByDrama(db, log, cfg, dramaId, opts = {}) {
  const force = !!opts.force;
  const did = Number(dramaId);
  if (!Number.isFinite(did) || did <= 0) {
    return { ok: false, error: '缺少或非法 drama_id' };
  }
  // 候选 = 该剧下「有 completed 非网格主图」的分镜（image_generations）
  // 不能用 storyboards.image_url / local_path 作为存在判定 —— 那俩字段常被复用为视频路径
  const rows = db
    .prepare(
      `SELECT DISTINCT s.id, s.episode_id, s.storyboard_number, s.seedance2_review
         FROM storyboards s
         JOIN episodes e ON e.id = s.episode_id
         JOIN image_generations ig ON ig.storyboard_id = s.id
         WHERE e.drama_id = ?
           AND s.deleted_at IS NULL
           AND ig.deleted_at IS NULL
           AND ig.status = 'completed'
           AND (ig.frame_type IS NULL OR ig.frame_type NOT IN ('quad_grid','nine_grid'))
           AND (ig.image_url IS NOT NULL OR ig.local_path IS NOT NULL)
         ORDER BY s.episode_id ASC, s.storyboard_number ASC, s.id ASC`
    )
    .all(did);

  const results = [];
  for (const row of rows) {
    const prev = readReviewJson(row.seedance2_review);
    const prevStatus = (prev?.status || '').toLowerCase();
    if (!force && prevStatus === 'active') {
      results.push({
        storyboard_id: row.id,
        episode_id: row.episode_id,
        storyboard_number: row.storyboard_number,
        status: 'active',
        skipped: true,
      });
      continue;
    }
    try {
      const r = await reviewStoryboardImage(db, log, cfg, row.id);
      if (!r.ok) {
        results.push({
          storyboard_id: row.id,
          episode_id: row.episode_id,
          storyboard_number: row.storyboard_number,
          status: 'failed',
          error: r.error,
        });
      } else {
        results.push({
          storyboard_id: row.id,
          episode_id: row.episode_id,
          storyboard_number: row.storyboard_number,
          status: r.seedance2_review?.status || 'processing',
          error: r.seedance2_review?.error?.message || null,
        });
      }
    } catch (e) {
      results.push({
        storyboard_id: row.id,
        episode_id: row.episode_id,
        storyboard_number: row.storyboard_number,
        status: 'failed',
        error: e.message,
      });
    }
  }
  return { ok: true, results };
}

module.exports = {
  reviewStoryboardImage,
  batchReviewStoryboardsByDrama,
};
