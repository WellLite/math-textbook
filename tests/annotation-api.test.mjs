// Run with Miniflare (installed with Wrangler) on Node's module path:
// NODE_PATH=/path/to/node_modules node --test tests/annotation-api.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const {Miniflare, Response, convertV4MiniflareOptions} = require('miniflare');
const script = readFileSync(new URL('../review/_worker.js', import.meta.url), 'utf8');
const origin = 'https://math-textbook-review.pages.dev';
const api = origin + '/api/annotations';
const kids = 'kids/chapters/numbers/natural';
const adult = 'adult/chapters/numbers/natural';
const anchor = 'n-1234567890abcdef';

function fixture(t) {
  const pages = new Map([['/chapters/numbers/natural', kids], ['/adult/chapters/numbers/natural', adult]]);
  const options = {cf: false, workers: [{
    name: 'review', modules: true, script, compatibilityDate: '2026-05-01', d1Databases: ['ANNOTATIONS'],
    serviceBindings: {ASSETS: async request => {
      const path = new URL(request.url).pathname;
      if (path === '/lesson.css') return new Response('body{}');
      if (path === '/chapters/broken') return new Response('error', {status: 503});
      if (!pages.has(path)) return new Response('missing', {status: 404});
      const html = '<article data-note-page="' + pages.get(path) + '"><p data-note-anchor="' + anchor + '">原段</p></article>';
      return new Response(html, {headers: {'Content-Type':'text/html; charset=utf-8'}});
    }}
  }]};
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const post = (note, headers = {}) => mf.dispatchFetch(api, {method:'POST',
    headers:{Origin:origin, 'Content-Type':'application/json', ...headers}, body:JSON.stringify(note)});
  const get = (page = kids, cursor = '') => mf.dispatchFetch(api + '?page=' + encodeURIComponent(page) + cursor);
  return {mf, pages, post, get};
}

function note(overrides = {}) {
  return {page:kids, anchor, body:'解释很清楚。', quote:'原段', requestId:crypto.randomUUID(), ...overrides};
}

test('first access, concurrent duplicate and distinct writes, revision and clean-up by public ID', async t => {
  const {mf, pages, post, get} = fixture(t);
  const first = note({body:'<b>请看这个反例</b>'});
  const attempts = await Promise.all(Array.from({length:8}, () => post(first)));
  assert.equal(attempts.filter(response => response.status === 201).length, 1);
  assert.equal(attempts.filter(response => response.status === 200).length, 7);
  const records = await Promise.all(attempts.map(response => response.json()));
  const saved = records[0].annotation;
  assert(records.every(result => result.annotation.id === saved.id));
  assert.deepEqual(Object.keys(saved).sort(), ['anchor', 'body', 'createdAt', 'id', 'quote']);
  assert.equal(saved.body, first.body);
  assert(Number.isFinite(Date.parse(saved.createdAt)));
  assert.equal((await post({...first, body:'changed'})).status, 409);

  const distinct = await Promise.all(Array.from({length:4}, (_, i) => post(note({body:'并行 '+i}))));
  assert(distinct.every(response => response.status === 201));
  assert.equal((await (await get()).json()).annotations.length, 5);
  assert.deepEqual(await (await get(adult)).json(), {annotations:[]});
  assert.equal((await post(note({page:adult}))).status, 201);
  assert.equal((await (await get(adult)).json()).annotations.length, 1);

  pages.delete('/chapters/numbers/natural');
  assert.deepEqual((await (await post(first)).json()).annotation, saved);
  assert.equal((await post(note())).status, 404);
  assert.equal((await (await get()).json()).annotations.length, 5);
  assert.equal((await mf.dispatchFetch(api, {method:'DELETE'})).status, 405);

  const db = await mf.getD1Database('ANNOTATIONS');
  await db.prepare('DELETE FROM review_annotations WHERE id = ?1').bind(saved.id).run();
  const rest = (await (await get()).json()).annotations;
  assert.equal(rest.length, 4);
  assert(rest.every(record => record.id !== saved.id));
  assert.equal(await (await mf.dispatchFetch(origin+'/lesson.css')).text(), 'body{}');
});

test('only real page/paragraph pairs can receive posts; Unicode and chunked-body limits', async t => {
  const {mf, pages, post, get} = fixture(t);
  assert.deepEqual(await (await get()).json(), {annotations:[]});
  assert.equal((await get('kids/chapters/../bad')).status, 400);
  assert.equal((await get(kids, '&cursor=9007199254740993')).status, 400);
  assert.equal((await post(note({page:'kids/chapters/missing'}))).status, 404);
  assert.equal((await post(note({page:'kids/chapters/broken'}))).status, 503);
  assert.equal((await post(note({anchor:'n-1122334455667788'}))).status, 404);
  pages.set('/chapters/wrong', adult);
  assert.equal((await post(note({page:'kids/chapters/wrong'}))).status, 404);
  for (const input of [{requestId:'free-text'}, {anchor:'free-text'}, {quote:'𠮷'.repeat(241)},
    {body:'👀'.repeat(2001)}, {body:'  '}, {body:'bad\u0000text'}]) {
    assert.equal((await post(note(input))).status, 400);
  }
  const full = note({quote:'𠮷'.repeat(240), body:'👀'.repeat(2000)});
  assert.equal((await post(full)).status, 201);
  assert.equal((await post(note(), {'Content-Type':'text/plain'})).status, 415);
  const chunked = new ReadableStream({start(stream) {
    stream.enqueue(new Uint8Array(8192)); stream.enqueue(new Uint8Array(8193)); stream.close();
  }});
  assert.equal((await mf.dispatchFetch(api, {method:'POST',body:chunked,duplex:'half',
    headers:{'Content-Type':'application/json'}})).status, 413);
});

test('approved local origins can read and post, while foreign writes and preflights are rejected', async t => {
  const {mf, post} = fixture(t);
  for (const local of ['http://127.0.0.1:8770', 'http://localhost:8770']) {
    const options = await mf.dispatchFetch(api, {method:'OPTIONS', headers:{Origin:local}});
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), local);
    assert.equal(options.headers.get('vary'), 'Origin');
    assert.equal(options.headers.get('access-control-allow-credentials'), null);
    assert.equal(options.headers.get('access-control-allow-headers'), 'Content-Type');
    const response = await post(note(), {Origin:local,'Sec-Fetch-Site':'cross-site'});
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('access-control-allow-origin'), local);
    const read = await mf.dispatchFetch(api + '?page=' + kids, {headers:{Origin:local}});
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('access-control-allow-origin'), local);
  }
  for (const foreign of ['null', 'https://other.example', 'http://localhost:8771', 'http://localhost:8770.example']) {
    assert.equal((await post(note(), {Origin:foreign})).status, 403);
    assert.equal((await mf.dispatchFetch(api, {method:'OPTIONS', headers:{Origin:foreign}})).status, 403);
  }
  assert.equal((await mf.dispatchFetch('https://another.example/api/annotations?page='+kids,
    {headers:{Origin:'http://localhost:8770'}})).status, 403);
});

test('page cursor keeps all notes in insertion order and is independent of other pages', async t => {
  const {mf, get} = fixture(t);
  await get();
  const db = await mf.getD1Database('ANNOTATIONS');
  const insert = db.prepare('INSERT INTO review_annotations(id, request_id, page, anchor, body, quote, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)');
  for (let batch = 0; batch < 2; batch++) {
    const rows = [];
    for (let i=0; i<55; i++) {
      rows.push(insert.bind(crypto.randomUUID(), crypto.randomUUID(), kids, anchor, String(55*batch+i), '', new Date().toISOString()));
    }
    await db.batch(rows);
  }
  const first = await (await get()).json();
  assert.equal(first.annotations.length, 100);
  const last = await (await get(kids, '&cursor='+first.nextCursor)).json();
  assert.equal(last.nextCursor, undefined);
  assert.deepEqual([...first.annotations,...last.annotations].map(a=>a.body), Array.from({length:110},(_,i)=>String(i)));
});

test('the write limit is atomic, leaves no addresses in storage, and permits idempotent retries', async t => {
  const {mf, post, get} = fixture(t);
  const first = note();
  assert.equal((await post(first)).status, 201);
  const responses = await Promise.all(Array.from({length:54}, () => post(note())));
  assert(responses.some(response => response.status === 429 && Number(response.headers.get('retry-after'))>0));
  assert(responses.every(response => [201,429].includes(response.status)));
  assert.equal((await post(first)).status, 200);
  const db = await mf.getD1Database('ANNOTATIONS');
  const limits = await db.prepare('SELECT actor, hits FROM review_annotation_limits').all();
  assert(limits.results.length);
  assert(limits.results.every(row => /^[a-f0-9]{64}$/.test(row.actor) && row.hits <= 24));
  const saved = (await (await get()).json()).annotations.length;
  assert.equal(saved, responses.filter(response => response.status === 201).length + 1);
});
