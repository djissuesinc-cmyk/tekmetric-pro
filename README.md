# Tekmetric Pro

Tekmetric Pro is an unofficial add-on for the Tekmetric website. It runs in Chrome or Edge on your shop computer. It does not change Tekmetric's servers, and it is not made by Tekmetric.

You need your own Tekmetric login. Without that account, the website itself will not let you in.

Developed by Shawn Bradbury.

## What it does

- Turns on a dark background for late hours. Appointment colors stay on the appointment boxes.
- Draws an X through an appointment that Tekmetric already shows as arrived, or whose repair order is already finished.
- Checks spelling in notes.
- Capitalizes the start of a sentence after you leave a note.
- Can fill in your Tekmetric email and password on the sign-in page.
- Can ask Google Gemini to clean up a note or suggest what to check. It only does this when you click **Writing help**.

## What it does not do

- It does not download updates by itself. When you want a new copy, replace this folder and load it again.
- It does not send your Tekmetric password anywhere except the Tekmetric sign-in page.
- It does not send a note to Google unless you click a writing button.
- It does not save the suggestion into Tekmetric until you click **Put this in the note** and then save in Tekmetric as you normally would.
- It will only press **Sign In** if you turn that switch on, and only once each visit. Leave that switch off if your shop uses a text-message code.

Your email, password, and Google key stay in this browser on this computer until you click **Forget my login** or replace the saved key. Anyone who can open the browser as you can use the saved login. Use a computer only you use, or do not save the password.

## Install on Windows

You do not need to compile anything. There is no separate installer.

1. Install [Google Chrome](https://www.google.com/chrome/) or use Microsoft Edge. Edge is already on Windows.
2. Download this project and unzip it. Leave the folder somewhere permanent, such as `Documents\Tekmetric Pro`. If you delete the folder, the add-on stops working.
3. Open the browser's add-on page:
   - Chrome: paste `chrome://extensions` into the address bar.
   - Edge: paste `edge://extensions` into the address bar.
4. Turn on **Developer mode**. In Chrome it is a switch on the top right. In Edge it is on the left.
5. Click **Load unpacked**.
6. Choose the `extension` folder inside the unzipped project. Do not choose the outer folder.
7. Click the puzzle-piece icon in the toolbar and pin **Tekmetric Pro**.

## Use it

1. Open [shop.tekmetric.com](https://shop.tekmetric.com/).
2. Click the Tekmetric Pro icon.
3. Turn the switches the way you want. Click **Save**.
4. To save your login, enter your Tekmetric email and password, turn on **Fill these in on the sign-in page**, and click **Save**.
5. For writing help, get a key from [Google AI Studio](https://aistudio.google.com/apikey), paste it in **Google Gemini key**, and click **Save**.
6. On a Tekmetric page, click **Writing help** at the bottom left. Click the note you want help with, then choose an action. Read the suggestion before you save it.

Shops that use the practice site can open sandbox.tekmetric.com. The same add-on works there.

## Update

1. Download the new copy and unzip it.
2. Go back to `chrome://extensions` or `edge://extensions`.
3. Click **Remove** on the old Tekmetric Pro.
4. Click **Load unpacked** and choose the new `extension` folder.
5. Open Tekmetric Pro and click **Save** again if your login box is empty.

## Remove

On the add-on page, click **Remove**. That also clears the saved login and Google key stored by this add-on.

## Check the project on a computer that has Node.js

The checks do not need a Tekmetric login:

```bash
npm test
```
