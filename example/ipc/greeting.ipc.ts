import { createIpcHelpers, defineIpcModule } from "electron-ipc-module";

type GreetingEvents = {
  "greeting-changed": [greeting: string];
  "notice-received": [message: string];
};

const { handle, listen } = createIpcHelpers<GreetingEvents>();

export function createGreetingIpc() {
  let greeting = "Hello from the main process";

  return defineIpcModule(
    "greeting",
    {
      get: handle(() => greeting),

      set: listen((event, name: string) => {
        greeting = `Hello, ${name.trim() || "Electron"}!`;
        event.sender.send("greeting-changed", greeting);
      }),

      notify: listen((event, message: string) => {
        event.reply("notice-received", `Main received: ${message}`);
      }),
    },
    { eventPrefix: true },
  );
}
