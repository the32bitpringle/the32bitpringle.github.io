# Celere Web Clipper

Manifest V3 extension that extracts readable text from the active browser tab and sends it to the Celere web app.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked** and select this `extension` directory.
4. Open the extension settings and set the Celere app URL if you are using a local dev server.

Default app URL: `https://the32bitpringle.github.io/celere-2/`

For local development use `http://localhost:5173/celere-2/` when Vite is running with the configured base path.

## How It Works

- The popup asks the background worker to inspect the active tab.
- `src/extractor.js` prefers selected text, then scores visible article/main/body text blocks while ignoring navigation, comments, forms, and hidden content.
- The background worker opens Celere and injects `src/celere-bridge.js`.
- The bridge uses Celere's import dialog, fills the title and text fields, and submits the import.

The extension does not bypass paywalls, DRM, sign-in screens, or browser-restricted pages. It only extracts text visible in the current tab.
