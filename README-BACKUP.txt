TEKMETRIC PRO - FULL SOURCE BACKUP (version 2.3.8)
==================================================

This zip has all of the app's source code and the GitHub build setup.
It does NOT include your .env file or Gemini API key. Keep those somewhere safe yourself.

RESTORE OR SET UP ON A NEW PC
1. Install GitHub Desktop and sign in as djissuesinc-cmyk.
2. File > Clone repository > djissuesinc-cmyk/tekmetric-pro  (or unzip this into an empty folder).
3. If you unzipped this into your repo folder (C:\tekpro-repo), commit and push it in GitHub Desktop.

RELEASE AN UPDATE TO ALL SHOP PCs
1. Make your changes.
2. Open package.json and raise "version" (for example 2.3.8 -> 2.3.9).
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
