const response = require('../response');
const propLibraryService = require('../services/propLibraryService');
const { isGlobalScope } = require('../middleware/permissions');

function routes(db, cfg, log) {
  return {
    list: (req, res) => {
      try {
        const query = { page: req.query.page, page_size: req.query.page_size, drama_id: req.query.drama_id, global: req.query.global, category: req.query.category, source_type: req.query.source_type, keyword: req.query.keyword };
        const userScope = { userId: req.user && req.user.id, isGlobal: isGlobalScope(req) };
        const { items, total, page, pageSize } = propLibraryService.listLibraryItems(db, query, userScope);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('prop-library list', { error: err.message });
        response.internalError(res, err);
      }
    },
    create: (req, res) => {
      try {
        const item = propLibraryService.createLibraryItem(db, log, req.body || {}, req.user.id);
        response.created(res, item);
      } catch (err) {
        log.error('prop-library create', { error: err.message });
        response.internalError(res, err);
      }
    },
    get: (req, res) => {
      try {
        const item = propLibraryService.getLibraryItem(db, req.params.id);
        if (!item) return response.notFound(res, '道具库项不存在');
        response.success(res, item);
      } catch (err) {
        log.error('prop-library get', { error: err.message });
        response.internalError(res, err);
      }
    },
    update: (req, res) => {
      try {
        const item = propLibraryService.updateLibraryItem(db, log, req.params.id, req.body || {});
        if (!item) return response.notFound(res, '道具库项不存在');
        response.success(res, item);
      } catch (err) {
        log.error('prop-library update', { error: err.message });
        response.internalError(res, err);
      }
    },
    delete: (req, res) => {
      try {
        const ok = propLibraryService.deleteLibraryItem(db, log, req.params.id);
        if (!ok) return response.notFound(res, '道具库项不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('prop-library delete', { error: err.message });
        response.internalError(res, err);
      }
    },
  };
}

module.exports = routes;
