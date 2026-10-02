import net from 'node:net';
import assert from 'node:assert/strict';
import { createRateLimiter } from './rate_limit.mjs';

function parseCommands(buffer) {
  const commands = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer[offset] !== 42) break;
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const count = Number(buffer.subarray(offset + 1, lineEnd).toString());
    let cursor = lineEnd + 2;
    const args = [];
    let complete = true;
    for (let i = 0; i < count; i++) {
      if (buffer[cursor] !== 36) { complete = false; break; }
      const lenEnd = buffer.indexOf('\r\n', cursor);
      if (lenEnd < 0) { complete = false; break; }
      const len = Number(buffer.subarray(cursor + 1, lenEnd).toString());
      const start = lenEnd + 2;
      const end = start + len;
      if (buffer.length < end + 2) { complete = false; break; }
      args.push(buffer.subarray(start, end).toString());
      cursor = end + 2;
    }
    if (!complete) break;
    commands.push(args);
    offset = cursor;
  }
  return { commands, rest: buffer.subarray(offset) };
}

const buckets = new Map();
const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    const parsed = parseCommands(buffer);
    buffer = parsed.rest;
    for (const args of parsed.commands) {
      const cmd = String(args[0] || '').toUpperCase();
      if (cmd === 'PING') socket.write('+PONG\r\n');
      else if (cmd === 'AUTH' || cmd === 'SELECT') socket.write('+OK\r\n');
      else if (cmd === 'EVAL') {
        const key = args[3];
        const windowMs = Number(args[4]);
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now >= b.expiresAt) b = { count: 0, expiresAt: now + windowMs };
        b.count += 1;
        buckets.set(key, b);
        const ttl = Math.max(0, b.expiresAt - now);
        socket.write(`*2\r\n:${b.count}\r\n:${ttl}\r\n`);
      } else socket.write('-ERR unsupported\r\n');
    }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  const limiter = createRateLimiter({ backend: 'redis', redisUrl: `redis://127.0.0.1:${port}/0`, windowMs: 5000, max: 2, failClosed: true });
  assert.equal((await limiter.health()).ok, true);
  const one = await limiter.consume('abc');
  const two = await limiter.consume('abc');
  const three = await limiter.consume('abc');
  assert.equal(one.backend, 'redis');
  assert.equal(one.allowed, true);
  assert.equal(two.allowed, true);
  assert.equal(three.allowed, false);
  assert.equal(three.remaining, 0);

  const fallback = createRateLimiter({ backend: 'redis', redisUrl: 'redis://127.0.0.1:1/0', connectTimeoutMs: 80, max: 1, failClosed: false });
  const degraded = await fallback.consume('x');
  assert.equal(degraded.allowed, true);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.backend, 'memory-fallback');

  const closed = createRateLimiter({ backend: 'redis', redisUrl: 'redis://127.0.0.1:1/0', connectTimeoutMs: 80, max: 1, failClosed: true });
  await assert.rejects(() => closed.consume('x'), err => err?.status === 503 && err?.message === 'rate_limit_backend_unavailable');
  console.log('RATE LIMIT CONTRACT TEST OK');
} finally {
  await new Promise(resolve => server.close(resolve));
}
