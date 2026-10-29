(function () {
  'use strict';

  var api = globalThis.TekmetricPro;
  var fields = ['darkMode', 'spellcheck', 'autoCapitalize', 'crossOutDone', 'autoFillLogin', 'autoPressSignIn'];
  var savedPassword = '';
  var savedKey = '';

  function storageGet() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(null, function (items) {
        resolve(items || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(values, function () {
        resolve();
      });
    });
  }

  function show(text) {
    document.getElementById('message').textContent = text;
  }

  function syncPressSwitch() {
    var press = document.getElementById('autoPressSignIn');
    var fill = document.getElementById('autoFillLogin');
    press.disabled = !fill.checked;
    if (!fill.checked) press.checked = false;
  }

  function fillForm(settings) {
    fields.forEach(function (name) {
      document.getElementById(name).checked = settings[name] === true;
    });
    document.getElementById('email').value = settings.email || '';
    document.getElementById('password').value = '';
    document.getElementById('geminiApiKey').value = '';
    savedPassword = settings.password || '';
    savedKey = settings.geminiApiKey || '';
    document.getElementById('password').placeholder = savedPassword ? 'Saved on this computer' : '';
    document.getElementById('geminiApiKey').placeholder = savedKey ? 'Saved on this computer' : '';
    syncPressSwitch();
  }

  document.getElementById('autoFillLogin').addEventListener('change', syncPressSwitch);

  document.getElementById('save').addEventListener('click', function () {
    var email = document.getElementById('email').value.trim();
    var typedPassword = document.getElementById('password').value;
    var typedKey = document.getElementById('geminiApiKey').value.trim();
    var fill = document.getElementById('autoFillLogin').checked;
    if (fill && !email) {
      show('Enter the email you use for Tekmetric.');
      return;
    }
    if (fill && !typedPassword && !savedPassword) {
      show('Enter the password you use for Tekmetric.');
      return;
    }
    if (email && email.indexOf('@') === -1) {
      show('That email does not look complete.');
      return;
    }
    var next = api.normalizeSettings({
      darkMode: document.getElementById('darkMode').checked,
      spellcheck: document.getElementById('spellcheck').checked,
      autoCapitalize: document.getElementById('autoCapitalize').checked,
      crossOutDone: document.getElementById('crossOutDone').checked,
      autoFillLogin: fill,
      autoPressSignIn: document.getElementById('autoPressSignIn').checked,
      email: email,
      password: fill ? (typedPassword || savedPassword) : '',
      geminiApiKey: typedKey || savedKey
    });
    storageSet(next).then(function () {
      savedPassword = next.password;
      savedKey = next.geminiApiKey;
      document.getElementById('password').value = '';
      document.getElementById('geminiApiKey').value = '';
      document.getElementById('password').placeholder = savedPassword ? 'Saved on this computer' : '';
      document.getElementById('geminiApiKey').placeholder = savedKey ? 'Saved on this computer' : '';
      document.getElementById('autoFillLogin').checked = next.autoFillLogin;
      document.getElementById('autoPressSignIn').checked = next.autoPressSignIn;
      syncPressSwitch();
      show('Saved on this computer.');
    });
  });

  document.getElementById('forget').addEventListener('click', function () {
    storageGet().then(function (stored) {
      var next = api.normalizeSettings(stored);
      next.email = '';
      next.password = '';
      next.autoFillLogin = false;
      next.autoPressSignIn = false;
      return storageSet(next);
    }).then(function () {
      savedPassword = '';
      document.getElementById('email').value = '';
      document.getElementById('password').value = '';
      document.getElementById('password').placeholder = '';
      document.getElementById('autoFillLogin').checked = false;
      document.getElementById('autoPressSignIn').checked = false;
      syncPressSwitch();
      show('Login forgotten on this computer. The Google key is still saved.');
    });
  });

  var version = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '1.0.0';
  document.getElementById('version').textContent = version;

  storageGet().then(function (stored) {
    fillForm(api.normalizeSettings(stored));
  });
})();
