# Basic Electron example

This is a minimal Electron application with one typed IPC module. It demonstrates:

- `ipcRenderer.invoke` through `window.ipc.greeting.get()`
- fire-and-forget renderer-to-main messages through `set()` and `notify()`
- typed main-to-renderer events with `event.sender.send()` and `event.reply()`
- a generated, context-isolated preload bridge

From this directory, install dependencies and start the application:

```bash
pnpm install
pnpm start
```

`pnpm start` first generates `generated/ipc-bridge.ts`, compiles the TypeScript files into `dist/`, and opens Electron. The generated bridge is committed so its type-safe API is easy to inspect; regenerate it after changing `ipc/greeting.ipc.ts`.
