# Tekmetric Pro

Tekmetric Pro is a Windows program for Craig's Leaside Automotive. It opens the Tekmetric shop website in its own window and adds the shop's print button, quick job notes, dark mode, and optional writing help.

It is not made by Tekmetric. You still need your own Tekmetric login.

Developed by Shawn Bradbury.

## Install a copy that is already built

If you were given `Tekmetric-Pro-Setup-2.3.1.exe`:

1. Double-click it.
2. Follow the steps. You can leave the suggested folder.
3. Open **Tekmetric Pro** from the desktop.

If you were given `Tekmetric-Pro-Portable-2.3.1.exe`:

1. Put that file in a folder you will keep, such as `Documents\Tekmetric Pro`.
2. Double-click it. There is nothing else to install.
3. Do not delete the file. That file is the program.

The first time Windows may ask if you trust it. Choose **More info**, then **Run anyway**, if Windows shows a blue warning. That happens because this copy is not sold through the Windows store.

## Use it

The window opens the Tekmetric sign-in page.

- **Shop Admin > Login Selection** types a saved email and password and presses Sign In. Add people with **Shop Admin > Edit User Info**. The list looks like this:

```json
[
  {
    "name": "Alex",
    "email": "alex@shop.com",
    "pass": "the password"
  }
]
```

- Those logins stay on this computer. They are only typed into the Tekmetric sign-in page.
- **Tools > System Settings** is where the Google Gemini key goes. The PIN for settings, user lists, and job presets starts as `leaside`. You can type a new PIN in that same window. Leave the key box blank if a key is already saved.
- You can also put the key in a file named `.env` next to the program:

```text
GEMINI_API_KEY=your-key-here
```

If a key is saved in System Settings, that one is used.

- Highlight a note, right-click, and choose **AI: Fix Spelling & Grammar** or **AI: Make Professional**. If auto-uppercase is on, the suggestion comes back in capital letters, same as before.
- Opening an estimate, work order, invoice, or inspection asks which shop bundle to print.
- Finished appointments and completed jobs still get the X. Paid work still gets the money mark.
- **View > Toggle Dark Mode** is remembered when you move between pages.
- **Shop Admin > Check for Updates** looks for a newer copy. The program does not install an update unless you say yes. A failed check while the program is opening no longer interrupts you.

## Build it on Windows

You only need this if you are making the installer yourself.

1. Install Node.js from [https://nodejs.org](https://nodejs.org) (the LTS version).
2. Unzip this project and open the folder.
3. In that folder, Shift-right-click an empty area and choose **Open in Terminal** (or open Command Prompt there).
4. Run:

```bat
npm install
npm run dist
```

5. When it finishes, open the `dist` folder.
   - `Tekmetric-Pro-Setup-2.3.1.exe` is the installer.
   - `Tekmetric-Pro-Portable-2.3.1.exe` is the single file you can copy to another PC.

To try it without building an installer, run `npm start` after `npm install`.

## What changed from the 2.3.0 shop copy

- A brand-new install no longer creates a login named Admin with the password `password123`. Logins you already saved on this computer are left as they are. Add logins from **Edit User Info**.
- A short list of job presets is no longer replaced by the original long list.
- Dark mode stays on after the page changes.
- The Google key is not shown again after you save it, and it is not written into error messages.
- Settings windows no longer have full access to the computer's files. They can still save the key, the PIN, the user list, and the job presets.
- If the printer does not print, you get a short message instead of silence.
- A customer name the PDF font cannot draw no longer stops the whole print.
- The program still checks for updates, and it still waits for you to agree before downloading or installing one.

## Remove it

If you used the installer, open Windows **Settings > Apps** and uninstall **Tekmetric Pro**.

If you used the portable file, close the program and delete that file. Saved logins and the Google key are in the app's Windows data folder and are not deleted with the portable file. Uninstalling the setup copy removes that data only if Windows removes the app data too. Use **Edit User Info** to clear logins before you remove the program if the computer is shared.
