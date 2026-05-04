// 和 Go 端 pkg/response 保持一致，方便前端复用
function send(res, statusCode, body) {
  const payload = {
    ...body,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(payload);
}

function success(res, data) {
  send(res, 200, { success: true, data });
}

function created(res, data) {
  send(res, 201, { success: true, data });
}

function successWithPagination(res, items, total, page, pageSize) {
  const totalPages = Math.ceil(total / pageSize) || 0;
  send(res, 200, {
    success: true,
    data: {
      items,
      pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    },
  });
}

function error(res, statusCode, code, message, details) {
  send(res, statusCode, {
    success: false,
    error: { code, message, ...(details && { details }) },
  });
}

function badRequest(res, message) {
  error(res, 400, 'BAD_REQUEST', message);
}

function notFound(res, message) {
  error(res, 404, 'NOT_FOUND', message);
}

function forbidden(res, message) {
  error(res, 403, 'FORBIDDEN', message);
}

// 接受 err 对象时自动识别 INSUFFICIENT_CREDITS → 402；否则 500
function internalError(res, messageOrErr) {
  // 兼容传入 Error 对象的场景（识别积分不足）
  if (messageOrErr && typeof messageOrErr === 'object' && messageOrErr.code === 'INSUFFICIENT_CREDITS') {
    return insufficientCredits(res, messageOrErr);
  }
  const message = (messageOrErr && typeof messageOrErr === 'object')
    ? (messageOrErr.message || '服务器错误')
    : (messageOrErr || '服务器错误');
  error(res, 500, 'INTERNAL_ERROR', message);
}

function insufficientCredits(res, err) {
  send(res, 402, {
    success: false,
    error: {
      code: 'INSUFFICIENT_CREDITS',
      message: '积分不足，无法完成本次调用',
      required: err.required,
      current_balance: err.balance,
      shortfall: err.shortfall,
      scope: err.scope,
      service_type: err.service_type,
      model: err.model,
      hint: '请联系管理员充值，或在「我的积分」页查看消耗明细',
    },
  });
}

module.exports = {
  success,
  created,
  successWithPagination,
  error,
  badRequest,
  notFound,
  forbidden,
  internalError,
  insufficientCredits,
};
