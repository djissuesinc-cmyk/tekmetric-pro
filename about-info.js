// v2.5.2: About window HTML. Version is passed in (app.getVersion()), never hardcoded.
// v2.5.3: signboard header, colours, and panels. Callers pass css + header from brand.js.
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function aboutHtml(version, opts) {
    const ver = escapeHtml(version);
    let css = '';
    let header = '';
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
        css = opts.css || '';
        header = opts.header || '';
    } else if (typeof opts === 'string') {
        // older (version, logoSrc, cssPrefix) calls still render
        css = arguments[2] || '';
    }
    return `${css}<body class="sb-body">
            ${header}
            <div id="about-scroll" class="sb-body-pad">
                <div class="sb-panel" style="text-align:center;margin-bottom:14px;">
                    <h1 id="about-app-title" style="margin:0;font-family:'Oswald',Impact,sans-serif;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:.04em;text-transform:uppercase;">Tekmetric Pro</h1>
                    <p id="about-version" style="color:#E30613;margin:6px 0 0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Version ${ver}</p>
                </div>
                <div id="about-program" class="sb-panel" style="margin-bottom:14px;">
                    <h2 style="margin:0 0 10px 0;font-size:14px;color:#E30613;">About this program</h2>
                    <p class="sb-secondary" style="margin:0 0 14px 0;font-size:13px;line-height:1.55;">
                        Tekmetric Pro is a desktop app that opens shop.tekmetric.com for Craig's Leaside Automotive.
                        It keeps the shop site in its own window and adds tools used at the counter and in the bay.
                    </p>
                    <h2 style="margin:0 0 8px 0;font-size:14px;color:#E30613;">What it does</h2>
                    <ul id="about-features" class="sb-secondary" style="margin:0 0 16px 0;padding-left:18px;font-size:13px;line-height:1.55;">
                        <li>Quick Actions presets insert jobs into the text box you last clicked. In a multi-line box, each job goes on its own line starting with +.</li>
                        <li>Fill "No Faults" and Clear "No Faults" write or remove inspection finding text.</li>
                        <li>Smart Print can put the shop logo on the invoice header and a faint watermark on invoices and inspections.</li>
                        <li>The printer picker (Shop &gt; Print Settings) remembers which printer this PC should use.</li>
                        <li>Reset Print Spooler (Shop &gt; Print Settings, Windows) clears stuck print jobs and restarts printing. Windows will ask for admin permission.</li>
                        <li>AI writing help: right-click selected text to fix spelling and grammar, or to make the wording more professional.</li>
                        <li>Auto uppercase can capitalize text as you leave a field (View menu).</li>
                        <li>The left shop menu stays open and the hamburger button is hidden, so it is harder to collapse by accident.</li>
                        <li>Updates download in the background and install when you close the app (installed copy only).</li>
                        <li>Dark mode, the Quick Actions panel, and Premium Features view can be turned on or off under View.</li>
                    </ul>
                    <h2 style="margin:0 0 8px 0;font-size:14px;color:#E30613;">Keyboard shortcuts</h2>
                    <ul id="about-shortcuts" class="sb-secondary" style="margin:0;padding-left:18px;font-size:13px;line-height:1.55;">
                        <li>Ctrl+N — New window</li>
                        <li>Ctrl+Alt+N — Fill "No Faults"</li>
                        <li>Ctrl+Alt+C — Clear "No Faults"</li>
                        <li>Alt+Left or the mouse back button — Back</li>
                        <li>Alt+Right or the mouse forward button — Forward</li>
                        <li>Ctrl+= — Zoom in</li>
                        <li>Ctrl+- — Zoom out</li>
                        <li>Ctrl+0 — Reset zoom</li>
                    </ul>
                </div>
                <div class="sb-panel-outline" style="text-align:center;">
                    <p class="sb-muted" style="font-size:12px;margin:0;">
                        Developed by Shawn Bradbury<br>
                        <strong style="color:#f1f2f4;">Craig's Leaside Automotive Inc.</strong>
                    </p>
                    <p style="font-size:12px;color:#E30613;margin:8px 0 4px;letter-spacing:1px;">Parts &middot; Service &middot; Tires</p>
                    <p class="sb-muted" style="font-size:11px;margin:0;line-height:1.6;">416-421-3030 &middot; info@craigsleaside.com<br>craigsleaside.com</p>
                </div>
            </div>
            <div class="sb-footer">
                <strong style="color:#c9cdd4;">LEGAL DISCLAIMER:</strong> This software operates as a standalone container alongside Tekmetric. It does not reflect the views or official software of Tekmetric. Unauthorized distribution or deployment outside of the authorized facility is prohibited.
            </div>
            <div class="sb-actions">
                <button id="about-ack" onclick="window.close()">Acknowledged</button>
            </div>
        </body>`;
}

module.exports = { aboutHtml, escapeHtml };
