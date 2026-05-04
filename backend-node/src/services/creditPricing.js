// 计价工具：纯函数
// 价格查询：先精确匹配 (service_type, model, unit)，未命中走 (service_type, '*', unit) 兜底
function getUnitPrice(db, service_type, model, unit) {
  if (!service_type || !unit) return 0;
  const exact = db.prepare(
    `SELECT price FROM credit_pricing WHERE service_type=? AND model=? AND unit=? AND is_active=1`
  ).get(service_type, model || '', unit);
  if (exact) return exact.price;
  const fallback = db.prepare(
    `SELECT price FROM credit_pricing WHERE service_type=? AND model='*' AND unit=? AND is_active=1`
  ).get(service_type, unit);
  return fallback ? fallback.price : 0;
}

// ---------------- TEXT ----------------
function estimateText(db, opts) {
  const model = opts.model || 'unknown';
  const promptStr = String(opts.userPrompt || '') + String(opts.systemPrompt || '');
  const promptBytes = Buffer.byteLength(promptStr, 'utf-8');
  const inputTokens = Math.ceil(promptBytes / 2);
  const outputTokens = Number(opts.max_tokens) || 4000;
  const inputPrice = getUnitPrice(db, 'text', model, 'per_1k_input');
  const outputPrice = getUnitPrice(db, 'text', model, 'per_1k_output');
  const estimated = Math.ceil((inputTokens / 1000) * inputPrice)
                  + Math.ceil((outputTokens / 1000) * outputPrice);
  return {
    estimated,
    snapshot: {
      service_type: 'text',
      model,
      input_unit_price: inputPrice,
      output_unit_price: outputPrice,
      est_input_tokens: inputTokens,
      est_output_tokens: outputTokens,
    },
  };
}
function settleText(result, snapshot) {
  if (!result || !result.usage) return null; // 让 service 按 estimated 全额结算
  const inT = Number(result.usage.prompt_tokens) || 0;
  const outT = Number(result.usage.completion_tokens) || 0;
  return Math.ceil((inT / 1000) * (snapshot.input_unit_price || 0))
       + Math.ceil((outT / 1000) * (snapshot.output_unit_price || 0));
}

// ---------------- IMAGE ----------------
function estimateImage(db, opts) {
  const model = opts.model || 'unknown';
  const n = Math.max(1, Number(opts.n) || 1);
  const price = getUnitPrice(db, 'image', model, 'per_image');
  return {
    estimated: n * price,
    snapshot: {
      service_type: 'image',
      model,
      per_image_price: price,
      est_n: n,
    },
  };
}
function settleImage(result, snapshot) {
  if (!result) return null;
  // 兼容多种返回形态：{images:[...]} / {data:[...]} / 直接数组 / 单张 {url}
  let n = null;
  if (Array.isArray(result.images)) n = result.images.length;
  else if (Array.isArray(result.data)) n = result.data.length;
  else if (Array.isArray(result)) n = result.length;
  else if (result.url || result.image_url) n = 1;
  if (n == null) return null;
  return n * (snapshot.per_image_price || 0);
}

// ---------------- VIDEO ----------------
function estimateVideo(db, opts) {
  const model = opts.model || 'unknown';
  const seconds = Math.max(1, Number(opts.duration_seconds) || Number(opts.duration) || 5);
  const price = getUnitPrice(db, 'video', model, 'per_second');
  return {
    estimated: seconds * price,
    snapshot: {
      service_type: 'video',
      model,
      per_second_price: price,
      est_seconds: seconds,
    },
  };
}
function settleVideo(result, snapshot) {
  if (!result) return null;
  const realSec = result.duration_seconds || result.duration || result.real_duration;
  if (!realSec) return null;
  return Math.ceil(Number(realSec)) * (snapshot.per_second_price || 0);
}

// ---------------- TTS ----------------
function estimateTts(db, opts) {
  const model = opts.model || 'unknown';
  const text = String(opts.text || '');
  const chars = text.length;
  const units = Math.max(1, Math.ceil(chars / 1000));
  const price = getUnitPrice(db, 'tts', model, 'per_1k_chars');
  return {
    estimated: units * price,
    snapshot: {
      service_type: 'tts',
      model,
      per_1k_chars_price: price,
      est_chars: chars,
    },
  };
}
function settleTts(result, snapshot) {
  // tts 通常无返真实字符数，按 estimated 全额结算
  return null;
}

module.exports = {
  getUnitPrice,
  estimateText, settleText,
  estimateImage, settleImage,
  estimateVideo, settleVideo,
  estimateTts, settleTts,
};
