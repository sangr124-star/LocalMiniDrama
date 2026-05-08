'use strict';

const path = require('path');
const crypto = require('crypto');
const imageClient = require('./imageClient');
const uploadService = require('./uploadService');

/**
 * mgate（mgate.zhiqungj.com）「素材资产库」封装 — 用于「Seedance 2.0 内容审核 + 角色锁定」
 *
 * 复用 mgateClient.postJson（HMAC-SHA256 签名），透传任一 modelgate 配置（image/video 皆可）。
 *
 * 接口路径与字段（全部为大驼峰，符合 SCZCK.md 规范）：
 *   - POST /ai_router/list_asset_groups   { Filter: { Name, GroupType:'AIGC' } }
 *   - POST /ai_router/create_asset_groups { Name, GroupType:'AIGC' }              → { Result:{ Id } }
 *   - POST /ai_router/create_assets       { GroupId, URL, AssetType:'Image', Name } → { Id: 'tk-xxx' }
 *   - POST /ai_router/get_assets          { task_id }                              → { Result:{ Id, Status, URL, Error:{Code,Message} } }
 *
 * 对外返回形态：刻意与原 jimengMaterialHubService 兼容，便于 characterLibraryService 平滑切换。
 *   { ok, data: { id, status, asset_url, url, error } } 或 { ok, error, status? }
 *
 * 状态映射（mgate Active/Processing/Failed → 项目内统一小写）：
 *   'Active'     → 'active'
 *   'Processing' → 'processing'
 *   'Failed'     → 'failed'
 *   其它/缺省    → 原值小写
 */

const mgate = require('./mgateClient');

const REVIEW_GROUP_NAME = 'minidrama_review';
const REVIEW_GROUP_DESC = 'MiniDrama Seedance 2.0 内容审核 + 角色锁定';

/** 选一条可用的 modelgate 配置：优先 image / storyboard_image，回退 video */
function pickMgateConfig(db) {
  if (!db) return null;
  const rows = db
    .prepare(
      `SELECT id, service_type, provider, api_protocol, base_url, api_key, settings, is_active, is_default, priority
         FROM ai_service_configs
         WHERE deleted_at IS NULL AND is_active = 1
           AND lower(api_protocol) = 'modelgate'
         ORDER BY
           CASE service_type
             WHEN 'image' THEN 1
             WHEN 'storyboard_image' THEN 2
             WHEN 'video' THEN 3
             ELSE 4
           END,
           is_default DESC, priority DESC, id ASC`
    )
    .all();
  return rows[0] || null;
}

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase();
}

function buildAssetUrl(assetId, status) {
  const id = String(assetId || '').trim();
  if (!id) return null;
  if (normalizeStatus(status) !== 'active') return null;
  // SCZCK 5.3：Status 为 Active 时，使用 asset://<asset_id> 拼装
  return `asset://${id}`;
}

/** 把 mgate Result 标准化为 { id, status, asset_url, url, error } */
function shapeAssetResult(result) {
  if (!result || typeof result !== 'object') return null;
  const id = result.Id || result.id || null;
  const status = normalizeStatus(result.Status || result.status);
  const url = result.URL || result.url || null;
  const errObj = result.Error || result.error || null;
  const error = errObj
    ? {
        code: errObj.Code || errObj.code || '',
        message: errObj.Message || errObj.message || '',
      }
    : null;
  return {
    id,
    status: status || 'processing',
    asset_url: buildAssetUrl(id, status),
    url,
    error,
  };
}

/**
 * 找/建审核用素材组（同一 ak 下幂等）
 * @returns {Promise<{ok:boolean, group_id?:string, error?:string}>}
 */
async function ensureReviewGroup(config, log) {
  // 1) 先 list 看有没有
  try {
    const res = await mgate.postJson(config, '/ai_router/list_asset_groups', {
      Filter: { Name: REVIEW_GROUP_NAME, GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 20,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const items = res.body?.Result?.Items || [];
      const hit = items.find((it) => String(it?.Name || '').trim() === REVIEW_GROUP_NAME);
      if (hit && hit.Id) {
        return { ok: true, group_id: hit.Id };
      }
    } else {
      log?.warn?.('[mgate-review] list_asset_groups 非 2xx，将尝试直接创建', {
        status: res.statusCode,
        body_head: (res.raw || '').slice(0, 300),
      });
    }
  } catch (e) {
    log?.warn?.('[mgate-review] list_asset_groups 异常，将尝试直接创建', { error: e.message });
  }

  // 2) 没有就 create
  try {
    const res = await mgate.postJson(config, '/ai_router/create_asset_groups', {
      Name: REVIEW_GROUP_NAME,
      Description: REVIEW_GROUP_DESC,
      GroupType: 'AIGC',
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        ok: false,
        error: `mgate create_asset_groups HTTP ${res.statusCode}: ${(res.raw || '').slice(0, 300)}`,
      };
    }
    const gid = res.body?.Result?.Id;
    if (!gid) {
      return {
        ok: false,
        error: 'mgate create_asset_groups 未返回 Result.Id: ' + (res.raw || '').slice(0, 200),
      };
    }
    return { ok: true, group_id: gid };
  } catch (e) {
    return { ok: false, error: 'mgate create_asset_groups 网络异常: ' + e.message };
  }
}

/**
 * 创建素材（异步）
 * @param {object} ctx - { config, group_id }
 * @param {object} params - { url, name }
 * @returns {Promise<{ok:boolean, task_id?:string, error?:string, status?:number}>}
 */
async function createImageAsset(ctx, params, log) {
  const { config, group_id } = ctx;
  if (!group_id) return { ok: false, error: '缺少 group_id（请先 ensureReviewGroup）' };
  const url = String(params.url || '').trim();
  if (!url) return { ok: false, error: '缺少 url' };
  const name = String(params.name || 'asset').replace(/\s+/g, '').slice(0, 64) || 'asset';
  try {
    const res = await mgate.postJson(config, '/ai_router/create_assets', {
      GroupId: group_id,
      URL: url,
      AssetType: 'Image',
      Name: name,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      log?.warn?.('[mgate-review] create_assets 非 2xx', {
        status: res.statusCode,
        body_head: (res.raw || '').slice(0, 300),
      });
      // mgate 把策略错误也走 4xx 时，尽量保留原始错误信息
      const msg =
        res.body?.error?.message ||
        res.body?.message ||
        (res.raw || '').slice(0, 300) ||
        `HTTP ${res.statusCode}`;
      return { ok: false, status: res.statusCode, error: `mgate 创建素材失败 (${res.statusCode}): ${msg}` };
    }
    const taskId = res.body?.Id || res.body?.id || res.body?.Result?.Id;
    if (!taskId) {
      return {
        ok: false,
        error: 'mgate create_assets 未返回任务 Id: ' + (res.raw || '').slice(0, 200),
      };
    }
    return { ok: true, task_id: taskId };
  } catch (e) {
    return { ok: false, error: 'mgate create_assets 网络异常: ' + e.message };
  }
}

/** 一次性查询素材状态（task_id 可查中间任务，asset_id 也可查；本项目按 task_id 流转） */
async function getAsset(config, taskId, log) {
  const id = String(taskId || '').trim();
  if (!id) return { ok: false, error: '缺少 task_id' };
  try {
    const res = await mgate.postJson(config, '/ai_router/get_assets', { task_id: id });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return {
        ok: false,
        status: res.statusCode,
        error: `mgate get_assets HTTP ${res.statusCode}: ${(res.raw || '').slice(0, 300)}`,
      };
    }
    const result = res.body?.Result || res.body;
    const shaped = shapeAssetResult(result);
    if (!shaped) {
      return { ok: false, error: 'mgate get_assets 响应缺少 Result' };
    }
    return { ok: true, data: shaped };
  } catch (e) {
    return { ok: false, error: 'mgate get_assets 网络异常: ' + e.message };
  }
}

/**
 * 轮询直到 Active / Failed / 超时
 * @param {object} options - { maxMs, intervalMs, log }
 * @returns {Promise<{ok:boolean, asset?:object, error?:string, timedOut?:boolean}>}
 */
async function pollAssetUntilSettled(config, taskId, options = {}) {
  const maxMs = options.maxMs ?? 120000;
  const intervalMs = options.intervalMs ?? 2000;
  const log = options.log;
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await getAsset(config, taskId, log);
    if (!r.ok) return { ok: false, error: r.error };
    last = r.data;
    const st = normalizeStatus(last.status);
    if (st === 'active' || st === 'failed') {
      return { ok: true, asset: last };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: true, asset: last, timedOut: true };
}

/**
 * 一站式：找/建素材组 → 创建素材 → 轮询到结案
 * 调用方只需提供：db（拿配置）+ url + name
 */
async function reviewImageEndToEnd(db, log, { url, name, maxMs, intervalMs } = {}) {
  const config = pickMgateConfig(db);
  if (!config) {
    return {
      ok: false,
      error:
        '未找到可用的 ModelGate 配置：请在「AI 配置」中新增或激活一条 api_protocol = modelgate 的配置（image/storyboard_image/video 皆可，会复用 ak/sk 鉴权）',
    };
  }
  const grp = await ensureReviewGroup(config, log);
  if (!grp.ok) return { ok: false, error: grp.error };

  const create = await createImageAsset(
    { config, group_id: grp.group_id },
    { url, name },
    log
  );
  if (!create.ok) return { ok: false, error: create.error };

  const poll = await pollAssetUntilSettled(config, create.task_id, {
    maxMs: maxMs ?? 120000,
    intervalMs: intervalMs ?? 2000,
    log,
  });
  if (!poll.ok) return { ok: false, error: poll.error };

  return {
    ok: true,
    task_id: create.task_id,
    group_id: grp.group_id,
    asset: poll.asset,
    timed_out: !!poll.timedOut,
  };
}

/**
 * 把"含 image_url + local_path 的资源 row"组装成素材库可拉取的 http(s) 公网 URL。
 * 适用对象：character / storyboard / scene / prop 任何带 image_url + local_path 的实体。
 */
function buildPublicImageUrlForHub(row, cfg) {
  const img = (row?.image_url || '').toString().trim();
  const lp = (row?.local_path || '').toString().trim();
  const baseRaw = (cfg?.storage?.base_url || '').toString().trim();
  const publicBase = baseRaw.replace(/\/$/, '');

  if (/^https?:\/\//i.test(img)) {
    return { ok: true, url: img };
  }
  if (!publicBase) {
    return {
      ok: false,
      error:
        '图片非 http(s) 直链且未配置 storage.base_url，无法组成素材库可拉取的图片 URL（请配置静态资源公网 base_url，或将图设为图床直链）',
    };
  }
  if (lp) {
    const pathPart = lp.replace(/^\/+/, '');
    return { ok: true, url: `${publicBase}/${pathPart}` };
  }
  if (img.startsWith('/')) {
    if (publicBase.endsWith('/static') && img.startsWith('/static/')) {
      return { ok: true, url: publicBase + img.slice('/static'.length) };
    }
    const m = publicBase.match(/^(https?:\/\/[^/]+)/i);
    if (m) return { ok: true, url: m[1] + img };
  }
  return {
    ok: false,
    error: '资源缺少素材库可用的图片（需 http(s) 图链或 local_path + 公网 base_url）',
  };
}

function isNonPublicMaterialHubUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  if (s.startsWith('data:')) return true;
  if (!/^https?:\/\//i.test(s)) return true;
  try {
    const { hostname } = new URL(s);
    const h = String(hostname || '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '[::1]' || h === '::1') return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    const m = /^172\.(\d+)\./.exec(h);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 16 && n <= 31) return true;
    }
  } catch (_) {
    return true;
  }
  return false;
}

function storageRootPath(cfg) {
  const raw = (cfg?.storage?.local_path || './data/storage').toString();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/**
 * 内网/相对 URL 时先经中转图床转公网（缓存幂等）。
 * @param {object} row - { id, local_path, image_url }
 * @param {string} kindPrefix - cache key 前缀，如 'sd2_char' / 'sd2_sb'
 */
async function ensurePublicRegisterImageUrlForHub(db, log, cfg, row, imageUrl, kindPrefix) {
  if (!isNonPublicMaterialHubUrl(imageUrl)) {
    return { ok: true, url: imageUrl, via: 'direct' };
  }
  const lp = (row?.local_path || '').toString().trim().replace(/^\/+/, '');
  const cacheKey = lp || `${kindPrefix}:url:${crypto.createHash('sha256').update(String(imageUrl)).digest('hex').slice(0, 48)}`;
  const cached = imageClient.getProxyCache(db, cacheKey);
  if (cached) {
    log?.info?.('[mgate-review] 使用图床缓存 URL', { row_id: row?.id, kind: kindPrefix, cache_key: cacheKey });
    return { ok: true, url: cached, via: 'cache' };
  }
  const storagePath = storageRootPath(cfg);
  const localRef = (row?.local_path || '').toString().trim() || imageUrl;
  const proxyUrl = await uploadService.uploadLocalImageToProxy(storagePath, localRef, log, `${kindPrefix}_${row?.id}`);
  if (!proxyUrl) {
    return {
      ok: false,
      error:
        '图片为本机或内网地址，已尝试上传到中转图床失败（请确认 storage.local_path 下文件存在，且 image_proxy 配置可用）',
    };
  }
  imageClient.setProxyCache(db, cacheKey, proxyUrl);
  log?.info?.('[mgate-review] 已上传图床供素材库拉取', { row_id: row?.id, kind: kindPrefix, cache_key: cacheKey });
  return { ok: true, url: proxyUrl, via: 'upload' };
}

module.exports = {
  REVIEW_GROUP_NAME,
  pickMgateConfig,
  ensureReviewGroup,
  createImageAsset,
  getAsset,
  pollAssetUntilSettled,
  reviewImageEndToEnd,
  shapeAssetResult,
  normalizeStatus,
  buildAssetUrl,
  buildPublicImageUrlForHub,
  isNonPublicMaterialHubUrl,
  ensurePublicRegisterImageUrlForHub,
};
