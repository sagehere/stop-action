import net from 'node:net';
import tls from 'node:tls';

function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const text = String(arg);
    parts.push(`$${Buffer.byteLength(text)}\r\n${text}\r\n`);
  }
  return parts.join('');
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf('\r\n', offset + 1);
  if (lineEnd < 0) return null;
  const line = buffer.subarray(offset + 1, lineEnd).toString('utf8');
  const next = lineEnd + 2;
  if (type === '+' || type === '-') return { value: type === '-' ? new Error(line) : line, bytes: next - offset };
  if (type === ':') return { value: Number(line), bytes: next - offset };
  if (type === '$') {
    const len = Number(line);
    if (len === -1) return { value: null, bytes: next - offset };
    if (!Number.isFinite(len) || len < 0 || buffer.length < next + len + 2) return null;
    return { value: buffer.subarray(next, next + len).toString('utf8'), bytes: next + len + 2 - offset };
  }
  if (type === '*') {
    const count = Number(line);
    if (count === -1) return { value: null, bytes: next - offset };
    if (!Number.isFinite(count) || count < 0) return null;
    let cursor = next;
    const out = [];
    for (let i = 0; i < count; i++) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) return null;
      if (parsed.value instanceof Error) throw parsed.value;
      out.push(parsed.value);
      cursor += parsed.bytes;
    }
    return { value: out, bytes: cursor - offset };
  }
  throw new Error('redis_protocol_error');
}

class RespClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.closed = false;
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on('error', err => this.rejectAll(err));
    socket.on('close', () => this.rejectAll(new Error('redis_connection_closed')));
  }
  drain() {
    while (this.waiters.length) {
      let parsed;
      try { parsed = parseResp(this.buffer); }
      catch (err) { this.waiters.shift().reject(err); continue; }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.bytes);
      const waiter = this.waiters.shift();
      if (parsed.value instanceof Error) waiter.reject(parsed.value);
      else waiter.resolve(parsed.value);
    }
  }
  rejectAll(err) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
  }
  command(args) {
    if (this.closed) return Promise.reject(new Error('redis_connection_closed'));
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.socket.write(encodeCommand(args));
      this.drain();
    });
  }
  close() {
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }
}

async function connectRedis(redisUrl, timeoutMs) {
  const url = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('unsupported_redis_protocol');
  const host = url.hostname || '127.0.0.1';
  const port = Number(url.port || 6379);
  const socket = url.protocol === 'rediss:'
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('redis_connect_timeout')); }, timeoutMs);
    const event = url.protocol === 'rediss:' ? 'secureConnect' : 'connect';
    socket.once(event, () => { clearTimeout(timer); resolve(); });
    socket.once('error', err => { clearTimeout(timer); reject(err); });
  });
  const client = new RespClient(socket);
  const username = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');
  if (password) {
    if (username) await client.command(['AUTH', username, password]);
    else await client.command(['AUTH', password]);
  }
  const dbText = url.pathname.replace(/^\//, '');
  if (dbText && dbText !== '0') await client.command(['SELECT', Number(dbText)]);
  return client;
}

class MemoryRateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.buckets = new Map();
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) if (now - bucket.startedAt > this.windowMs * 2) this.buckets.delete(key);
    }, Math.max(30_000, windowMs));
    this.timer.unref?.();
  }
  async consume(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) bucket = { startedAt: now, count: 0 };
    bucket.count += 1;
    this.buckets.set(key, bucket);
    const resetMs = Math.max(0, this.windowMs - (now - bucket.startedAt));
    return {
      allowed: bucket.count <= this.max,
      remaining: Math.max(0, this.max - bucket.count),
      resetMs,
      backend: 'memory',
      degraded: false,
    };
  }
  async health() { return { ok: true, backend: 'memory', degraded: false }; }
}

const RATE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`.trim();

class RedisRateLimiter {
  constructor({ redisUrl, windowMs, max, prefix, connectTimeoutMs }) {
    if (!redisUrl) throw new Error('REDIS_URL is required when RATE_LIMIT_BACKEND=redis');
    this.redisUrl = redisUrl;
    this.windowMs = windowMs;
    this.max = max;
    this.prefix = prefix;
    this.connectTimeoutMs = connectTimeoutMs;
  }
  async withClient(fn) {
    const client = await connectRedis(this.redisUrl, this.connectTimeoutMs);
    try { return await fn(client); }
    finally { client.close(); }
  }
  async consume(key) {
    return this.withClient(async client => {
      const result = await client.command(['EVAL', RATE_SCRIPT, '1', `${this.prefix}:${key}`, String(this.windowMs)]);
      if (!Array.isArray(result) || result.length < 2) throw new Error('redis_rate_limit_bad_response');
      const count = Number(result[0]);
      const ttl = Number(result[1]);
      return {
        allowed: count <= this.max,
        remaining: Math.max(0, this.max - count),
        resetMs: Number.isFinite(ttl) && ttl >= 0 ? ttl : this.windowMs,
        backend: 'redis',
        degraded: false,
      };
    });
  }
  async health() {
    try {
      const pong = await this.withClient(client => client.command(['PING']));
      return { ok: pong === 'PONG', backend: 'redis', degraded: false };
    } catch (err) {
      return { ok: false, backend: 'redis', degraded: true, error: String(err?.message || err) };
    }
  }
}

export function createRateLimiter({ backend = 'memory', windowMs = 60_000, max = 20, redisUrl = '', prefix = 'coach_rl', connectTimeoutMs = 1200, failClosed = false } = {}) {
  const memory = new MemoryRateLimiter({ windowMs, max });
  if (backend !== 'redis') return memory;
  const redis = new RedisRateLimiter({ redisUrl, windowMs, max, prefix, connectTimeoutMs });
  return {
    async consume(key) {
      try { return await redis.consume(key); }
      catch (err) {
        if (failClosed) {
          const wrapped = new Error('rate_limit_backend_unavailable');
          wrapped.status = 503;
          wrapped.cause = err;
          throw wrapped;
        }
        const fallback = await memory.consume(key);
        return { ...fallback, backend: 'memory-fallback', degraded: true, error: String(err?.message || err) };
      }
    },
    async health() {
      const status = await redis.health();
      if (status.ok) return status;
      if (failClosed) return status;
      return { ok: true, backend: 'memory-fallback', degraded: true, error: status.error };
    },
  };
}
