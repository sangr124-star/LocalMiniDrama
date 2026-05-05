/**
 * Langfuse LLM observability 集成（mj 自托管 https://mjlf.aijianshou.com）
 *
 * 设计原则：
 *  - 所有 AI 调用（aiClient/imageClient/videoClient/ttsService）必须推 trace
 *  - Langfuse 失败 / 未启用时降级为 no-op，绝不阻塞业务
 *  - 标签、metadata、trace name 强制中文（adcast 经验：英文标签难辨认）
 *  - 启动 init() 一次，进程退出 shutdown() 刷队列
 *
 * 凭证来源：configs/config.yaml 的 langfuse 段（git 默认追踪空值，
 * 服务器靠 `git update-index --assume-unchanged` 保留生产凭证）
 *
 * 使用模板：
 *   const lf = require('./langfuseService');
 *   const trace = lf.createTrace({ name: '剧本生成', userId, username, metadata: { '剧目ID': id } });
 *   const gen = lf.createGeneration(trace, { name: '第1集', model, input, modelParameters });
 *   try {
 *     const result = await callAi();
 *     lf.updateGeneration(gen, { output: result.content, usage: { promptTokens, completionTokens, totalTokens } });
 *     lf.finalizeTrace(trace, { success: true, totalTokens });
 *   } catch (err) {
 *     lf.updateGeneration(gen, { level: 'ERROR', statusMessage: err.message });
 *     lf.finalizeTrace(trace, { success: false, error: err.message });
 *     throw err;
 *   }
 */
const { Langfuse } = require('langfuse');
const { loadConfig } = require('../config');

let _client = null;
let _enabled = false;

/**
 * 进程启动时调用一次。读 config.yaml 决定是否启用 Langfuse。
 * 凭证缺失或 enabled=false 时降级为 no-op，不抛错。
 */
function init() {
  if (_client) return; // 防重入
  let cfg;
  try {
    cfg = loadConfig().langfuse || {};
  } catch (e) {
    console.warn('[langfuse] 读取 config.yaml 失败，禁用追踪:', e.message);
    return;
  }
  if (!cfg.enabled) {
    console.log('[langfuse] disabled（config.yaml.langfuse.enabled=false）');
    return;
  }
  if (!cfg.secret_key || !cfg.public_key) {
    console.warn('[langfuse] enabled=true 但凭证缺失，降级为 no-op');
    return;
  }
  try {
    _client = new Langfuse({
      secretKey: cfg.secret_key,
      publicKey: cfg.public_key,
      baseUrl: cfg.host || 'https://mjlf.aijianshou.com',
      flushAt: Number(cfg.flush_at) || 15,
      flushInterval: Number(cfg.flush_interval) || 10000,
    });
    _enabled = true;
    console.log(`[langfuse] enabled, host=${cfg.host || 'https://mjlf.aijianshou.com'}`);
  } catch (e) {
    console.error('[langfuse] 初始化失败，降级为 no-op:', e.message);
    _client = null;
    _enabled = false;
  }
}

function isEnabled() {
  return _enabled;
}

/**
 * 创建一条 Trace（一次完整 AI 任务的根容器）。
 * @param {object} opts
 * @param {string} opts.name        中文 trace 名（如「剧本生成」「分镜图生成」）
 * @param {number|string} [opts.userId]
 * @param {string} [opts.username]
 * @param {string} [opts.sessionId] 跨多次调用关联的会话 id（如 dramaId）
 * @param {object} [opts.metadata]  附加业务字段（中文 key），会自动合并 username
 * @param {string[]} [opts.tags]
 * @returns {object|null} trace 句柄；未启用时返回 null
 */
function createTrace(opts) {
  if (!_enabled || !_client) return null;
  try {
    const { name, userId, username, sessionId, metadata, tags } = opts || {};
    return _client.trace({
      name: name || '未命名任务',
      userId: userId != null ? String(userId) : undefined,
      sessionId: sessionId != null ? String(sessionId) : undefined,
      metadata: {
        ...(username ? { 用户名: username } : {}),
        ...(metadata || {}),
      },
      tags: Array.isArray(tags) ? tags : undefined,
    });
  } catch (e) {
    console.warn('[langfuse] createTrace 失败:', e.message);
    return null;
  }
}

/**
 * 在 trace 下创建一个 Generation（单次 AI 调用）。
 * @param {object} trace          createTrace 返回的句柄；null 时本函数也返回 null
 * @param {object} opts
 * @param {string} opts.name      中文（如「第1集-剧本生成」）
 * @param {string} opts.model     具体模型 ID（如 doubao-seed-2-0-pro-260215），不要传厂商类型
 * @param {any} [opts.input]      推荐传 OpenAI 标准 messages 数组：[{role:'system',content:...},{role:'user',content:...}]
 *                                Langfuse 会用聊天泡泡渲染；传对象/字符串则用 JSON/纯文本视图。
 * @param {object} [opts.modelParameters]  temperature / max_tokens 等
 */
function createGeneration(trace, opts) {
  if (!_enabled || !trace) return null;
  try {
    const { name, model, input, modelParameters } = opts || {};
    return trace.generation({
      name: name || '未命名调用',
      model: model || 'unknown',
      input,
      modelParameters: modelParameters || {},
    });
  } catch (e) {
    console.warn('[langfuse] createGeneration 失败:', e.message);
    return null;
  }
}

/**
 * 结束一个 Generation。
 * @param {object} generation
 * @param {object} opts
 * @param {any} [opts.output]            推荐传字符串（模型返回文本）；非字符串会被序列化
 * @param {object} [opts.usageDetails]   OpenAI 原生 usage 直传（{prompt_tokens, completion_tokens, total_tokens}）。
 *                                       Langfuse SDK 内部识别此格式，自动渲染 token 统计。
 * @param {'ERROR'|'WARNING'|null} [opts.level]
 * @param {string} [opts.statusMessage]
 */
function updateGeneration(generation, opts) {
  if (!_enabled || !generation) return;
  try {
    const { output, usageDetails, level, statusMessage } = opts || {};
    generation.end({
      output,
      // Langfuse SDK 接受 ApiUsageDetails，可直接传 OpenAI 原生 {prompt_tokens, completion_tokens, total_tokens}
      ...(usageDetails ? { usageDetails } : {}),
      level: level || undefined,
      statusMessage: statusMessage || undefined,
    });
  } catch (e) {
    console.warn('[langfuse] updateGeneration 失败:', e.message);
  }
}

/**
 * 关闭 trace。成功 / 失败都要走，不要让 trace 悬空。
 * @param {object} trace
 * @param {object} opts
 * @param {boolean} opts.success
 * @param {any} [opts.output]      success=true 时的输出摘要
 * @param {string} [opts.error]    success=false 时的错误信息
 * @param {number} [opts.totalTokens]
 */
function finalizeTrace(trace, opts) {
  if (!_enabled || !trace) return;
  try {
    const { success, output, error, totalTokens } = opts || {};
    trace.update({
      output: success ? output : { error: error || '未知错误' },
      metadata: {
        执行结果: success ? '成功' : '失败',
        ...(totalTokens != null ? { 总Token: totalTokens } : {}),
      },
    });
  } catch (e) {
    console.warn('[langfuse] finalizeTrace 失败:', e.message);
  }
}

/**
 * 进程退出时刷新本地队列。SIGINT / SIGTERM / 正常退出都建议调一次。
 */
async function shutdown() {
  if (!_enabled || !_client) return;
  try {
    await _client.shutdownAsync();
    console.log('[langfuse] shutdown 完成');
  } catch (e) {
    console.warn('[langfuse] shutdown 失败:', e.message);
  }
}

module.exports = {
  init,
  isEnabled,
  createTrace,
  createGeneration,
  updateGeneration,
  finalizeTrace,
  shutdown,
};
