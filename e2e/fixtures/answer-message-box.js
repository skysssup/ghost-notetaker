'use strict';

// Loaded with NODE_OPTIONS=--require before the app's main script so startup
// prompts (unreadable notes file, fatal startup error) can be answered without
// a person. Records each prompt to GHOST_E2E_MESSAGE_LOG and answers message
// boxes with GHOST_E2E_MESSAGE_RESPONSE (button index).
const fs = require('fs');

// The built-in 'electron' module only resolves once Electron has finished its
// own startup, which is after --require preloads run.
process.nextTick(() => {
  const { dialog } = require('electron');
  dialog.showMessageBox = async (...args) => {
    const options = args.find((a) => a && typeof a === 'object' && 'message' in a) || {};
    if (process.env.GHOST_E2E_MESSAGE_LOG) {
      fs.appendFileSync(
        process.env.GHOST_E2E_MESSAGE_LOG,
        `${JSON.stringify({ message: options.message, buttons: options.buttons })}\n`
      );
    }
    return { response: Number(process.env.GHOST_E2E_MESSAGE_RESPONSE || 0), checkboxChecked: false };
  };
  dialog.showErrorBox = (title, content) => {
    if (process.env.GHOST_E2E_MESSAGE_LOG) {
      fs.appendFileSync(process.env.GHOST_E2E_MESSAGE_LOG, `${JSON.stringify({ errorBox: title, content })}\n`);
    }
  };
});
