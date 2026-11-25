// v2.5.0: AI request wrapper with a mocked fetch. Run: node test/unit-ai.js
const assert = require('assert');
const { createAiClient, parseGeminiResponse, DEFAULT_MODELS } = require('../ai-request');

const KEY = 'TEST-KEY-NOT-REAL-123';
const ok = (text, extra) => ({ status: 200, headers: new Map(), text: async () => JSON.stringify(Object.assign({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }, extra || {})) });
const http = (status, body, headers) => ({ status, headers: new Map(Object.entries(headers || {})), text: async () => JSON.stringify(body || { error: { message: 'x', status: 'S' } }) });
function mk(fetchImpl, o) {
  const logs = [];
  const c = createAiClient(Object.assign({ fetch: fetchImpl, getKey: () => ' ' + KEY + '\n', log: m => logs.push(m), sleep: async () => {}, timeoutMs: 80, deadlineMs: 5000 }, o));
  return { c, logs };
}
const tests = [];
const t = (n, f) => tests.push([n, f]);

t('default models are current (no 2.5-flash primary)', () => {
  assert.strictEqual(DEFAULT_MODELS[0], 'gemini-3.5-flash-lite');
  assert(!DEFAULT_MODELS.includes('gemini-2.5-flash'));
});

t('happy path: header key (trimmed), key not in URL, no sampling params', async () => {
  let seen;
  const { c, logs } = mk(async (u, init) => { seen = { u, init }; return ok('Fixed text.'); });
  const r = await c.request('fix this secret customer text');
  assert(r.ok && r.text === 'Fixed text.' && r.model === 'gemini-3.5-flash-lite');
  assert(!seen.u.includes(KEY));
  assert.strictEqual(seen.init.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(seen.init.body);
  assert(!('temperature' in body.generationConfig) && !('topP' in body.generationConfig));
  assert.strictEqual(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert(body.contents[0].role === 'user');
  const all = logs.join('\n');
  assert(!all.includes(KEY) && !all.includes('secret customer text'), 'log must not hold key or text');
  assert(/model=gemini-3\.5-flash-lite/.test(all) && /status=200/.test(all) && /\d+ms/.test(all));
});

t('missing key -> nokey, fetch never called', async () => {
  let called = 0;
  const { c } = mk(async () => { called++; return ok('x'); }, { getKey: () => '   ' });
  const r = await c.request('hi');
  assert(!r.ok && r.kind === 'nokey' && called === 0);
});

t('timeout: hung fetch is aborted, retried, then fallback model answers', async () => {
  const calls = [];
  const f = (u, init) => { calls.push(u); if (calls.length <= 3) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); return Promise.resolve(ok('From fallback')); };
  const { c, logs } = mk(f);
  const t0 = Date.now();
  const r = await c.request('hi');
  assert(r.ok && r.text === 'From fallback' && r.model === DEFAULT_MODELS[1], JSON.stringify(r));
  assert(calls.length === 4 && Date.now() - t0 < 2000);
  assert(logs.some(l => /timeout/.test(l)));
});

t('timeout even when fetch ignores the abort signal', async () => {
  const f = () => new Promise(() => {}); // never settles
  const { c } = mk(f, { timeoutMs: 50, deadlineMs: 600, maxRetries: 0 });
  const t0 = Date.now();
  const r = await c.request('hi');
  assert(!r.ok && r.kind === 'timeout' && /longer than/.test(r.message), JSON.stringify(r));
  assert(Date.now() - t0 < 1500);
});

t('429 then success on the same model (retry with backoff)', async () => {
  let n = 0; const waits = [];
  const f = async (u) => (++n === 1 ? http(429, { error: { message: 'quota', status: 'RESOURCE_EXHAUSTED' } }) : ok('Second try'));
  const { c } = mk(f, { sleep: async ms => { waits.push(ms); } });
  const r = await c.request('hi');
  assert(r.ok && r.text === 'Second try' && r.model === DEFAULT_MODELS[0] && n === 2);
  assert(waits.length === 1 && waits[0] > 0);
});

t('Retry-After header is honoured (capped)', async () => {
  let n = 0; const waits = [];
  const f = async () => (++n === 1 ? http(429, null, { 'retry-after': '2' }) : ok('ok'));
  const { c } = mk(f, { sleep: async ms => { waits.push(ms); } });
  await c.request('hi');
  assert.strictEqual(waits[0], 2000);
});

t('503 on every try of the primary -> fallback model; max 3 tries per model', async () => {
  const seen = [];
  const f = async (u) => { seen.push(u.match(/models\/([^:]+):/)[1]); return seen.length <= 3 ? http(503) : ok('Fallback ok'); };
  const { c } = mk(f);
  const r = await c.request('hi');
  assert(r.ok && r.model === DEFAULT_MODELS[1]);
  assert.deepStrictEqual(seen, [DEFAULT_MODELS[0], DEFAULT_MODELS[0], DEFAULT_MODELS[0], DEFAULT_MODELS[1]]);
});

t('404 (model gone) goes straight to the next model, no retries', async () => {
  const seen = [];
  const f = async (u) => { seen.push(u); return seen.length === 1 ? http(404, { error: { message: 'not found', status: 'NOT_FOUND' } }) : ok('ok2'); };
  const { c } = mk(f);
  const r = await c.request('hi');
  assert(r.ok && r.model === DEFAULT_MODELS[1] && seen.length === 2);
});

t('everything fails -> clear message, no throw, no "undefined"', async () => {
  const { c } = mk(async () => http(503));
  const r = await c.request('hi');
  assert(!r.ok && /server is having trouble \(503\)/.test(r.message) && !/undefined/.test(r.message));
});

t('bad API key is fatal: one call, clear message', async () => {
  let n = 0;
  const { c } = mk(async () => { n++; return http(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }); });
  const r = await c.request('hi');
  assert(!r.ok && n === 1 && /API key is not valid/.test(r.message));
});

t('network error is retried then reported', async () => {
  let n = 0;
  const { c } = mk(async () => { n++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  const r = await c.request('hi');
  assert(!r.ok && r.kind === 'network' && /ENOTFOUND/.test(r.message) && n === 9, 'n=' + n);
});

t('blocked prompt -> clear message, stops (no fallback spam)', async () => {
  let n = 0;
  const { c } = mk(async () => { n++; return { status: 200, headers: new Map(), text: async () => JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }) }; });
  const r = await c.request('hi');
  assert(!r.ok && r.kind === 'blocked' && /blocked this text \(SAFETY\)/.test(r.message) && n === 1);
});

t('empty / no candidates / only thought parts -> error, then next model can answer', async () => {
  const bodies = [{ candidates: [] }, { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] }, finishReason: 'STOP' }] }, { candidates: [{ finishReason: 'SAFETY' }] }];
  for (const b of bodies) assert.throws(() => parseGeminiResponse(b), /AI/);
  let n = 0;
  const { c } = mk(async () => (++n === 1 ? { status: 200, headers: new Map(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }) } : ok('Real answer')));
  const r = await c.request('hi');
  assert(r.ok && r.text === 'Real answer' && r.model === DEFAULT_MODELS[1]);
});

t('multi-part answer is joined; thought parts dropped; "undefined" refused', () => {
  const j = { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'Hello ' }, { text: 'world' }] }, finishReason: 'STOP' }] };
  assert.strictEqual(parseGeminiResponse(j), 'Hello world');
  assert.throws(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'undefined' }] }, finishReason: 'STOP' }] }));
});

t('cut-off answer (MAX_TOKENS) is refused instead of replacing the text', async () => {
  const { c } = mk(async () => ({ status: 200, headers: new Map(), text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'half a sen' }] }, finishReason: 'MAX_TOKENS' }] }) }));
  const r = await c.request('hi');
  assert(!r.ok && r.kind === 'truncated');
});

t('double trigger: second request while one runs is ignored; busy clears afterwards', async () => {
  let n = 0, release;
  const gate = new Promise(r => { release = r; });
  const { c } = mk(async () => { n++; await gate; return ok('One answer'); }, { timeoutMs: 5000 });
  const p1 = c.request('a');
  assert(c.isBusy());
  const r2 = await c.request('b');
  assert(!r2.ok && r2.kind === 'busy');
  release();
  const r1 = await p1;
  assert(r1.ok && n === 1 && !c.isBusy());
  const r3 = await c.request('c');
  assert(r3.ok && !c.isBusy());
});

t('busy flag clears after a failure too', async () => {
  const { c } = mk(async () => { throw new Error('boom'); }, { maxRetries: 0 });
  await c.request('x');
  assert(!c.isBusy());
});

t('overall deadline caps the wait', async () => {
  const { c } = mk(() => new Promise(() => {}), { timeoutMs: 100, deadlineMs: 1800 });
  const t0 = Date.now();
  const r = await c.request('x');
  assert(!r.ok && Date.now() - t0 < 4000);
});

(async () => {
  let bad = 0;
  for (const [n, f] of tests) {
    try { await f(); console.log('  ok  ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n       ' + (e && e.stack || e)); }
  }
  if (bad) { console.error('AI UNIT FAIL (' + bad + ')'); process.exit(1); }
  console.log('AI UNIT OK (' + tests.length + ')');
})();
