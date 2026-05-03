// 资源归属守卫：每个资源解析到最终的 dramas.user_id（或顶层素材库.user_id）
// 用法：r.get('/dramas/:id', requireOwnership('drama'), handler)
//
// 规则：
//  - 资源不存在 → 404
//  - super_admin + ?scope=all → 放行（跨用户访问）
//  - user_id 匹配 → 放行
//  - 否则 → 403

const { isGlobalScope } = require('./permissions');

const RESOLVERS = {
  drama: {
    sql: 'SELECT user_id FROM dramas WHERE id = ? AND deleted_at IS NULL',
    paramName: 'id',
  },
  episode: {
    sql: 'SELECT d.user_id FROM episodes e JOIN dramas d ON d.id = e.drama_id WHERE e.id = ? AND e.deleted_at IS NULL',
    paramName: 'id',
  },
  scene: {
    sql: 'SELECT d.user_id FROM scenes s JOIN dramas d ON d.id = s.drama_id WHERE s.id = ? AND s.deleted_at IS NULL',
    paramName: 'id',
  },
  character: {
    sql: 'SELECT d.user_id FROM characters c JOIN dramas d ON d.id = c.drama_id WHERE c.id = ? AND c.deleted_at IS NULL',
    paramName: 'id',
  },
  prop: {
    sql: 'SELECT d.user_id FROM props p JOIN dramas d ON d.id = p.drama_id WHERE p.id = ? AND p.deleted_at IS NULL',
    paramName: 'id',
  },
  storyboard: {
    sql: 'SELECT d.user_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id JOIN dramas d ON d.id = e.drama_id WHERE s.id = ? AND s.deleted_at IS NULL',
    paramName: 'id',
  },
  image_generation: {
    sql: 'SELECT d.user_id FROM image_generations i JOIN dramas d ON d.id = i.drama_id WHERE i.id = ? AND i.deleted_at IS NULL',
    paramName: 'id',
  },
  video_generation: {
    sql: 'SELECT d.user_id FROM video_generations v JOIN dramas d ON d.id = v.drama_id WHERE v.id = ? AND v.deleted_at IS NULL',
    paramName: 'id',
  },
  video_merge: {
    sql: 'SELECT d.user_id FROM video_merges m JOIN dramas d ON d.id = m.drama_id WHERE m.id = ? AND m.deleted_at IS NULL',
    paramName: 'merge_id',
  },
  asset: {
    sql: 'SELECT d.user_id FROM assets a JOIN dramas d ON d.id = a.drama_id WHERE a.id = ? AND a.deleted_at IS NULL',
    paramName: 'id',
  },
  character_library: {
    sql: 'SELECT user_id FROM character_libraries WHERE id = ? AND deleted_at IS NULL',
    paramName: 'id',
  },
  scene_library: {
    sql: 'SELECT user_id FROM scene_libraries WHERE id = ? AND deleted_at IS NULL',
    paramName: 'id',
  },
  prop_library: {
    sql: 'SELECT user_id FROM prop_libraries WHERE id = ? AND deleted_at IS NULL',
    paramName: 'id',
  },
};

// drama_id 通过 URL param（如 /episodes/:episode_id 用 episode_id 反查）
const PARAM_BY_KIND = {
  drama: ['id', 'drama_id'],
  episode: ['id', 'episode_id'],
  scene: ['id', 'scene_id'],
  character: ['id', 'character_id'],
  prop: ['id', 'prop_id'],
  storyboard: ['id', 'storyboard_id'],
  image_generation: ['id', 'image_gen_id'],
  video_generation: ['id', 'video_gen_id'],
  video_merge: ['merge_id', 'id'],
  asset: ['id'],
  character_library: ['id'],
  scene_library: ['id'],
  prop_library: ['id'],
};

function resolveParamValue(req, kind) {
  const candidates = PARAM_BY_KIND[kind] || ['id'];
  for (const name of candidates) {
    const v = req.params[name];
    if (v !== undefined && v !== null && String(v).length > 0) return v;
  }
  return null;
}

function buildOwnershipMiddleware(db) {
  return function requireOwnership(kind) {
    const resolver = RESOLVERS[kind];
    if (!resolver) throw new Error(`Unknown ownership kind: ${kind}`);
    return (req, res, next) => {
      try {
        const id = resolveParamValue(req, kind);
        if (!id) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `缺少 ${kind} id 参数` } });
        const row = db.prepare(resolver.sql).get(id);
        if (!row) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
        }
        // super_admin + ?scope=all 跨用户放行
        if (isGlobalScope(req)) return next();
        if (row.user_id !== req.user.id) {
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '无权访问此资源' } });
        }
        next();
      } catch (err) {
        console.error('ownership middleware error:', err.message);
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
      }
    };
  };
}

module.exports = { buildOwnershipMiddleware, RESOLVERS };
