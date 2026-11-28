// Cloudflare Pages Advanced Mode. Only a review deployment receives this module.
const apiPath = '/api/annotations';
const publicReviewOrigin = 'https://math-textbook-review.pages.dev';
const localReviewOrigins = new Set(['http://127.0.0.1:8770', 'http://localhost:8770']);
const pagePattern = /^(adult|kids)\/chapters\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const anchorPattern = /^n-[0-9a-f]{16}(?:-(?:[2-9]|[1-9][0-9]+))?$/;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxBytes = 16 * 1024;
const pageSize = 100;
const postsPerMinute = 24;
const fields = 'id, anchor, body, created_at AS createdAt, quote';

// A fresh D1 binding bootstraps on first access. IF NOT EXISTS and a single
// transaction make simultaneous first requests safe without manual migrations.
const schema = [
  `CREATE TABLE IF NOT EXISTS review_annotations (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
    page TEXT NOT NULL, anchor TEXT NOT NULL, body TEXT NOT NULL,
    quote TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS review_annotations_page ON review_annotations(page, seq)',
  `CREATE TABLE IF NOT EXISTS review_annotation_limits (
    minute INTEGER NOT NULL, actor TEXT NOT NULL, hits INTEGER NOT NULL,
    PRIMARY KEY(minute, actor)
  ) WITHOUT ROWID`,
  'CREATE TABLE IF NOT EXISTS review_annotation_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
  "INSERT OR IGNORE INTO review_annotation_settings(name, value) VALUES ('rate-key', hex(randomblob(32)))"
];

function json(data, status = 200, extra = {}) {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', ...extra
  }});
}

function validPage(page) {
  return typeof page === 'string' && page.length <= 160 && pagePattern.test(page);
}

async function readComment(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({error: '请用 JSON 提交批注。'}, 415);
  }
  if (Number(request.headers.get('Content-Length')) > maxBytes) return json({error: '请求过长。'}, 413);
  if (!request.body) return json({error: '缺少批注。'}, 400);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let used = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      if (used + value.length > maxBytes) {
        await reader.cancel();
        return json({error: '请求过长。'}, 413);
      }
      bytes.set(value, used);
      used += value.length;
    }
    const input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, used)));
    if (!input || !validPage(input.page) || typeof input.anchor !== 'string' || !anchorPattern.test(input.anchor) ||
        typeof input.requestId !== 'string' || !uuidV4.test(input.requestId)) {
      return json({error: '页面、段落或提交标识无效。'}, 400);
    }
    if (typeof input.body !== 'string' || !input.body.trim() || Array.from(input.body).length > 2000 ||
        typeof input.quote !== 'string' || Array.from(input.quote).length > 240 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.body + input.quote)) {
      return json({error: '请填写 1–2000 字的批注，原文摘录限 240 字。'}, 400);
    }
    return {page: input.page, anchor: input.anchor, requestId: input.requestId.toLowerCase(),
      body: input.body.trim(), quote: input.quote.trim()};
  } catch {
    return json({error: '无法读取批注内容。'}, 400);
  } finally {
    reader.releaseLock();
  }
}

async function withSchema(db, operation) {
  try {
    return await operation();
  } catch (error) {
    const reason = String(error) + ' ' + String(error.cause ?? '');
    if (!/no such table:\s*(?:main\.)?review_annotation/i.test(reason)) throw error;
    await db.batch(schema.map(statement => db.prepare(statement)));
    return operation();
  }
}

async function list(db, page, cursor) {
  const {results} = await db.prepare(`SELECT seq, ${fields} FROM review_annotations
    WHERE page = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3`).bind(page, cursor, pageSize + 1).all();
  const batch = results.slice(0, pageSize);
  const annotations = batch.map(({seq, ...annotation}) => annotation);
  const result = {annotations};
  if (results.length > pageSize) result.nextCursor = String(batch.at(-1).seq);
  return json(result);
}

async function hasAnchor(env, url, note) {
  const path = '/' + (note.page.startsWith('kids/') ? note.page.slice(5) : note.page);
  const source = await env.ASSETS.fetch(new Request(new URL(path, url.origin)));
  if (source.status >= 500) throw new Error('Review page unavailable');
  if (!source.ok || !source.headers.get('Content-Type')?.includes('text/html')) return false;
  let pageFound = false, anchorFound = false;
  const markup = new HTMLRewriter()
    .on('[data-note-page]', {element(el) { if (el.getAttribute('data-note-page') === note.page) pageFound = true; }})
    .on('[data-note-anchor]', {element(el) { if (el.getAttribute('data-note-anchor') === note.anchor) anchorFound = true; }})
    .transform(source);
  await markup.body.pipeTo(new WritableStream({write() {}}));
  return pageFound && anchorFound;
}

function stored(row, note, status = 200) {
  if (row.page !== note.page || row.anchor !== note.anchor || row.body !== note.body || row.quote !== note.quote) {
    return json({error: '这个提交标识已经用于另一份批注，请重新提交。'}, 409);
  }
  const {page, ...annotation} = row;
  return json({annotation}, status);
}

async function rateActor(db, request, minute) {
  const {value} = await db.prepare("SELECT value FROM review_annotation_settings WHERE name = 'rate-key'").first();
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(value), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  // The minute is part of the MAC so even consecutive buckets cannot be
  // linked by their stored digest. Addresses never become SQL parameters.
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const mac = await crypto.subtle.sign('HMAC', key, bytes.encode(minute + ':' + ip));
  return Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function post(db, env, url, request, note) {
  const lookup = db.prepare(`SELECT page, ${fields} FROM review_annotations WHERE request_id = ?1`).bind(note.requestId);
  const existing = await lookup.first();
  if (existing) return stored(existing, note);
  if (!await hasAnchor(env, url, note)) {
    const raced = await lookup.first();
    return raced ? stored(raced, note) : json({error: '这个段落在当前审阅版中不存在，请刷新页面。'}, 404);
  }

  const now = new Date(), minute = Math.floor(now.getTime() / 60000);
  const actor = await rateActor(db, request, minute);
  const id = crypto.randomUUID();
  // D1 executes the batch atomically. Charge the quota only when this
  // request's newly generated ID really made it into the table.
  const changes = await db.batch([
    db.prepare('DELETE FROM review_annotation_limits WHERE minute < ?1').bind(minute - 1),
    db.prepare(`INSERT INTO review_annotations (id, request_id, page, anchor, body, quote, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE NOT EXISTS (SELECT 1 FROM review_annotation_limits WHERE minute = ?8 AND actor = ?9 AND hits >= ?10)
      ON CONFLICT(request_id) DO NOTHING`)
      .bind(id, note.requestId, note.page, note.anchor, note.body, note.quote, now.toISOString(), minute, actor, postsPerMinute),
    db.prepare(`INSERT INTO review_annotation_limits (minute, actor, hits)
      SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM review_annotations WHERE id = ?3)
      ON CONFLICT(minute, actor) DO UPDATE SET hits = hits + 1`).bind(minute, actor, id),
    lookup
  ]);
  const row = changes[3].results[0];
  if (!row) return json({error: '这一分钟提交较多，请稍后再试。'}, 429,
    {'Retry-After': String(60 - now.getUTCSeconds())});
  return stored(row, note, row.id === id ? 201 : 200);
}

async function handle(request, env, url, allowedOrigin) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: {'Vary':'Origin', 'Cache-Control':'no-store',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type'}});
  }
  if (!['GET', 'POST'].includes(request.method)) return json({error:'此接口只支持读取和提交批注。'}, 405,
    {Allow: 'GET, POST, OPTIONS'});
  if (!allowedOrigin && request.method === 'POST' && request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({error:'请从教材审阅页提交。'}, 403);
  }
  if (!env.ANNOTATIONS) return json({error:'批注服务暂时不可用。'}, 503);
  if (request.method === 'GET') {
    const page = url.searchParams.get('page'), cursor = url.searchParams.get('cursor') ?? '0';
    if (!validPage(page) || !/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      return json({error:'页面或分页标识无效。'}, 400);
    }
    return withSchema(env.ANNOTATIONS, () => list(env.ANNOTATIONS, page, Number(cursor)));
  }
  const note = await readComment(request);
  if (note instanceof Response) return note;
  return withSchema(env.ANNOTATIONS, () => post(env.ANNOTATIONS, env, url, request, note));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== apiPath) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const local = url.origin === publicReviewOrigin && localReviewOrigins.has(origin);
    if (origin && origin !== url.origin && !local) return json({error:'请从教材审阅页访问批注。'}, 403);
    let response;
    try {
      response = await handle(request, env, url, local || origin === url.origin);
    } catch {
      response = json({error:'批注服务暂时不可用，请稍后重试。'}, 503);
    }
    if (local) response.headers.set('Access-Control-Allow-Origin', origin);
    return response;
  }
};
