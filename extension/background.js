importScripts('shared.js');

var api = globalThis.TekmetricPro;

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || message.type !== 'tekmetric-pro-ask') return;

  chrome.storage.local.get(null, function (stored) {
    api.askGemini(stored || {}, message.task, message.text, fetch).then(sendResponse).catch(function () {
      sendResponse({
        ok: false,
        message: 'The writing helper could not get an answer. Try again.'
      });
    });
  });

  return true;
});
