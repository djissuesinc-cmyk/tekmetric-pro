// v2.5.3: Admin / System Settings window HTML. Controls and save behaviour stay the same.
const { escapeHtml } = require('./about-info');

function settingsEditorHtml({ css, header, apiKey, settingsPathLiteral }) {
    const key = escapeHtml(apiKey || '');
    const safePath = settingsPathLiteral;
    return `${css || ''}<body class="sb-body">
            ${header || ''}
            <div class="sb-body-pad">
                <h2 style="text-align:center;margin-top:0">System Settings</h2>
                <div class="sb-panel">
                    <label for="api">Gemini API Key:</label><br>
                    <input type="password" id="api" value="${key}" style="width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 20px; box-sizing: border-box;">
                    <button id="save" style="padding: 10px 20px;">Save Settings</button>
                    <p id="msg" style="color: #4caf50; font-weight: bold; margin-top: 15px;"></p>
                </div>
            </div>
            <script>
                const fs = require('fs');
                document.getElementById('save').onclick = () => {
                    const key = document.getElementById('api').value.trim();
                    try {
                        let set = JSON.parse(fs.readFileSync(${safePath}));
                        set.apiKey = key;
                        fs.writeFileSync(${safePath}, JSON.stringify(set, null, 2));
                        document.getElementById('msg').innerText = 'Settings saved successfully. Close this window to continue.';
                    } catch (e) {
                        document.getElementById('msg').innerText = 'Could not save settings: ' + e.message;
                    }
                };
            </script>
        </body>`;
}

module.exports = { settingsEditorHtml };
