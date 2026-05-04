/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、edge-tts（本地）、通用 HTTP
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/**
 * 使用火山引擎 TTS（豆包语音合成）
 * 文档：https://www.volcengine.com/docs/6561/79817
 * 协议：POST https://openspeech.bytedance.com/api/v1/tts
 *   - Authorization: "Bearer;{accessToken}"（注意是分号）
 *   - body: { app:{appid,token,cluster}, user:{uid}, audio:{voice_type,encoding,...}, request:{reqid,text,...} }
 *   - response: { code, message, data:base64 }   code===3000 success
 * miniDrama 的 ai_service_configs 字段映射：
 *   - api_key      → accessToken
 *   - settings.appid    → appid（必填，由 settings JSON 传入）
 *   - settings.cluster  → cluster（默认 volcano_tts）
 *   - default_model     → 不使用（火山 TTS 用 voice_type 做模型）
 *   - voice_id          → voice_type
 */
async function synthesizeWithVolcengine(text, voiceType, accessToken, appid, cluster, baseUrl, speed) {
  if (!accessToken) throw new Error('火山 TTS 缺少 access token（在「API Key」字段填写）');
  if (!appid) throw new Error('火山 TTS 缺少 appid（请在「声音 ID」下方的 settings JSON 中填 appid，或扩展前端添加输入框）');
  const apiUrl = (baseUrl && baseUrl.trim())
    ? baseUrl.replace(/\/+$/, '') + (baseUrl.includes('/api/v1/tts') ? '' : '/api/v1/tts')
    : 'https://openspeech.bytedance.com/api/v1/tts';
  const reqId = randomUUID();
  const body = JSON.stringify({
    app: { appid, token: accessToken, cluster: cluster || 'volcano_tts' },
    user: { uid: 'minidrama_user' },
    audio: {
      voice_type: voiceType || 'zh_female_vv_uranus_bigtts',
      encoding: 'mp3',
      speed_ratio: Number(speed) || 1.0,
      volume_ratio: 1.0,
      pitch_ratio: 1.0,
    },
    request: { reqid: reqId, text, text_type: 'plain', operation: 'query' },
  });
  return new Promise((resolve, reject) => {
    const urlObj = new URL(apiUrl);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer;${accessToken}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`火山 TTS HTTP ${res.statusCode}: ${raw.slice(0, 500)}`));
          return;
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch (_) {
          reject(new Error(`火山 TTS 返回非 JSON: ${raw.slice(0, 200)}`));
          return;
        }
        if (parsed.code !== 3000) {
          reject(new Error(`火山 TTS 失败 code=${parsed.code}: ${parsed.message || ''}`));
          return;
        }
        if (!parsed.data) { reject(new Error('火山 TTS 未返回音频数据')); return; }
        resolve(Buffer.from(parsed.data, 'base64'));
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('火山 TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, audio_url: string }}
 */
async function synthesize(db, log, opts) {
  const { text, storyboard_id, config, storage_base, voice_id, speed, user_id } = opts;
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();
  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  const provider = (ttsConfig.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
  // 外部传入的 voice_id / speed 优先（海外化场景），否则取配置值
  const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig.default_model || (Array.isArray(ttsConfig.model) ? ttsConfig.model[0] : ttsConfig.model) || '';
  const finalSpeed = speed || ttsSettings.speed || 1.0;

  // 计费：reserve；失败 refund，成功按 estimated 全额结算（TTS 无真实字符数返回）
  const creditService = require('./creditService');
  const { estimateTts } = require('./creditPricing');
  let creditLedgerId = null;
  if (user_id) {
    const est = estimateTts(db, { model: ttsModel, text });
    creditLedgerId = creditService.reserve(db, user_id, est.estimated, 'tts.synth', {
      service_type: 'tts',
      model: ttsModel,
      price_snapshot: est.snapshot,
    });
    if (log) log.info('credits reserve', { scope: 'tts.synth', user_id, estimated: est.estimated, ledger_id: creditLedgerId });
  } else if (log) {
    log.warn('[credits] tts.synth called without user_id, skipping billing', { model: ttsModel });
  }

  let audioBuffer;

  try {

  if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'volcengine' || provider === 'volces' || provider === 'volc' || provider === 'volcengine_tts') {
    const appid = ttsSettings.appid || ttsSettings.app_id || ttsConfig.app_id || '';
    const cluster = ttsSettings.cluster || 'volcano_tts';
    audioBuffer = await synthesizeWithVolcengine(
      text,
      voiceId || 'zh_female_vv_uranus_bigtts',
      ttsConfig.api_key,
      appid,
      cluster,
      ttsConfig.base_url,
      finalSpeed
    );
  } else if (provider === 'openai' || ttsConfig.base_url) {
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax、volcengine`);
  }

  // 保存到本地
  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const filename = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  if (creditLedgerId) {
    try {
      creditService.settle(db, creditLedgerId, null, null);
      if (log) log.info('credits settle', { scope: 'tts.synth', ledger_id: creditLedgerId });
    } catch (e) { if (log) log.error('credits settle failed', { err: e.message, ledger_id: creditLedgerId }); }
  }
  return { local_path: localPath };

  } catch (err) {
    if (creditLedgerId) {
      try { creditService.refund(db, creditLedgerId, err.message || 'unknown'); }
      catch (e2) { if (log) log.error('credits refund failed', { err: e2.message, ledger_id: creditLedgerId }); }
      if (log) log.info('credits refunded', { scope: 'tts.synth', ledger_id: creditLedgerId, reason: err.message });
    }
    throw err;
  }
}

module.exports = { synthesize };
