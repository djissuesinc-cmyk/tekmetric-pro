# Tekmetric Pro

Local desktop companion for **Craig's Leaside Automotive**. It keeps the day's appointments, repair orders, diagnostic checklists, and work-order PDFs on this computer.

This app is unofficial. It is not made by Tekmetric, it is not affiliated with Tekmetric, and it does not change Tekmetric's servers. Developed by Shawn Bradbury.

## What it does

- Shop dashboard, calendar, and repair orders stored on this computer
- Calendar appointments get a red X through the card when they are marked done
- Spell check and sentence capitalization on notes, after you leave the field
- Offline diagnostic checklist, plus an optional Gemini draft when you ask for one
- Gemini advisor-note drafts that do not replace your note until you use them
- Work-order PDFs with the shop letterhead
- Encrypted Gemini key and optional Tekmetric sign-in
- Update checks in the installed app

## Run it

```bash
npm install
npm start
```

`npm test` runs the local checks (money math, validation, encryption, PDF, security flags).

To build an installer later:

```bash
npm run dist
```

Windows x64 (NSIS setup, portable exe, and a zip of the unpacked app), including a cross-build from Linux:

```bash
npm run dist:win
```

On Linux that cross-build needs Wine, including 32-bit Wine (`wine32`), because the NSIS stub is 32-bit. The installed app itself is 64-bit. The executables are unsigned. Update checks run in that installed build. A source checkout reports that updates are not checked yet, instead of throwing.

## Keys and sign-in

Do not commit secrets. `.env` is gitignored. Copy `.env.example` if you want a local `GEMINI_API_KEY` for development.

Prefer **Settings** in the app. The Gemini key and Tekmetric password are encrypted with the OS keychain when that is available. If the keychain is not available, they are encrypted in the app data folder with a local key file. They are not written into the repository, the shop file, or log lines.

Auto-login only types into `shop.tekmetric.com`, `app.tekmetric.com`, or `login.tekmetric.com` over HTTPS. The Tekmetric window does not receive this app's preload bridge. If the login form is not on the page, nothing is typed.

## Shop details on PDFs

Letterhead defaults to the public shop listing:

Craig's Leaside Automotive  
Unit 10, 25 Commercial Road  
Toronto, ON M4G 1Z4  
416-421-3030  
info@craigsleaside.com

Change them in Settings. Hours shown on the calendar are Monday–Thursday 7:00–4:00 and Friday 7:00–2:00, America/Toronto.

The first launch puts starter jobs on the board so the screens are not empty. Remove them from the dashboard when real work begins. Editing a starter job keeps that job.

## Logo

`assets/logo.svg` is the Craig's Leaside badge. Rebuild it with `npm run logo` if the Pacifico or Liberation Sans files move. Pacifico is used only to generate paths and is licensed under the SIL Open Font License (`assets/fonts/OFL.txt`).
