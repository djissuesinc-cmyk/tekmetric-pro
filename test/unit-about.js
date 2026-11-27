// v2.5.3: About window HTML + signboard header. Run: node test/unit-about.js
const assert = require('assert');
const { aboutHtml } = require('../about-info');
const { signboardCss, signboardHeader, badgeDataUrl } = require('../brand');

const header = signboardHeader();
const css = signboardCss();
const html = aboutHtml('2.5.3', { css, header });
assert(/id="about-version"[^>]*>Version 2\.5\.3</.test(html), 'version string missing or hardcoded wrongly');
assert(html.includes('id="about-program"'), 'program section missing');
assert(html.includes('shop.tekmetric.com'), 'should say it opens shop.tekmetric.com');
assert(html.includes("Craig's Leaside Automotive"), 'shop name missing');
assert(html.includes('id="about-features"'), 'features list missing');
assert(html.includes('Quick Actions'), 'Quick Actions missing');
assert(html.includes('No Faults'), 'No Faults missing');
assert(html.includes('Smart Print') || html.includes('invoice header'), 'print branding missing');
assert(html.includes('Reset Print Spooler'), 'spooler reset missing from About');
assert(html.includes('printer picker') || html.includes('Print Settings'), 'printer picker missing');
assert(/AI writing help/i.test(html), 'AI help missing');
assert(/auto uppercase/i.test(html), 'auto caps missing');
assert(/left shop menu stays open/i.test(html), 'nav lock missing');
assert(/install when you close the app/i.test(html), 'auto update missing');
assert(html.includes('id="about-shortcuts"'), 'shortcuts missing');
assert(html.includes('Ctrl+Alt+N') && html.includes('Ctrl+Alt+C'), 'No Faults shortcuts missing');
assert(html.includes('Alt+Left') && html.includes('Ctrl+N') && html.includes('Ctrl+0'), 'nav/zoom shortcuts missing');
assert(/id="about-scroll"[^>]*class="sb-body-pad"/.test(html) || /id="about-scroll"/.test(html), 'scroll region missing');
assert(!/brake fluid flush/i.test(html), 'must not mention brake fluid flushes');
const banned = ['ensure', 'crucial', 'vital', 'enhancing', 'seamless', 'journey', 'elevate', 'unlock', 'discover', 'blend'];
const lower = html.toLowerCase();
for (const w of banned) {
  const re = new RegExp('\\b' + w + '\\b', 'i');
  assert(!re.test(lower), 'banned word: ' + w);
}

assert(html.includes('id="signboard-header"'), 'signboard header missing');
assert(/Craig's\s+<span>Leaside<\/span>\s+Automotive/.test(header), 'LEASIDE span missing in header');
assert(/Parts\s*&middot;\s*Service\s*&middot;\s*Tires/.test(header), 'tagline missing');
assert(html.includes('id="signboard-logo"'), 'badge logo missing');
assert(html.includes(badgeDataUrl().slice(0, 40)), 'logo should be a data URI');
assert(/@font-face\{font-family:'Oswald';font-weight:700/.test(css), 'Oswald 700 missing');
assert(/@font-face\{font-family:'Oswald';font-weight:600/.test(css), 'Oswald 600 missing');
assert(/@font-face\{font-family:'Inter';font-weight:400/.test(css), 'Inter 400 missing');
assert(/@font-face\{font-family:'Inter';font-weight:700/.test(css), 'Inter 700 missing');
assert(css.includes('#0d0e11') && css.includes('#E30613') && css.includes('#e62429') || header.includes('#e62429') || css.includes('#e62429'), 'signboard colours missing');
assert(css.includes('#17181d') && css.includes('linear-gradient(#1b1c22,#121318)') && css.includes('border-bottom:3px solid #E30613'), 'header/panel colours missing');

const escaped = aboutHtml('<2.5.3>', { css: '', header: '' });
assert(escaped.includes('Version &lt;2.5.3&gt;'), 'version must be escaped');
assert(!escaped.includes('Version <2.5.3>'), 'raw version brackets leaked');
console.log('ABOUT UNIT OK');
