// Model Gate（mgate.zhiqungj.com）协议工具：HMAC-SHA256 签名 + 通用 POST + 任务轮询
// 文档：https://docs.qq.com/doc/DREJIVEZ3SWZ3TFNP（参考用），实际接口与字段以本仓库 docs/dev-standards 为准
//
// 鉴权：
//   X-Access-Key: ak_xxx
//   X-Access-Timestamp: 秒级 Unix 时间戳（误差 5 分钟）
//   X-Access-Signature: HMAC_SHA256(secret_key, timestamp + "\n" + raw_json_body) hex
//   raw_json_body 必须与实际发送字节完全一致（签名敏感于空格/字段顺序/转义）
//
// 注意：本模块只关心通信与签名，不做业务参数构造（业务由 imageClient/videoClient 负责拼装 body）。
const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE_URL = 'https://mgate.zhiqungj.com';
const DEFAULT_TIMEOUT_MS = 600000; // 10 分钟，与图生默认超时对齐

/**
 * 计算 HMAC-SHA256 签名
 * @param {string} secretKey - sk_xxx
 * @param {string} timestamp - 秒级 unix 字符串
 * @param {string} rawBody - JSON.stringify 之后的字节，签名前后必须用同一份字符串
 * @returns {string} hex 签名
 */
function signRequest(secretKey, timestamp, rawBody) {
  const signText = `${timestamp}\n${rawBody}`;
  return crypto.createHmac('sha256', secretKey).update(signText, 'utf8').digest('hex');
}

/**
 * 调用 mgate POST 接口（自动签名 + JSON 解析）
 * @param {object} config - AI 配置：{ base_url, api_key (Access Key), settings (含 secret_key) }
 * @param {string} apiPath - 形如 '/ai_router/image_generations'
 * @param {object} payload - 请求体对象（会被 JSON.stringify）
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=DEFAULT_TIMEOUT_MS]
 * @returns {Promise<{statusCode: number, requestId: string, body: any, raw: string}>}
 */
function postJson(config, apiPath, payload, opts = {}) {
  return new Promise((resolve, reject) => {
    const accessKey = (config.api_key || '').trim();
    const secretKey = resolveSecretKey(config);
    if (!accessKey) return reject(new Error('mgate Access Key 未配置（api_key 字段）'));
    if (!secretKey) return reject(new Error('mgate Secret Key 未配置（settings.secret_key）'));

    const baseUrl = (config.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    const fullPath = apiPath.startsWith('/') ? apiPath : '/' + apiPath;
    const u = new URL(baseUrl + fullPath);
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signRequest(secretKey, timestamp, rawBody);
    const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;

    const reqOpts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Key': accessKey,
        'X-Access-Timestamp': timestamp,
        'X-Access-Signature': signature,
        'Content-Length': Buffer.byteLength(rawBody),
      },
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({
          statusCode: res.statusCode,
          requestId: res.headers['x-proxy-request-id'] || '',
          body,
          raw,
        });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`mgate 请求超时（${timeoutMs}ms）：${apiPath}`));
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

/**
 * Secret Key 来源：config.settings 是 JSON 字符串或对象，期望含 secret_key 字段
 */
function resolveSecretKey(config) {
  const raw = config.settings;
  if (raw == null || raw === '') return '';
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return ''; }
  }
  if (obj && typeof obj === 'object') {
    const sk = obj.secret_key || obj.secretKey || obj.SecretKey || '';
    return String(sk || '').trim();
  }
  return '';
}

/**
 * 通用任务轮询：每 intervalMs 调用一次 queryFn(()=>postJson(...))，直到 isDone(body) 或 isFailed(body) 或超时
 * @param {function} queryFn - 返回 Promise<{statusCode, body, raw}>
 * @param {object} hooks
 * @param {function} hooks.isDone - body => boolean，true 时立即返回 body
 * @param {function} hooks.isFailed - body => string|false，返回错误信息或 false
 * @param {function} [hooks.onTick] - (i, body) => void，可选，用于打日志
 * @param {number} [hooks.maxAttempts=120]
 * @param {number} [hooks.intervalMs=5000]
 * @returns {Promise<{ok: boolean, body?: any, error?: string}>}
 */
async function pollUntilDone(queryFn, hooks) {
  const maxAttempts = hooks.maxAttempts || 120;
  const intervalMs = hooks.intervalMs || 5000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let resp;
    try { resp = await queryFn(); }
    catch (e) { return { ok: false, error: 'mgate 查询请求异常: ' + e.message }; }
    const body = resp.body;
    if (typeof hooks.onTick === 'function') {
      try { hooks.onTick(i + 1, body, resp); } catch (_) {}
    }
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      return { ok: false, error: `mgate 查询 HTTP ${resp.statusCode}: ${(resp.raw || '').slice(0, 300)}` };
    }
    if (hooks.isDone(body)) return { ok: true, body };
    const failMsg = hooks.isFailed(body);
    if (failMsg) return { ok: false, error: failMsg };
  }
  return { ok: false, error: `mgate 任务轮询超时（${maxAttempts}× ${intervalMs}ms）` };
}

module.exports = {
  DEFAULT_BASE_URL,
  signRequest,
  postJson,
  pollUntilDone,
  resolveSecretKey,
};
