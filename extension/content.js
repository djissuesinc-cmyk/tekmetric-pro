(function () {
  'use strict';

  var api = globalThis.TekmetricPro;
  if (!api) return;

  var preview = globalThis.__TMPRO_PREVIEW__ === true;
  if (!preview && !api.isShopHost(location.hostname)) return;

  function pagePath() {
    if (preview && typeof globalThis.__TMPRO_PREVIEW_PATH__ === 'string') {
      return globalThis.__TMPRO_PREVIEW_PATH__;
    }
    return location.pathname;
  }

  var settings = api.defaultSettings();
  var lastField = null;
  var signInTried = false;
  var scanTimer = 0;
  var loginWatchStarted = false;
  var loginStartedAt = 0;
  var loginEdited = false;

  function storageGet() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(null, function (items) {
          resolve(items || {});
        });
      } catch (err) {
        resolve({});
      }
    });
  }

  function readSignInTried() {
    if (signInTried) return true;
    try {
      return sessionStorage.getItem('tmpro-signin-once') === '1';
    } catch (err) {
      return false;
    }
  }

  function markSignInTried() {
    signInTried = true;
    try {
      sessionStorage.setItem('tmpro-signin-once', '1');
    } catch (err) {
      /* private mode can block storage; the in-memory flag still stops a loop */
    }
  }

  function applyTheme() {
    document.documentElement.classList.toggle('tmpro-dark', settings.darkMode === true);
  }

  function injectCss() {
    if (document.getElementById('tmpro-style')) return Promise.resolve();
    var url = 'page.css';
    try {
      url = chrome.runtime.getURL('page.css');
    } catch (err) {
      url = 'page.css';
    }
    return fetch(url).then(function (response) {
      return response.text();
    }).then(function (css) {
      if (document.getElementById('tmpro-style')) return;
      var style = document.createElement('style');
      style.id = 'tmpro-style';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }).catch(function () {
      /* the page still works if styles fail to load */
    });
  }

  function setControlValue(control, value) {
    var tag = String(control.tagName || '').toLowerCase();
    var prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    var tracker = control._valueTracker;
    if (tracker && typeof tracker.setValue === 'function') {
      tracker.setValue(control.value === value ? value + '\u200b' : control.value);
    }
    if (descriptor && descriptor.set) descriptor.set.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    var propKey = Object.keys(control).find(function (key) {
      return key.indexOf('__reactProps') === 0;
    });
    var props = propKey ? control[propKey] : null;
    if (props && typeof props.onChange === 'function') {
      try {
        props.onChange({ target: control, currentTarget: control });
      } catch (err) {
        /* the page keeps its own value if this field uses a different handler */
      }
    }
  }

  function eachControl(callback) {
    var controls = document.querySelectorAll('input, textarea');
    var index;
    for (index = 0; index < controls.length; index += 1) callback(controls[index]);
  }

  function applySpellcheck() {
    eachControl(function (control) {
      if (control.closest && control.closest('#tmpro-root')) return;
      var enabled = settings.spellcheck === true && !api.isSensitiveControl(control);
      var next = enabled ? 'true' : 'false';
      if (control.getAttribute('spellcheck') !== next) control.setAttribute('spellcheck', next);
    });
  }

  function applyDoneMarks() {
    var nodes = document.querySelectorAll('.rbc-event, .rbc-agenda-event-cell');
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      var done = settings.crossOutDone === true && api.appointmentIsDone(nodes[index]);
      nodes[index].classList.toggle('tmpro-done', done);
    }
  }

  function loginFields() {
    var email = document.querySelector('input[name="email"]');
    var password = document.querySelector('input[name="password"], input[type="password"]');
    return { email: email, password: password };
  }

  function maybeLogin() {
    var fields = loginFields();
    if (!fields.email || !fields.password) return;
    if (!api.shouldFillLogin(pagePath(), settings)) return;
    if (!loginStartedAt) loginStartedAt = Date.now();
    if (loginEdited) return;
    if (fields.email.getAttribute('data-tmpro-filled') === '1') {
      maybePressSignIn(fields);
      return;
    }
    if (Date.now() - loginStartedAt > 8000) return;
    setControlValue(fields.email, settings.email);
    setControlValue(fields.password, settings.password);
    if (fields.email.value === settings.email && fields.password.value === settings.password) {
      fields.email.setAttribute('data-tmpro-filled', '1');
      maybePressSignIn(fields);
    }
  }

  function watchLogin() {
    if (loginWatchStarted) return;
    if (!api.shouldFillLogin(pagePath(), settings)) return;
    loginWatchStarted = true;
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      maybeLogin();
      var filled = document.querySelector('input[data-tmpro-filled="1"]');
      var waitingToPress = api.shouldPressSignIn(pagePath(), settings, readSignInTried());
      if ((filled && !waitingToPress) || attempts > 25 || !api.shouldFillLogin(pagePath(), settings)) {
        clearInterval(timer);
      }
    }, 300);
  }

  function maybePressSignIn(fields) {
    if (!api.shouldPressSignIn(pagePath(), settings, readSignInTried())) return;
    var form = fields.password.form || fields.email.form;
    var button = form ? form.querySelector('button[type="submit"]') : document.querySelector('button[type="submit"]');
    if (!button || button.disabled) return;
    markSignInTried();
    button.click();
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = 0;
      applySpellcheck();
      applyDoneMarks();
      watchLogin();
      maybeLogin();
    }, 150);
  }

  function rememberField(control) {
    if (!control || (control.closest && control.closest('#tmpro-root'))) return;
    if (!api.isWritableNote(control)) return;
    lastField = control;
  }

  function capitalizeIfNeeded(control) {
    if (settings.autoCapitalize !== true) return;
    if (!api.isWritableNote(control)) return;
    if (control.closest && control.closest('#tmpro-root')) return;
    var next = api.capitalizeSentences(control.value);
    if (typeof next === 'string' && next !== control.value) setControlValue(control, next);
  }

  function ensurePanel() {
    if (document.getElementById('tmpro-root')) return;
    if (!document.body) return;
    var root = document.createElement('div');
    root.id = 'tmpro-root';
    root.innerHTML = [
      '<button type="button" id="tmpro-launcher">Writing help</button>',
      '<section id="tmpro-panel" hidden>',
      '<button type="button" id="tmpro-close" aria-label="Close">×</button>',
      '<h2>Writing help</h2>',
      '<p>Click a note on the page, then pick what you want. Nothing is saved until you put it in the box.</p>',
      '<div class="tmpro-actions">',
      '<button type="button" data-tmpro-task="draft">Write a comment</button>',
      '<button type="button" data-tmpro-task="clean">Clean up this note</button>',
      '<button type="button" data-tmpro-task="short">Make it shorter</button>',
      '<button type="button" data-tmpro-task="customer">Make it customer-friendly</button>',
      '</div>',
      '<p>Diagnostic help uses only what you type here.</p>',
      '<textarea id="tmpro-symptom" rows="3" spellcheck="true" placeholder="What is the car doing?"></textarea>',
      '<div class="tmpro-actions">',
      '<button type="button" data-tmpro-task="diagnose">Suggest what to check</button>',
      '</div>',
      '<p id="tmpro-status" role="status"></p>',
      '<div id="tmpro-result" aria-live="polite"></div>',
      '<div class="tmpro-actions">',
      '<button type="button" id="tmpro-use" class="tmpro-use">Put this in the note</button>',
      '</div>',
      '</section>'
    ].join('');
    document.body.appendChild(root);

    var launcher = document.getElementById('tmpro-launcher');
    var panel = document.getElementById('tmpro-panel');
    var status = document.getElementById('tmpro-status');
    var result = document.getElementById('tmpro-result');

    launcher.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
    });
    document.getElementById('tmpro-close').addEventListener('click', function () {
      panel.hidden = true;
    });
    panel.addEventListener('mousedown', function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      event.preventDefault();
    });
    panel.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-tmpro-task]') : null;
      if (!button) return;
      runTask(button.getAttribute('data-tmpro-task'), button);
    });
    document.getElementById('tmpro-use').addEventListener('click', function () {
      var suggestion = result.textContent || '';
      if (!suggestion) {
        status.textContent = 'Ask for a suggestion first.';
        return;
      }
      if (!lastField || !document.contains(lastField)) {
        status.textContent = 'Click the note you want to replace, then try again.';
        return;
      }
      setControlValue(lastField, suggestion);
      status.textContent = 'Put the suggestion in the note. Read it before you save.';
    });
  }

  function runTask(task, button) {
    var status = document.getElementById('tmpro-status');
    var result = document.getElementById('tmpro-result');
    var source = task === 'diagnose'
      ? (document.getElementById('tmpro-symptom').value || '')
      : (lastField && typeof lastField.value === 'string' ? lastField.value : '');
    if (task !== 'diagnose' && (!lastField || !document.contains(lastField))) {
      status.textContent = 'Click the note you want help with, then try again.';
      return;
    }
    var built = api.buildPrompt(task, source);
    if (!built.ok) {
      status.textContent = built.message;
      return;
    }
    status.textContent = 'Working...';
    result.textContent = '';
    button.disabled = true;
    chrome.runtime.sendMessage({ type: 'tekmetric-pro-ask', task: task, text: source }, function (response) {
      button.disabled = false;
      var failure = chrome.runtime && chrome.runtime.lastError;
      if (failure) {
        status.textContent = 'The writing helper could not get an answer. Try again.';
        return;
      }
      if (!response || !response.ok) {
        status.textContent = (response && response.message) || 'The writing helper could not get an answer. Try again.';
        return;
      }
      result.textContent = response.text;
      status.textContent = 'Check this before you save it. It is a suggestion, not a diagnosis.';
    });
  }

  function start() {
    injectCss();
    applyTheme();
    ensurePanel();
    scheduleScan();
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () {
        ensurePanel();
        scheduleScan();
      });
    }
    var observer = new MutationObserver(function () {
      scheduleScan();
      ensurePanel();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('input', function (event) {
      var target = event.target;
      if (!target || !event.isTrusted) return;
      var fields = loginFields();
      if (target === fields.email || target === fields.password) loginEdited = true;
    }, true);
    document.addEventListener('focusin', function (event) {
      rememberField(event.target);
    }, true);
    document.addEventListener('focusout', function (event) {
      capitalizeIfNeeded(event.target);
    }, true);
  }

  function loadSettings() {
    return storageGet().then(function (stored) {
      settings = api.normalizeSettings(stored);
      applyTheme();
      scheduleScan();
    });
  }

  try {
    chrome.storage.onChanged.addListener(function () {
      loadSettings();
    });
  } catch (err) {
    /* preview pages can omit storage events */
  }

  start();
  loadSettings();
})();
