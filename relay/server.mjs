import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRateLimiter } from './rate_limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATIC_ROOT = path.resolve(process.env.STATIC_ROOT || ROOT);
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
function readSecret(name) {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (!file) return '';
  try { return readFileSync(file, 'utf8').trim(); }
  catch (err) { throw new Error(`${name}_FILE could not be read: ${err.message}`); }
}
const OPENAI_API_KEY = readSecret('OPENAI_API_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6-astra';
const ALLOWED_MODELS = new Set((process.env.ALLOWED_MODELS || OPENAI_MODEL).split(',').map(s => s.trim()).filter(Boolean));
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const RELAY_BEARER_TOKEN = readSecret('RELAY_BEARER_TOKEN');
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MOCK_OPENAI = process.env.MOCK_OPENAI === '1';
const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES || 96 * 1024);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 20);
const RATE_LIMIT_BACKEND = process.env.RATE_LIMIT_BACKEND || 'memory';
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1200);
const RATE_LIMIT_FAIL_CLOSED = process.env.RATE_LIMIT_FAIL_CLOSED === '1';
const RATE_LIMIT_PREFIX = process.env.RATE_LIMIT_PREFIX || 'coach_rl';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 18_000);
const UPSTREAM_TOTAL_TIMEOUT_MS = Number(process.env.UPSTREAM_TOTAL_TIMEOUT_MS || 30_000);
const UPSTREAM_RETRY_COUNT = Math.max(0, Math.min(2, Number(process.env.UPSTREAM_RETRY_COUNT || 0)));
const MAX_CONVERSATION_TURNS = 8;
const MAX_MESSAGE_CHARS = 1600;
const MAX_CONTEXT_BYTES = 36 * 1024;

const FORBIDDEN_KEYS = new Set(['stopThreshold','resumeThreshold','trainingWeek','safetyFlag','applyDecision','setThreshold','actions']);
const FORBIDDEN_CONTEXT_KEYS = new Set(['events','rawEvents','eventStream','sessionId','sessionIds','planId','templateId','notes','revisions','revisionLog','exactTimestamp','exactTimestamps']);
const ALLOWED_RESPONSE_FIELDS = new Set(['answer','focus','evidence','uncertainty','safetyNotice']);
const rateLimiter = createRateLimiter({ backend: RATE_LIMIT_BACKEND, windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX, redisUrl: REDIS_URL, prefix: RATE_LIMIT_PREFIX, connectTimeoutMs: REDIS_CONNECT_TIMEOUT_MS, failClosed: RATE_LIMIT_FAIL_CLOSED });

function requestId() { return crypto.randomUUID(); }
function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(payload);
}
function log(event, fields = {}) {
  const clean = { at: new Date().toISOString(), event, ...fields };
  // Never log request bodies, coach context, user questions, tokens, or upstream raw output.
  process.stdout.write(JSON.stringify(clean) + '\n');
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}
function sameOrigin(req, origin) {
  try {
    const proto = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() : 'http';
    const host = req.headers.host;
    return !!host && new URL(origin).origin === `${proto}://${host}`;
  } catch { return false; }
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return sameOrigin(req, origin) || ALLOWED_ORIGINS.has(origin);
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !originAllowed(req)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
}
function timingSafeTokenEqual(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function authorized(req) {
  if (!RELAY_BEARER_TOKEN) return true;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeTokenEqual(token, RELAY_BEARER_TOKEN);
}
async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const err = new Error('payload_too_large'); err.status = 413; throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); }
  catch { const err = new Error('invalid_json'); err.status = 400; throw err; }
}
function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function hasKeyDeep(value, blocked) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(v => hasKeyDeep(v, blocked));
  return Object.entries(value).some(([k,v]) => blocked.has(k) || hasKeyDeep(v, blocked));
}
function rejectUnknownKeys(obj, allowed, label, errors) {
  for (const key of Object.keys(obj || {})) if (!allowed.has(key)) errors.push(`${label}.${key}: unsupported`);
}
function validateRequest(body) {
  const errors = [];
  if (!isPlainObject(body)) return ['body: must be an object'];
  rejectUnknownKeys(body, new Set(['schema','policy','model','context','conversation','message','responseFormat']), 'body', errors);
  if (body.schema !== 'coach-chat-request-v1') errors.push('schema: expected coach-chat-request-v1');
  if (!isPlainObject(body.policy)) errors.push('policy: object required');
  else {
    const requiredPolicy = {
      explainOnly: true,
      mayModifyTrainingEngine: false,
      rawEventsAllowed: false,
      medicalDiagnosisAllowed: false,
      trainingParameterAdviceAllowed: false,
    };
    rejectUnknownKeys(body.policy, new Set(Object.keys(requiredPolicy)), 'policy', errors);
    for (const [k,v] of Object.entries(requiredPolicy)) if (body.policy[k] !== v) errors.push(`policy.${k}: must be ${v}`);
  }
  if (!isPlainObject(body.context) || body.context.schema !== 'coach-context-v1') errors.push('context: coach-context-v1 required');
  else {
    if (hasKeyDeep(body.context, FORBIDDEN_CONTEXT_KEYS)) errors.push('context: contains forbidden raw/private fields');
    if (Buffer.byteLength(JSON.stringify(body.context)) > MAX_CONTEXT_BYTES) errors.push('context: too large');
    const p = body.context.privacy;
    if (!isPlainObject(p) || p.rawEventsIncluded !== false || p.exactTimestampsIncluded !== false || p.sessionIdsIncluded !== false || p.revisionsIncluded !== false) {
      errors.push('context.privacy: minimization flags must all be false');
    }
  }
  if (body.model != null && (typeof body.model !== 'string' || body.model.length > 80)) errors.push('model: invalid');
  else if (body.model && !ALLOWED_MODELS.has(body.model)) errors.push('model: not allowed by relay');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > MAX_MESSAGE_CHARS) errors.push('message: 1..1600 chars required');
  if (!Array.isArray(body.conversation) || body.conversation.length > MAX_CONVERSATION_TURNS) errors.push(`conversation: array max ${MAX_CONVERSATION_TURNS}`);
  else for (const [i,t] of body.conversation.entries()) {
    if (!isPlainObject(t) || !['user','assistant'].includes(t.role) || typeof t.text !== 'string' || t.text.length > MAX_MESSAGE_CHARS) errors.push(`conversation[${i}]: invalid`);
    else rejectUnknownKeys(t, new Set(['role','text']), `conversation[${i}]`, errors);
  }
  if (!isPlainObject(body.responseFormat) || body.responseFormat.schema !== 'coach-chat-response-v1') errors.push('responseFormat: coach-chat-response-v1 required');
  else {
    const requested = Array.isArray(body.responseFormat.allowedFields) ? body.responseFormat.allowedFields : [];
    if (requested.some(k => !ALLOWED_RESPONSE_FIELDS.has(k))) errors.push('responseFormat.allowedFields: unsupported field');
  }
  if (hasKeyDeep(body, FORBIDDEN_KEYS)) errors.push('request: contains forbidden Training Engine control field');
  return errors;
}

function outputHasForbiddenControl(value) {
  return hasKeyDeep(value, FORBIDDEN_KEYS);
}
function containsTrainingControlDirective(text='') {
  const t = String(text);
  return [
    /(?:stop|resume)\s*threshold\s*[:=]\s*[0-9]/i,
    /training\s*week\s*[:=]\s*[0-9]/i,
    /safety\s*flag\s*[:=]/i,
    /(?:停止|恢复|stop|resume).{0,12}阈值.{0,12}(?:改为|设为|调到|调整到)\s*[0-9]/i,
    /(?:把|将).{0,10}(?:停止|恢复).{0,8}阈值.{0,8}(?:改为|设为|调整到)\s*[0-9]/i,
  ].some(re => re.test(t));
}
function sanitizeOutput(value) {
  const src = isPlainObject(value?.output) ? value.output : value;
  if (!isPlainObject(src)) throw Object.assign(new Error('invalid_upstream_shape'), { status: 502 });
  if (outputHasForbiddenControl(value)) throw Object.assign(new Error('upstream_forbidden_control_field'), { status: 502 });
  const out = {
    answer: typeof src.answer === 'string' ? src.answer.slice(0, 5000) : '',
    focus: src.focus == null ? null : String(src.focus).slice(0, 2000),
    evidence: Array.isArray(src.evidence) ? src.evidence.slice(0, 8).map(x => ({
      label: String(x?.label || '依据').slice(0, 120),
      value: String(x?.value || '—').slice(0, 240),
    })) : [],
    uncertainty: src.uncertainty == null ? null : String(src.uncertainty).slice(0, 2000),
    safetyNotice: src.safetyNotice == null ? null : String(src.safetyNotice).slice(0, 2000),
  };
  if (!out.answer.trim()) throw Object.assign(new Error('upstream_missing_answer'), { status: 502 });
  const visible = [out.answer,out.focus,out.uncertainty,out.safetyNotice,...out.evidence.flatMap(x => [x.label,x.value])].filter(Boolean).join('\n');
  if (containsTrainingControlDirective(visible)) throw Object.assign(new Error('upstream_training_control_directive'), { status: 502 });
  return { schema: 'coach-chat-response-v1', output: out };
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    focus: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    evidence: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label','value'], additionalProperties: false,
      },
    },
    uncertainty: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    safetyNotice: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['answer','focus','evidence','uncertainty','safetyNotice'],
  additionalProperties: false,
};
const COACH_INSTRUCTIONS = `你是训练数据解释层，只解释用户自己的训练摘要。\n\n必须遵守：\n1. 只做观察、解释和下一次关注点，不诊断疾病，不声称治疗有效。\n2. 绝不修改、建议具体修改或输出 Stop/Resume 阈值、训练周次、Safety Flag、日程或 Training Engine 控制指令。\n3. 不把一次训练或小样本当成因果证据；说明不确定性。\n4. 如果输入显示疼痛或 Safety Review，优先给出安全提醒，不继续做表现优化。\n5. 不要求用户追求更长时间、更高刺激或逼近不可逆射精点。\n6. 使用中性、简洁、无评判的中文。\n7. evidence 只能引用输入摘要已有数据，不编造数值。\n8. 0–9是个人主观量表，ART不是临床疗效指标；4/8/12周是产品安排，不能称为验证疗程。不能把专业盆底康复结果外推到App自练。前后窗口各不足3条可比较记录时只作描述。`;

function buildOpenAIRequest(body) {
  const sanitizedConversation = body.conversation.map(t => ({ role: t.role, text: t.text }));
  const userPayload = {
    context: body.context,
    conversation: sanitizedConversation,
    question: body.message,
  };
  return {
    model: body.model || OPENAI_MODEL,
    store: false,
    instructions: COACH_INSTRUCTIONS,
    input: JSON.stringify(userPayload),
    max_output_tokens: 1200,
    text: {
      format: {
        type: 'json_schema',
        name: 'coach_chat_response',
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  };
}
function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  const pieces = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') pieces.push(part.text);
    }
  }
  return pieces.join('');
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function retryDelayMs(resp, attempt) {
  const header = resp?.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15_000, seconds * 1000 + Math.floor(Math.random() * 250));
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(15_000, Math.max(0, at - Date.now()) + Math.floor(Math.random() * 250));
  }
  const base = Math.min(4_000, 300 * (2 ** attempt));
  return base + Math.floor(Math.random() * 250);
}
function responseRefusal(data) {
  const pieces = [];
  for (const item of data?.output || []) for (const part of item?.content || []) if (part?.type === 'refusal' && typeof part.refusal === 'string') pieces.push(part.refusal);
  return pieces.join(' ').trim();
}
async function callOpenAI(body, rid) {
  if (MOCK_OPENAI) {
    return sanitizeOutput({ output: {
      answer: '这是模拟 Relay 的结构化 Coach 回答。近期数据用于解释个人训练趋势，不用于诊断或自动修改训练参数。',
      focus: '下次继续关注更早的身体信号与恢复过程。',
      evidence: [{ label: '可用 Session', value: String(body.context?.samples?.usable ?? '—') }],
      uncertainty: '模拟模式未调用外部模型。',
      safetyNotice: body.context?.latestState?.pain ? '最近记录包含疼痛或不适，应优先处理安全状态。' : null,
    }});
  }
  if (!OPENAI_API_KEY) throw Object.assign(new Error('server_missing_openai_api_key'), { status: 503 });
  const requestBody = buildOpenAIRequest(body);
  const deadline = Date.now() + UPSTREAM_TOTAL_TIMEOUT_MS;
  let lastError;
  for (let attempt = 0; attempt <= UPSTREAM_RETRY_COUNT; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('upstream_deadline_exceeded'), { status: 504 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(UPSTREAM_TIMEOUT_MS, remaining)));
    try {
      const resp = await fetch(`${OPENAI_BASE_URL}/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Client-Request-Id': rid,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const upstreamRequestId = resp.headers.get('x-request-id') || null;
      const text = await resp.text();
      if (!resp.ok) {
        const retryable = [429, 503].includes(resp.status) && attempt < UPSTREAM_RETRY_COUNT;
        log('upstream_error', { rid, upstreamRequestId, status: resp.status, retryable, attempt });
        if (retryable) {
          const delay = retryDelayMs(resp, attempt);
          if (Date.now() + delay >= deadline) throw Object.assign(new Error('upstream_deadline_exceeded'), { status: 504 });
          await sleep(delay);
          continue;
        }
        const err = new Error(`upstream_http_${resp.status}`); err.status = 502; throw err;
      }
      let data;
      try { data = JSON.parse(text); } catch { throw Object.assign(new Error('upstream_invalid_json'), { status: 502 }); }
      const refusal = responseRefusal(data);
      if (refusal) {
        log('upstream_refusal', { rid, upstreamRequestId });
        throw Object.assign(new Error('upstream_refusal'), { status: 422 });
      }
      if (data?.status === 'incomplete') {
        log('upstream_incomplete', { rid, upstreamRequestId, reason: data?.incomplete_details?.reason || 'unknown' });
        throw Object.assign(new Error('upstream_incomplete'), { status: 502 });
      }
      const outputText = extractOutputText(data);
      if (!outputText) throw Object.assign(new Error('upstream_missing_output_text'), { status: 502 });
      let parsed;
      try { parsed = JSON.parse(outputText); } catch { throw Object.assign(new Error('upstream_structured_output_parse_failed'), { status: 502 }); }
      log('upstream_ok', { rid, upstreamRequestId, attempt });
      return sanitizeOutput(parsed);
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError') throw Object.assign(new Error('upstream_timeout'), { status: 504 });
      if (err?.status) throw err;
      throw Object.assign(new Error('upstream_network_error'), { status: 502 });
    } finally { clearTimeout(timer); }
  }
  throw lastError || Object.assign(new Error('upstream_failed'), { status: 502 });
}

async function handleCoach(req, res, rid) {
  const started = Date.now();
  const cors = corsHeaders(req);
  if (!originAllowed(req)) return json(res, 403, { error: 'origin_not_allowed', requestId: rid });
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized', requestId: rid }, cors);
  const ipDigest = crypto.createHash('sha256').update(clientIp(req)).digest('hex');
  let limit;
  try { limit = await rateLimiter.consume(ipDigest); }
  catch (err) {
    log('rate_limit_unavailable', { rid, backend: RATE_LIMIT_BACKEND, failClosed: RATE_LIMIT_FAIL_CLOSED });
    return json(res, Number(err?.status) || 503, { error: 'rate_limit_backend_unavailable', requestId: rid }, cors);
  }
  if (limit.degraded) log('rate_limit_degraded', { rid, backend: limit.backend });
  const rateHeaders = {
    ...cors,
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset-Ms': String(limit.resetMs),
    'X-RateLimit-Backend': String(limit.backend),
  };
  if (!limit.allowed) {
    rateHeaders['Retry-After'] = String(Math.max(1, Math.ceil(limit.resetMs / 1000)));
    return json(res, 429, { error: 'rate_limited', requestId: rid }, rateHeaders);
  }
  let body;
  try { body = await readJsonBody(req); }
  catch (err) { return json(res, err.status || 400, { error: err.message, requestId: rid }, rateHeaders); }
  const errors = validateRequest(body);
  if (errors.length) return json(res, 400, { error: 'invalid_request', details: errors.slice(0, 10), requestId: rid }, rateHeaders);
  try {
    const result = await callOpenAI(body, rid);
    log('coach_ok', { rid, ms: Date.now() - started, model: body.model || OPENAI_MODEL, ipHash: ipDigest.slice(0,12), rateBackend: limit.backend });
    return json(res, 200, result, rateHeaders);
  } catch (err) {
    const status = Number(err?.status) || 502;
    log('coach_failed', { rid, ms: Date.now() - started, status, code: String(err?.message || 'unknown') });
    return json(res, status, { error: String(err?.message || 'relay_error'), requestId: rid }, rateHeaders);
  }
}

const MIME = new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.mjs','text/javascript; charset=utf-8'],
  ['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],
  ['.svg','image/svg+xml'],['.md','text/markdown; charset=utf-8'],['.txt','text/plain; charset=utf-8'],
]);
async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); }
  catch { return json(res, 400, { error: 'bad_path' }); }
  if (rel === '/') rel = '/index.html';
  const publicFiles = new Set(['/index.html','/app.js','/db.js','/content.js','/training-core.js','/plans.js','/plan-ui.js','/backup.js','/manifest.webmanifest','/icon.svg','/sw.js']);
  if (!publicFiles.has(rel)) return json(res, 404, { error: 'not_found' });
  const full = path.resolve(STATIC_ROOT, '.' + rel);
  if (!full.startsWith(STATIC_ROOT + path.sep) && full !== STATIC_ROOT) return json(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(full);
    if (!st.isFile()) throw new Error('not_file');
    const data = await readFile(full);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME.get(ext) || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { json(res, 404, { error: 'not_found' }); }
}

const server = http.createServer(async (req, res) => {
  const rid = requestId();
  res.setHeader('X-Request-Id', rid);
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return json(res, 400, { error: 'bad_url', requestId: rid }); }
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    if (!originAllowed(req)) return json(res, 403, { error: 'origin_not_allowed', requestId: rid });
    res.writeHead(204, corsHeaders(req)); return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'coach-relay',
      version: '2.0.0',
      upstream: MOCK_OPENAI ? 'mock' : 'openai-responses',
      modelConfigured: MOCK_OPENAI || !!OPENAI_API_KEY,
      model: OPENAI_MODEL,
      rateLimitBackend: RATE_LIMIT_BACKEND,
    }, corsHeaders(req));
  }
  if (req.method === 'GET' && url.pathname === '/api/ready') {
    try { const assets=['index.html','app.js','db.js','content.js','training-core.js','plans.js','plan-ui.js','backup.js','manifest.webmanifest','icon.svg','sw.js'];const results=await Promise.all(assets.map(file=>stat(path.join(STATIC_ROOT,file))));if(results.some(file=>!file.isFile()))throw new Error('Missing runtime file'); }
    catch { return json(res, 503, { ok: false, service: 'stop-action', error: 'assets_unavailable' }); }
    return json(res, 200, { ok: true, service: 'coach-relay', coreReady: true, version: '2.0.0', modelConfigured: MOCK_OPENAI || !!OPENAI_API_KEY }, corsHeaders(req));
  }
  if (req.method === 'GET' && url.pathname === '/api/coach/ready') {
    const limiter = await rateLimiter.health();
    const modelConfigured = MOCK_OPENAI || !!OPENAI_API_KEY;
    const ok = modelConfigured && limiter.ok;
    return json(res, ok ? 200 : 503, {
      ok,
      service: 'coach-relay',
      version: '2.0.0',
      modelConfigured,
      rateLimiter: { ok: limiter.ok, backend: limiter.backend, degraded: !!limiter.degraded },
    }, corsHeaders(req));
  }
  if (req.method === 'POST' && url.pathname === '/api/coach') return handleCoach(req, res, rid);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  return json(res, 405, { error: 'method_not_allowed', requestId: rid });
});

server.listen(PORT, HOST, () => {
  log('relay_started', { host: HOST, port: PORT, staticRoot: STATIC_ROOT, model: OPENAI_MODEL, mock: MOCK_OPENAI, authRequired: !!RELAY_BEARER_TOKEN, allowedOrigins: [...ALLOWED_ORIGINS], allowedModels: [...ALLOWED_MODELS], rateLimitBackend: RATE_LIMIT_BACKEND, rateLimitFailClosed: RATE_LIMIT_FAIL_CLOSED });
});

export { validateRequest, sanitizeOutput, buildOpenAIRequest, containsTrainingControlDirective, retryDelayMs, responseRefusal };
