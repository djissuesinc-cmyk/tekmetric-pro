// v2.5.3: Admin Settings HTML keeps the same controls. Run: node test/unit-settings.js
const assert = require('assert');
const { settingsEditorHtml } = require('../settings-html');
const { signboardCss, signboardHeader } = require('../brand');

const html = settingsEditorHtml({
  css: signboardCss(),
  header: signboardHeader(),
  apiKey: 'not-a-real-key"onclick=1',
  settingsPathLiteral: JSON.stringify('/tmp/tekpro-fake-settings.json')
});
assert(html.includes('id="signboard-header"'), 'header missing');
assert(html.includes('id="signboard-logo"'), 'logo missing');
assert(/Craig's\s+<span>Leaside<\/span>\s+Automotive/.test(html), 'shop name missing');
assert(/Parts\s*&middot;\s*Service\s*&middot;\s*Tires/.test(html), 'tagline missing');
assert(html.includes('System Settings'), 'title missing');
assert(/<label[^>]*>Gemini API Key:<\/label>/.test(html), 'API key label missing');
assert(html.includes('id="api"') && html.includes('type="password"'), 'password input missing');
assert(html.includes('id="save"') && html.includes('Save Settings'), 'save button missing');
assert(html.includes('id="msg"'), 'status message missing');
assert(html.includes('not-a-real-key&quot;onclick=1'), 'api key must be escaped into the value');
assert(!html.includes('not-a-real-key"onclick=1'), 'raw api key quote leaked');
assert(html.includes('fs.readFileSync("/tmp/tekpro-fake-settings.json")'), 'save path missing');
assert(html.includes('set.apiKey = key'), 'save must still write apiKey');
assert(html.includes('Settings saved successfully. Close this window to continue.'), 'success copy changed');
assert(/@font-face\{font-family:'Oswald';font-weight:700/.test(html), 'Oswald 700 not embedded');
assert(/@font-face\{font-family:'Inter';font-weight:400/.test(html), 'Inter 400 not embedded');
console.log('SETTINGS UNIT OK');
