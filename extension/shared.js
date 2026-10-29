(function (root) {
  'use strict';

  var SHOP_HOSTS = {
    'shop.tekmetric.com': true,
    'sandbox.tekmetric.com': true
  };

  var MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash'];

  var ARRIVED_ICON_PATH = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
  var FINISHED_RO_ICON_PATH = 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm17.59-2.07-4.25 4.24-2.12-2.12-1.41 1.41L16.34 19 22 13.34z';

  var SKIP_INPUT_TYPES = {
    password: true,
    email: true,
    number: true,
    tel: true,
    url: true,
    date: true,
    time: true,
    'datetime-local': true,
    month: true,
    week: true,
    color: true,
    range: true,
    checkbox: true,
    radio: true,
    file: true,
    hidden: true,
    submit: true,
    button: true,
    reset: true,
    search: true
  };

  var TASKS = {
    draft: 'Write a comment',
    clean: 'Clean up this note',
    short: 'Make it shorter',
    customer: 'Make it customer-friendly',
    diagnose: 'Suggest what to check'
  };

  var SYSTEM_INSTRUCTION = [
    'You help an auto repair shop write short notes and think through symptoms.',
    'Use plain sentences. Do not use markdown headings, bullet symbols, or code blocks.',
    'Do not invent prices, part numbers, torque specs, wiring pins, or service bulletins.',
    'If a guess is uncertain, say it is a guess.',
    'Keep names and numbers that are already in the note.',
    'Do not add personal information that was not in the note.',
    'Do not give instructions for stealing a vehicle or defeating security to take a car.',
    'This is a suggestion for a technician to review, not a final diagnosis.'
  ].join(' ');

  function defaultSettings() {
    return {
      darkMode: true,
      spellcheck: true,
      autoCapitalize: true,
      crossOutDone: true,
      autoFillLogin: false,
      autoPressSignIn: false,
      email: '',
      password: '',
      geminiApiKey: ''
    };
  }

  function asBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function asText(value, maxLength) {
    if (typeof value !== 'string') return '';
    var trimmed = value.replace(/\u0000/g, '');
    if (trimmed.length > maxLength) return trimmed.slice(0, maxLength);
    return trimmed;
  }

  function normalizeSettings(raw) {
    var base = defaultSettings();
    var source = raw && typeof raw === 'object' ? raw : {};
    var email = asText(source.email, 200).trim();
    var password = asText(source.password, 500);
    var geminiApiKey = asText(source.geminiApiKey, 256).trim();
    var autoFillLogin = asBool(source.autoFillLogin, base.autoFillLogin) && email.length > 0 && password.length > 0;
    return {
      darkMode: asBool(source.darkMode, base.darkMode),
      spellcheck: asBool(source.spellcheck, base.spellcheck),
      autoCapitalize: asBool(source.autoCapitalize, base.autoCapitalize),
      crossOutDone: asBool(source.crossOutDone, base.crossOutDone),
      autoFillLogin: autoFillLogin,
      autoPressSignIn: asBool(source.autoPressSignIn, base.autoPressSignIn) && autoFillLogin,
      email: email,
      password: autoFillLogin ? password : '',
      geminiApiKey: geminiApiKey
    };
  }

  function isShopHost(hostname) {
    return SHOP_HOSTS[String(hostname || '').toLowerCase()] === true;
  }

  function isLoginPath(pathname) {
    return pathname === '/' || pathname === '/login';
  }

  function shouldFillLogin(pathname, settings) {
    var safe = normalizeSettings(settings);
    return safe.autoFillLogin && isLoginPath(pathname);
  }

  function shouldPressSignIn(pathname, settings, alreadyTried) {
    if (alreadyTried) return false;
    var safe = normalizeSettings(settings);
    return safe.autoPressSignIn && shouldFillLogin(pathname, safe);
  }

  function controlHint(control) {
    if (!control) return '';
    var parts = [
      control.type,
      control.name,
      control.id,
      control.getAttribute ? control.getAttribute('autocomplete') : '',
      control.getAttribute ? control.getAttribute('inputmode') : '',
      control.getAttribute ? control.getAttribute('aria-label') : ''
    ];
    return parts.join(' ').toLowerCase();
  }

  function isSensitiveControl(control) {
    if (!control) return true;
    var type = String(control.type || (control.getAttribute && control.getAttribute('type')) || '').toLowerCase();
    if (SKIP_INPUT_TYPES[type]) return true;
    return /password|email|username|user-name|cc-number|cc-csc|credit|otp|one-time|pin|api-key|apikey/.test(controlHint(control));
  }

  function isWritableNote(control) {
    if (!control || control.disabled || control.readOnly) return false;
    var tag = String(control.tagName || '').toLowerCase();
    if (tag !== 'textarea' && tag !== 'input') return false;
    if (typeof control.value !== 'string') return false;
    if (isSensitiveControl(control)) return false;
    if (tag === 'input') {
      var type = String(control.type || 'text').toLowerCase();
      if (type !== 'text' && type !== '') return false;
    }
    if (/search/.test(controlHint(control))) return false;
    return true;
  }

  function capitalizeSentences(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    return text.replace(/(^|[\n\r]|[.!?]+\s+)([a-z])/g, function (_match, lead, letter) {
      return lead + letter.toUpperCase();
    });
  }

  function normalizePath(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function appointmentIsDone(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return false;
    var paths = node.querySelectorAll('.event-icon path');
    var arrived = normalizePath(ARRIVED_ICON_PATH);
    var finished = normalizePath(FINISHED_RO_ICON_PATH);
    var index;
    for (index = 0; index < paths.length; index += 1) {
      var drawn = normalizePath(paths[index].getAttribute && paths[index].getAttribute('d'));
      if (drawn === arrived || drawn === finished) return true;
    }
    var labels = node.querySelectorAll('ul');
    for (index = 0; index < labels.length; index += 1) {
      var label = String(labels[index].textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(arrived|completed|posted|accounts receivable)$/i.test(label)) return true;
    }
    return false;
  }

  function taskInstructions(task) {
    if (task === 'draft') {
      return 'Turn these rough shop notes into a short repair-order comment. Keep the meaning. Do not add work that is not mentioned.';
    }
    if (task === 'clean') {
      return 'Fix spelling and grammar in this shop note. Keep the same meaning and about the same length.';
    }
    if (task === 'short') {
      return 'Rewrite this shop note so it is shorter. Keep the facts.';
    }
    if (task === 'customer') {
      return 'Rewrite this shop note in friendly wording a customer can read. Do not make promises that are not in the note.';
    }
    if (task === 'diagnose') {
      return 'A technician described a symptom. Reply with a few likely causes and what to check first, in plain sentences. Say when something is only a guess. Do not invent specifications.';
    }
    return '';
  }

  function buildPrompt(task, text) {
    var instruction = taskInstructions(task);
    var note = typeof text === 'string' ? text.trim() : '';
    if (!instruction) return { ok: false, message: 'That action is not available.' };
    if (!note) {
      return {
        ok: false,
        message: task === 'diagnose'
          ? 'Type the symptom first.'
          : 'Click the note you want help with, and type a few words first.'
      };
    }
    if (note.length > 4000) note = note.slice(0, 4000);
    return {
      ok: true,
      prompt: instruction + '\n\nNote:\n' + note
    };
  }

  function geminiUrl(model) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  }

  function parseGeminiBody(body) {
    if (!body || typeof body !== 'object') return '';
    var candidates = body.candidates || [];
    var first = candidates[0] || {};
    var content = first.content || {};
    var parts = content.parts || [];
    var chunks = [];
    var index;
    for (index = 0; index < parts.length; index += 1) {
      if (parts[index] && parts[index].thought) continue;
      if (parts[index] && typeof parts[index].text === 'string') chunks.push(parts[index].text);
    }
    return chunks.join('').trim();
  }

  function shouldTryNextModel(status, body) {
    if (status === 404) return true;
    var message = body && body.error && body.error.message ? String(body.error.message) : '';
    return /not found|unknown model|not supported for generatecontent/i.test(message);
  }

  function friendlyGeminiError(status, body) {
    var raw = body && body.error && body.error.message ? String(body.error.message) : '';
    if (status === 400 && /api key|api_key_invalid/i.test(raw)) {
      return 'That Google key was not accepted. Check the key in Tekmetric Pro and try again.';
    }
    if (status === 401 || status === 403) {
      return 'Google refused the key. Check the key in Tekmetric Pro.';
    }
    if (status === 429) return 'Google is busy right now. Wait a moment and try again.';
    if (body && body.promptFeedback && body.promptFeedback.blockReason) {
      return 'Google blocked that request. Try different wording.';
    }
    return 'The writing helper could not get an answer. Try again.';
  }

  function askGemini(settings, task, text, fetchImpl) {
    var safe = normalizeSettings(settings);
    var built = buildPrompt(task, text);
    if (!built.ok) return Promise.resolve(built);
    if (!safe.geminiApiKey) {
      return Promise.resolve({
        ok: false,
        message: 'Add your Google Gemini key in the Tekmetric Pro button first.'
      });
    }
    if (typeof fetchImpl !== 'function') {
      return Promise.resolve({ ok: false, message: 'The writing helper is not ready. Reload the page.' });
    }

    var payload = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: built.prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
    });

    function attempt(index) {
      if (index >= MODELS.length) {
        return Promise.resolve({ ok: false, message: friendlyGeminiError(404, null) });
      }
      return fetchImpl(geminiUrl(MODELS[index]), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': safe.geminiApiKey
        },
        body: payload
      }).then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (body) {
          if (shouldTryNextModel(response.status, body) && index < MODELS.length - 1) {
            return attempt(index + 1);
          }
          if (!response.ok) return { ok: false, message: friendlyGeminiError(response.status, body) };
          if (body && body.promptFeedback && body.promptFeedback.blockReason) {
            return { ok: false, message: friendlyGeminiError(response.status, body) };
          }
          var answer = parseGeminiBody(body);
          if (!answer) return { ok: false, message: 'Google sent back an empty answer. Try again.' };
          return { ok: true, text: answer };
        });
      }).catch(function () {
        return { ok: false, message: 'Could not reach Google. Check your internet and try again.' };
      });
    }

    return attempt(0);
  }

  root.TekmetricPro = {
    SHOP_HOSTS: SHOP_HOSTS,
    MODELS: MODELS,
    ARRIVED_ICON_PATH: ARRIVED_ICON_PATH,
    FINISHED_RO_ICON_PATH: FINISHED_RO_ICON_PATH,
    TASKS: TASKS,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    isShopHost: isShopHost,
    isLoginPath: isLoginPath,
    shouldFillLogin: shouldFillLogin,
    shouldPressSignIn: shouldPressSignIn,
    isSensitiveControl: isSensitiveControl,
    isWritableNote: isWritableNote,
    capitalizeSentences: capitalizeSentences,
    appointmentIsDone: appointmentIsDone,
    buildPrompt: buildPrompt,
    geminiUrl: geminiUrl,
    parseGeminiBody: parseGeminiBody,
    friendlyGeminiError: friendlyGeminiError,
    askGemini: askGemini
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
