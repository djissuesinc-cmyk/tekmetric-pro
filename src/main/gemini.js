const textUtil = require('../shared/text');

function extractText(response) {
  if (!response) return '';
  if (typeof response.text === 'string') return response.text;
  try {
    if (response.text != null && typeof response.text !== 'function') return String(response.text);
  } catch (err) {
    return '';
  }
  const parts = response.candidates && response.candidates[0] && response.candidates[0].content
    ? response.candidates[0].content.parts || []
    : [];
  return parts.map(function (part) { return part && part.text ? part.text : ''; }).join('');
}

function mapGeminiError(err) {
  const msg = String((err && err.message) || err || '');
  if (/API key|API_KEY_INVALID|permission|unauth|401|403/i.test(msg)) {
    return 'Gemini rejected the API key. Check it in Settings.';
  }
  if (/quota|429|resource_exhausted|rate/i.test(msg)) {
    return 'Gemini rate limit reached. Wait a moment and try again.';
  }
  if (/model|404|not found|not supported/i.test(msg)) {
    return 'That Gemini model is not available. Change the model name in Settings.';
  }
  if (/timeout|timed out|abort/i.test(msg)) {
    return 'The Gemini request timed out. Try again.';
  }
  if (/fetch|network|ENOTFOUND|ETIMEDOUT|ECONN|socket|offline/i.test(msg)) {
    return 'Could not reach Gemini. Check the connection and try again.';
  }
  return 'Gemini could not complete that request.';
}

function buildCommentPrompt(repair, instruction) {
  const lines = (repair.lineItems || []).map(function (item) {
    return '- ' + item.description + ' x ' + textUtil.hundredthsToInput(item.qtyHundredths);
  }).join('\n');
  return [
    'Write a short service-advisor note for an independent auto repair shop.',
    'Use plain sentences in Canadian English. Do not use markdown.',
    'Do not invent prices, parts, measurements, or work that is not listed.',
    'Keep it under 90 words.',
    '',
    'Job:',
    'Customer vehicle: ' + repair.vehicle,
    'Concern: ' + repair.concern,
    'Status: ' + repair.status,
    'Lines:',
    lines || '- none yet',
    'Current note: ' + (repair.advisorComment || '(empty)'),
    '',
    'Advisor instruction: ' + (instruction || 'Write a clear note the customer can understand.'),
  ].join('\n');
}

function buildDiagnosticPrompt(local, notes) {
  return [
    'Write a technician note for an auto repair shop, based only on the local checklist below.',
    'Use plain sentences. Do not use markdown. Do not invent measurements, codes, or parts.',
    'If the checklist is general, say what to confirm first. Keep it under 120 words.',
    '',
    'Vehicle: ' + (local.vehicle || 'not given'),
    'Symptom: ' + local.symptoms,
    'Extra notes: ' + (notes || 'none'),
    'Summary: ' + local.summary,
    'Systems: ' + local.systems.join(', '),
    'Checks:',
    local.steps.map(function (step) { return '- ' + step; }).join('\n'),
    'Safety: ' + (local.safety.join(' ') || 'none noted'),
  ].join('\n');
}

async function generateText(options) {
  const apiKey = options.apiKey;
  const model = options.model || 'gemini-2.5-flash';
  if (!apiKey) {
    return { ok: false, error: 'Add a Gemini API key in Settings to draft with Gemini. Local diagnostics still work without one.' };
  }
  let ai = options.client;
  if (!ai) {
    let GoogleGenAI;
    try {
      GoogleGenAI = require('@google/genai').GoogleGenAI;
    } catch (err) {
      return { ok: false, error: 'The Gemini library is not installed.' };
    }
    ai = new GoogleGenAI({ apiKey: apiKey });
  }
  const prompt = String(options.prompt || '').slice(0, 8000);

  async function call(config) {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: Object.assign({
        temperature: 0.4,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(25000),
      }, config || {}),
    });
    return textUtil.stripModelFences(extractText(response));
  }

  try {
    let text = '';
    try {
      text = await call({ thinkingConfig: { thinkingBudget: 0, includeThoughts: false } });
    } catch (err) {
      if (!/thinking|budget|invalid argument/i.test(String(err && err.message))) throw err;
      text = '';
    }
    if (!text) text = await call({});
    if (!text) return { ok: false, error: 'Gemini returned no text. Try rephrasing the request.' };
    return { ok: true, text: text };
  } catch (err) {
    return { ok: false, error: mapGeminiError(err), detail: String(err && err.message || '') };
  }
}

module.exports = {
  extractText,
  mapGeminiError,
  buildCommentPrompt,
  buildDiagnosticPrompt,
  generateText,
};
