// Shop branding for the app's internal windows (v2.3.6): Craig's Leaside fonts bundled locally
// (assets/fonts, embedded as base64 so data: URL windows can use them; no CDN) + logo header.
const fs = require('fs');
const path = require('path');
const FONTS = [
    ['Inter', 400, 'inter-latin-400-normal.woff2'],
    ['Inter', 600, 'inter-latin-600-normal.woff2'],
    ['Oswald', 600, 'oswald-latin-600-normal.woff2']
];
let cssCache = null;
function brandCss() {
    if (cssCache !== null) return cssCache;
    let faces = '';
    for (const [fam, w, f] of FONTS) {
        try {
            const b64 = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', f)).toString('base64');
            faces += `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
        } catch (e) { /* font missing: fall back to system fonts */ }
    }
    cssCache = `<style>${faces}
body{font-family:'Inter','Segoe UI',Arial,sans-serif !important;}
h1,h2,h3,button{font-family:'Oswald','Segoe UI',Impact,sans-serif !important;letter-spacing:.04em;text-transform:uppercase;font-weight:600;}
button{background:#E30613 !important;border-radius:4px;}
button:hover{filter:brightness(1.1);}
input:focus,textarea:focus{outline:1px solid #E30613;}
.brand-hdr{text-align:center;margin:0 0 10px;}
.brand-hdr img{height:56px;}
</style>`;
    return cssCache;
}
// Small logo header (logo-small.png falls back to logo.png)
function brandHeader(height = 56) {
    for (const n of ['logo-small.png', 'logo.png']) {
        try {
            const b64 = fs.readFileSync(path.join(__dirname, n)).toString('base64');
            return `<div class="brand-hdr"><img src="data:image/png;base64,${b64}" style="height:${height}px"></div>`;
        } catch (e) {}
    }
    return '';
}
module.exports = { brandCss, brandHeader };
