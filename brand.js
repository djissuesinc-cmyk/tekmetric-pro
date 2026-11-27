// Shop branding for the app's internal windows (v2.3.6+): Craig's Leaside fonts bundled locally
// (assets/fonts, embedded as base64 so data: URL windows can use them; no CDN) + logo header.
// v2.3.9: always light text on dark backgrounds so headings/labels stay readable in dark mode.
// v2.5.3: signboard colours, Oswald/Inter weights, and a header bar (logo + shop name + tagline)
// for About and Admin Settings. Other admin windows still use brandCss/brandHeader.
const fs = require('fs');
const path = require('path');
const FONTS = [
    ['Inter', 400, 'inter-latin-400-normal.woff2'],
    ['Inter', 500, 'inter-latin-500-normal.woff2'],
    ['Inter', 600, 'inter-latin-600-normal.woff2'],
    ['Inter', 700, 'inter-latin-700-normal.woff2'],
    ['Oswald', 600, 'oswald-latin-600-normal.woff2'],
    ['Oswald', 700, 'oswald-latin-700-normal.woff2']
];

function fontFaceCss() {
    let faces = '';
    for (const [fam, w, f] of FONTS) {
        try {
            const b64 = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', f)).toString('base64');
            faces += `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
        } catch (e) { /* font missing: fall back to system fonts */ }
    }
    return faces;
}

let cssCache = null;
function brandCss() {
    if (cssCache !== null) return cssCache;
    cssCache = `<style>${fontFaceCss()}
html,body{background:#121212 !important;color:#e8e8e8 !important;font-family:'Inter','Segoe UI',Arial,sans-serif !important;}
h1,h2,h3,h4,h5,label,p,span,div,li,td,th{color:#e8e8e8 !important;}
h1,h2,h3,button{font-family:'Oswald','Segoe UI',Impact,sans-serif !important;letter-spacing:.04em;text-transform:uppercase;font-weight:600;}
button{background:#E30613 !important;color:#ffffff !important;border:none;border-radius:4px;}
button:hover{filter:brightness(1.1);}
input,textarea,select{background:#222 !important;color:#ffffff !important;border:1px solid #555 !important;}
input:focus,textarea:focus,select:focus{outline:1px solid #E30613;}
a{color:#ef5350;}
.brand-hdr{text-align:center;margin:0 0 10px;}
.brand-hdr img{height:56px;}
</style>`;
    return cssCache;
}

function brandHeader(height = 56) {
    for (const n of ['logo-small.png', 'logo.png']) {
        try {
            const b64 = fs.readFileSync(path.join(__dirname, n)).toString('base64');
            return `<div class="brand-hdr"><img src="data:image/png;base64,${b64}" style="height:${height}px"></div>`;
        } catch (e) {}
    }
    return '';
}

let badgeCache = null;
function badgeDataUrl() {
    if (badgeCache !== null) return badgeCache;
    try {
        badgeCache = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'logo-transparent-300.png')).toString('base64');
    } catch (e) {
        badgeCache = '';
    }
    return badgeCache;
}

let signCssCache = null;
function signboardCss() {
    if (signCssCache !== null) return signCssCache;
    signCssCache = `<style>${fontFaceCss()}
html,body{margin:0;padding:0;background:#0d0e11;color:#f1f2f4;font-family:'Inter','Segoe UI',Arial,sans-serif;}
body.sb-body{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:#0d0e11;color:#f1f2f4;}
h2,h3{font-family:'Oswald',Impact,sans-serif;text-transform:uppercase;letter-spacing:.04em;font-weight:600;color:#f1f2f4;margin:0 0 12px 0;}
button{background:#E30613;color:#ffffff;border:none;border-radius:4px;font-family:'Oswald',Impact,sans-serif;text-transform:uppercase;letter-spacing:.04em;font-weight:600;cursor:pointer;}
button:hover{filter:brightness(1.1);}
input,textarea,select{background:#1e2027;color:#f1f2f4;border:1px solid #3a3d46;border-radius:4px;font-family:'Inter','Segoe UI',Arial,sans-serif;}
input:focus,textarea:focus,select:focus{outline:1px solid #E30613;}
a{color:#E30613;}
label{color:#c9cdd4;font-size:13px;}
.sb-header{flex-shrink:0;display:flex;align-items:center;gap:14px;padding:10px 18px;background:linear-gradient(#1b1c22,#121318);border-bottom:3px solid #E30613;}
.sb-logo{height:52px;width:auto;display:block;flex-shrink:0;}
.sb-brand{min-width:0;}
.sb-name{font-family:'Oswald',Impact,sans-serif;font-weight:700;font-size:20px;line-height:1.05;margin:0;color:#ffffff;text-transform:uppercase;letter-spacing:.04em;}
.sb-name span{color:#e62429;}
.sb-tagline{font-family:'Inter','Segoe UI',Arial,sans-serif;font-weight:600;font-size:10px;color:#9aa0aa;letter-spacing:.3em;text-transform:uppercase;margin:5px 0 0 0;}
.sb-body-pad{flex:1;min-height:0;overflow:auto;padding:18px 20px 16px 20px;}
.sb-panel{background:#17181d;border-radius:10px;padding:16px 18px;border-left:4px solid #E30613;box-shadow:0 0 0 1px rgba(227,6,19,.08);}
.sb-panel-outline{background:#1e2027;border-radius:10px;padding:14px 16px;border:2px solid #E30613;}
.sb-muted{color:#9aa0aa;}
.sb-secondary{color:#c9cdd4;}
.sb-footer{flex-shrink:0;background:#121318;padding:14px 20px 10px 20px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:#9aa0aa;text-align:justify;line-height:1.4;}
.sb-actions{flex-shrink:0;background:#121318;padding:0 20px 18px 20px;text-align:center;}
.sb-actions button{padding:10px 30px;font-size:13px;}
</style>`;
    return signCssCache;
}

function signboardHeader() {
    const src = badgeDataUrl();
    const img = src
        ? `<img id="signboard-logo" class="sb-logo" src="${src}" alt="Craig's Leaside Automotive">`
        : '';
    return `<header id="signboard-header" class="sb-header">
    ${img}
    <div class="sb-brand">
      <h1 class="sb-name">Craig's <span>Leaside</span> Automotive</h1>
      <p class="sb-tagline">Parts &middot; Service &middot; Tires</p>
    </div>
  </header>`;
}

module.exports = { brandCss, brandHeader, signboardCss, signboardHeader, badgeDataUrl };
