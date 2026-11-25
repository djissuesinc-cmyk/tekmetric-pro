TEKMETRIC PRO - FULL SOURCE BACKUP (version 2.4.5)
==================================================

This zip has all of the app's source code and the GitHub build setup.
It does NOT include your .env file or Gemini API key. Keep those somewhere safe yourself.

RESTORE OR SET UP ON A NEW PC
1. Install GitHub Desktop and sign in as djissuesinc-cmyk.
2. File > Clone repository > djissuesinc-cmyk/tekmetric-pro  (or unzip this into an empty folder).
3. If you unzipped this into your repo folder (C:\tekpro-repo), commit and push it in GitHub Desktop.

RELEASE AN UPDATE TO ALL SHOP PCs
1. Make your changes.
2. Open package.json and raise "version" (for example 2.4.5 -> 2.4.6).
3. GitHub Desktop: type a Summary > Commit to main > Push origin.
4. GitHub builds the installer by itself (takes about 3 minutes, under the Actions tab).
5. Every installed PC finds the update on startup and installs it when the app closes.

NEW SHOP PC
Install Tekmetric-Pro-Setup-<version>.exe from:
https://github.com/djissuesinc-cmyk/tekmetric-pro/releases
(The portable exe does not auto-update. Use the Setup installer.)

BUILD LOCALLY (optional, needs Node.js 20)
  npm ci
  npm start        (runs the app)
  npm run dist     (builds the installer into the dist folder)

LOGS
  %APPDATA%\tekmetric-pro-app\pdf-stamp.log   (or Help > Troubleshooting > Open PDF Log in the app)

INSPECTION "NO FAULTS" WORDING (2.4.5)
  Quick Actions > Fill "No Faults" (Ctrl+Alt+N) fills each inspection finding box
  (the box with placeholder "Enter finding") with item-specific wording,
  and rates every task green via Rate All Tasks. Empty rows with "Add findings"
  are opened first.
  It will not click, focus, or type in Customer Concerns (Add Concern, concern rows)
  or the top Search box.
  It rates every task
  green via Rate All Tasks (including a MUI-style dropdown) or each row's green check,
  and writes item-specific wording in each empty Findings field, e.g.
  "No warning lights are illuminated on the dashboard."
  The wording lives in inspection-phrases.js (one line per item). Edit the text there to change it.
  Items it doesn't recognise still get "No faults found at this time."
  Clear "No Faults" (Ctrl+Alt+C) only removes text the button wrote, never edited text.
  Each fill writes what it found to the PDF log (Help > Troubleshooting > Open PDF Log),
  lines starting "no-faults". If something does not fill, the log includes a short snippet
  of the row and of whatever appeared after "Add finding" was clicked.

AI (right-click: Fix Spelling & Grammar / Make Professional)  v2.5.0
  Code: ai-request.js (request, retries, fallback models), ai-insert.js (puts the answer back in the field).
  Model order: gemini-3.5-flash-lite, then gemini-3.8-flash, then gemini-2.5-flash-lite (edit DEFAULT_MODELS).
  Each request is logged in the PDF log as "ai#N model=... status=... NNNms" (never the key or the text).
  Key: Shop > Admin > System Settings (or GEMINI_API_KEY in .env, which is never committed).

PRINTER (v2.5.0)
  Shop > Print Settings > Printer. Saved per PC in settings.json as printerName ('' = System default).
  Silent prints (Smart Print, inspection print, silent PDF) pass it as deviceName; a missing printer falls back to default.
  The log line "printer=..." shows which one was used.

TESTS (developer)
  node test/unit-ai.js
  node test/unit-printer.js
  xvfb-run -a npx electron test/e2e-ai.js | e2e-ai-menu.js | e2e-printer.js
  node test/unit-phrases.js
  node test/unit-inspection.js
  node test/unit-intercept.js
