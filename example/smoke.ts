import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

import { createIpcContainer } from "electron-ipc-module";
import { createGreetingIpc } from "./ipc/greeting.ipc.js";

/**
 * Drives the generated bridge from inside a real renderer.
 *
 * `executeJavaScript` is deliberately the transport for the result: it travels
 * over Chromium's debugger channel rather than over IPC, so the mechanism under
 * test is not also the mechanism reporting whether it worked. Every assertion
 * is bounded by a timeout, because the interesting failure — a channel name the
 * generator and the runtime disagree on — presents as silence, not as an error.
 */
const DRIVE_BRIDGE = `(async () => {
  const withTimeout = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("timed out waiting for " + label)), 5000);
      }),
    ]);

  const greeting = await withTimeout(window.ipc.greeting.get(), "greeting:get");

  const changed = withTimeout(
    new Promise((resolve) => window.ipc.greeting.onceGreetingChanged(resolve)),
    "the greeting-changed event",
  );
  window.ipc.greeting.set("Ada");

  const notice = withTimeout(
    new Promise((resolve) => window.ipc.greeting.onceNoticeReceived(resolve)),
    "the notice-received event",
  );
  window.ipc.greeting.notify("ping");

  return {
    greeting,
    changed: await changed,
    notice: await notice,
    afterSet: await withTimeout(window.ipc.greeting.get(), "greeting:get after set"),
  };
})()`;

/** What `ipc/greeting.ipc.ts` should produce for the calls above. */
const EXPECTED: Record<string, string> = {
  // invoke, through ipcMain.handle
  greeting: "Hello from the main process",
  // send -> ipcMain.on -> event.sender.send, with eventPrefix applied
  changed: "Hello, Ada!",
  // send -> ipcMain.on -> event.reply, with eventPrefix applied
  notice: "Main received: ping",
  // the handler observes state the listener mutated, so both reached main
  afterSet: "Hello, Ada!",
};

async function run() {
  const ipc = createIpcContainer();
  await ipc.load("greeting", createGreetingIpc());

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });

  await window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
  const actual = (await window.webContents.executeJavaScript(DRIVE_BRIDGE)) as Record<
    string,
    unknown
  >;

  await ipc.dispose();

  const failures = Object.entries(EXPECTED).filter(([key, expected]) => actual[key] !== expected);
  for (const [key, expected] of failures) {
    console.error(
      `  ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Bridge smoke test failed ${failures.length} of ${Object.keys(EXPECTED).length} assertions`,
    );
  }

  console.info(`Bridge smoke test passed ${Object.keys(EXPECTED).length} assertions`);
}

app
  .whenReady()
  .then(run)
  .then(
    () => app.exit(0),
    (error: unknown) => {
      console.error(error);
      app.exit(1);
    },
  );
