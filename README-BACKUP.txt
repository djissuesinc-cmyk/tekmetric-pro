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


QUICK JOBS INSERT (v2.5.2)
  Clicking a Quick Actions preset (sidebar or Edit > Insert) writes into the last text box you clicked.
  In a textarea each job is a new line starting with "+ ". Combined presets such as
  "LOF, 30 POINT INSPECTION + BRAKE INSPECTION" are split on commas and pluses, except
  inside parentheses (the Level 2 / 3 Scan item stays one line). Single-line inputs still
  join with " + " because they cannot hold newlines.

ABOUT WINDOW (v2.5.2 / v2.5.3)
  Help > About System shows the current app version, what Tekmetric Pro is, a short list
  of what it does, and the keyboard shortcuts.
  v2.5.3: the About window and Shop > Admin > System Settings use the shop signboard
  look (badge logo, "CRAIG'S LEASIDE AUTOMOTIVE" with Leaside in red, tagline, charcoal
  panels with a red trim). Fonts (Oswald and Inter, SIL OFL) live in assets/fonts and
  are embedded so the windows work offline.

RESET PRINT SPOOLER (v2.5.2)
  Shop > Print Settings > Reset Print Spooler... (Windows only). Confirms first, then
  asks Windows for admin permission, stops the spooler, clears stuck jobs, and starts it
  again. The result is written to the PDF log.

BUG REPORTS (v2.5.4)
  Help > About System has an experimental-software notice and a Create Bug Report
  button. The report is a zip in Downloads with a redacted log excerpt for the time
  you pick, a short info file, and any crash dumps from that window. It never includes
  settings.json, users.json, .env, API keys, cookies, or passwords. A mailto window
  opens to shawn@craigsleaside.com; attach the zip before you send it.

  The https interceptor (used to stamp print PDFs) now passes other traffic through
  with cookies, Origin, and POST bodies intact, so ProDemand labor guides and
  PartsTech parts lookup are not broken by the stamp hook. Failed requests (status
  400 or higher, or a network error) are written to the PDF log as host + path only.

TESTS (developer)
  node test/unit-ai.js
  node test/unit-printer.js
  node test/unit-inject.js
  node test/unit-about.js
  node test/unit-spooler.js
  node test/unit-settings.js
  xvfb-run -a npx electron test/e2e-ai.js | e2e-ai-menu.js | e2e-printer.js | e2e-inject.js | e2e-about.js | e2e-admin.js | e2e-intercept-headers.js
  node test/unit-phrases.js
  node test/unit-inspection.js
  node test/unit-intercept.js
  node test/unit-nav-fetch.js
  node test/unit-bug-report.js
