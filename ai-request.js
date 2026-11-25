'use strict';
// v2.5.0: one place for every Gemini call (Fix Spelling, Make Professional).
// Plain REST call (the key goes in a header, never the URL) with:
//   - a hard per-attempt timeout (AbortController) and an overall deadline
//   - up to 2 retries with backoff on 429 / 500 / 502 / 503 / 504 / network errors / timeouts
//   - fallback models when one is gone (404), not allowed for this key (403) or overloaded
//   - safe parsing: blocked prompts, empty answers and cut-off answers become clear errors
//   - a single-flight guard so a second click while one request runs is ignored
// Nothing here logs the key or the text; the log line carries model, ms, status and error only.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Checked against Google's deprecation page on 2026-11-25:
//  - gemini-2.5-flash is deprecated: closed to new users, re-routed on 2026-12-01 (this was the old model)
//  - gemini-3.5-flash-lite is the recommended replacement; gemini-3.8-flash is the current Flash
//  - gemini-2.5-flash-lite is not deprecated
const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleepMs(ms) { return new Promise(r => setTimeout(r, ms)); }

class AiError extends Error {
  constructor(message, info) { super(message); this.name = 'AiError'; Object.assign(this, info || {}); }
}

// Pull the readable answer out of a generateContent response. Throws AiError (kind: 'blocked' | 'empty' | 'truncated').
function parseGeminiResponse(json) {
  if (!json || typeof json !== 'object') throw new AiError('The AI sent back an unreadable answer.', { kind: 'empty' });
  const pf = json.promptFeedback;
  if (pf && pf.blockReason) {
    throw new AiError('Google blocked this text (' + pf.blockReason + '). Try selecting a shorter or different piece of text.', { kind: 'blocked', reason: pf.blockReason });
  }
  const cand = Array.isArray(json.candidates) ? json.candidates[0] : null;
  if (!cand) throw new AiError('The AI did not send back an answer.', { kind: 'empty' });
  const parts = cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();
  const fr = cand.finishReason;
  if (!text) {
    if (fr && fr !== 'STOP') throw new AiError('The AI stopped without an answer (' + fr + ').', { kind: fr === 'SAFETY' || fr === 'PROHIBITED_CONTENT' || fr === 'BLOCKLIST' || fr === 'RECITATION' ? 'blocked' : 'empty', reason: fr });
    throw new AiError('The AI sent back an empty answer.', { kind: 'empty' });
  }
  if (fr === 'MAX_TOKENS') throw new AiError('The answer was cut off because the text is too long. Select a shorter piece of text.', { kind: 'truncated' });
  if (text === 'undefined' || text === 'null') throw new AiError('The AI sent back an empty answer.', { kind: 'empty' });
  return text;
}

function errorFromHttp(status, bodyText) {
  let msg = '';
  let reason = '';
  try {
    const j = JSON.parse(bodyText);
    if (j && j.error) {
      msg = j.error.message || '';
      const d = Array.isArray(j.error.details) ? j.error.details.find(x => x && x.reason) : null;
      reason = (d && d.reason) || j.error.status || '';
    }
  } catch (e) {}
  return { msg: String(msg).slice(0, 300), reason: String(reason) };
}

function friendlyHttp(status, reason, msg) {
  if (status === 400 && /API_KEY|api key/i.test(reason + ' ' + msg)) return 'The Gemini API key is not valid. Check it in Shop > Admin > System Settings.';
  if (status === 401 || (status === 403 && /API_KEY|PERMISSION|api key/i.test(reason + ' ' + msg))) return 'Google rejected the Gemini API key (' + status + '). Check the key in Shop > Admin > System Settings.';
  if (status === 429) return 'The AI is busy or the key hit its limit (429). Try again in a minute.';
  if (status === 404) return 'The AI model is no longer available (404).';
  if (status >= 500) return 'Google\'s AI server is having trouble (' + status + '). Try again in a moment.';
  return 'The AI request was refused (' + status + ').' + (msg ? ' ' + msg : '');
}

// opts: { fetch, getKey, log, models, timeoutMs, deadlineMs, maxRetries, backoffMs, sleep, now, maxOutputTokens }
function createAiClient(opts = {}) {
  const fetchImpl = opts.fetch;
  const getKey = opts.getKey || (() => '');
  const log = opts.log || (() => {});
  const models = (opts.models && opts.models.length) ? opts.models : DEFAULT_MODELS;
  const timeoutMs = opts.timeoutMs || 20000;
  const deadlineMs = opts.deadlineMs || 45000;
  const maxRetries = opts.maxRetries === undefined ? 2 : opts.maxRetries;
  const backoff = opts.backoffMs || [700, 1800];
  const sleep = opts.sleep || sleepMs;
  const now = opts.now || Date.now;
  const maxOutputTokens = opts.maxOutputTokens || 8192;
  const endpoint = opts.endpoint || ENDPOINT;
  let seq = 0;
  let inFlight = null;

  function genConfig(model) {
    const cfg = { maxOutputTokens };
    // 3.5 Flash-Lite thinks "minimal" by default; spelling fixes need no reasoning. No temperature/top-p/top-k (ignored by 3.x).
    if (/^gemini-3\.5-flash-lite/.test(model)) cfg.thinkingConfig = { thinkingLevel: 'minimal' };
    return cfg;
  }

  // One HTTP attempt. Resolves { text } or throws AiError with { status, retryable, nextModel, fatal }.
  async function attempt(model, prompt, key, remainingMs) {
    const ctl = new AbortController();
    const limit = Math.min(timeoutMs, remainingMs);
    let timer;
    const timedOut = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new AiError('The AI took longer than ' + Math.round(limit / 1000) + ' seconds to answer.', { kind: 'timeout', retryable: true, status: 'timeout' })); }, limit); });
    const run = (async () => {
      let res;
      try {
        res = await fetchImpl(endpoint + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: genConfig(model) }),
          signal: ctl.signal
        });
      } catch (e) {
        if (ctl.signal.aborted) throw e;
        throw new AiError('Could not reach the AI server (' + (e && (e.code || (e.cause && e.cause.code)) || e && e.message || 'network error') + '). Check the internet connection.', { kind: 'network', retryable: true, status: 'network' });
      }
      const status = res.status;
      let bodyText = '';
      try { bodyText = await res.text(); } catch (e) { if (ctl.signal.aborted) throw e; throw new AiError('The AI answer was cut off in transit.', { kind: 'network', retryable: true, status }); }
      if (status >= 200 && status < 300) {
        let json;
        try { json = JSON.parse(bodyText); } catch (e) { throw new AiError('The AI sent back an unreadable answer.', { kind: 'empty', status, nextModel: true }); }
        try { return { text: parseGeminiResponse(json), status }; }
        catch (e) {
          if (e instanceof AiError) { e.status = status; e.nextModel = e.kind === 'empty'; throw e; }
          throw e;
        }
      }
      const { msg, reason } = errorFromHttp(status, bodyText);
      const keyBad = (status === 400 || status === 401 || status === 403) && /API_KEY|api key|UNAUTHENTICATED/i.test(reason + ' ' + msg);
      const e = new AiError(friendlyHttp(status, reason, msg), { kind: 'http', status, reason });
      if (keyBad) e.fatal = true;
      else if (RETRY_STATUS.has(status)) { e.retryable = true; e.nextModel = true; const ra = res.headers && res.headers.get && Number(res.headers.get('retry-after')); if (ra > 0) e.retryAfterMs = Math.min(ra * 1000, 4000); }
      else if (status === 404 || status === 403 || status === 400) e.nextModel = true; // model gone / not allowed for this key / config rejected
      else e.nextModel = true;
      throw e;
    })();
    try { return await Promise.race([run, timedOut]); }
    catch (e) {
      if (e instanceof AiError) throw e;
      if (ctl.signal.aborted) throw new AiError('The AI took longer than ' + Math.round(limit / 1000) + ' seconds to answer.', { kind: 'timeout', retryable: true, status: 'timeout' });
      throw e;
    } finally { clearTimeout(timer); run.catch(() => {}); }
  }

  async function runRequest(prompt, id) {
    const key = String(getKey() || '').trim();
    if (!key) return { ok: false, kind: 'nokey', message: 'API key is missing. Please add it via Shop > Admin > System Settings.' };
    const t0 = now();
    let lastErr = null;
    for (let mi = 0; mi < models.length; mi++) {
      const model = models[mi];
      for (let n = 0; n <= maxRetries; n++) {
        const left = deadlineMs - (now() - t0);
        if (left < Math.min(1500, timeoutMs)) { lastErr = lastErr || new AiError('The AI took too long.', { kind: 'timeout' }); mi = models.length; break; }
        const ta = now();
        try {
          const r = await attempt(model, prompt, key, left);
          log('ai#' + id + ' model=' + model + ' try=' + (n + 1) + ' status=' + r.status + ' ok ' + (now() - ta) + 'ms chars=' + r.text.length + ' (total ' + (now() - t0) + 'ms)');
          return { ok: true, text: r.text, model, ms: now() - t0 };
        } catch (e) {
          const err = e instanceof AiError ? e : new AiError('Unexpected AI error: ' + (e && e.message || e), { kind: 'other' });
          lastErr = err;
          log('ai#' + id + ' model=' + model + ' try=' + (n + 1) + ' status=' + err.status + ' ' + (err.kind || '') + (err.reason ? '/' + err.reason : '') + ' FAIL ' + (now() - ta) + 'ms');
          if (err.fatal || err.kind === 'blocked' || err.kind === 'truncated') return { ok: false, kind: err.kind, status: err.status, message: err.message, model, ms: now() - t0 };
          if (err.retryable && n < maxRetries) {
            const wait = err.retryAfterMs || backoff[Math.min(n, backoff.length - 1)];
            if (deadlineMs - (now() - t0) > wait + 1500) { await sleep(wait); continue; }
          }
          break; // out of retries or not retryable: try the next model
        }
      }
    }
    const err = lastErr || new AiError('The AI request failed.', {});
    return { ok: false, kind: err.kind, status: err.status, message: err.message, ms: now() - t0 };
  }

  // request(prompt) -> { ok, text, model, ms } | { ok:false, message, kind, status } | { ok:false, kind:'busy' }
  async function request(prompt) {
    if (inFlight) { log('ai#busy ignored second request while one is running'); return { ok: false, kind: 'busy', message: 'The AI is still working on your last request.' }; }
    const id = ++seq;
    inFlight = runRequest(String(prompt), id).catch(e => ({ ok: false, kind: 'other', message: 'Unexpected AI error: ' + (e && e.message || e) }));
    try { const out = await inFlight; if (!out.ok) log('ai#' + id + ' gave up kind=' + out.kind + ' status=' + out.status + ' ' + (out.ms || 0) + 'ms'); return out; }
    finally { inFlight = null; }
  }

  return { request, isBusy: () => !!inFlight, models };
}

module.exports = { createAiClient, parseGeminiResponse, DEFAULT_MODELS, ENDPOINT, AiError };
