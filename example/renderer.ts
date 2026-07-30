import type { bridge } from "./generated/ipc-bridge.js";

declare global {
  interface Window {
    ipc: typeof bridge;
  }
}

const greeting = document.querySelector<HTMLParagraphElement>("#greeting")!;
const name = document.querySelector<HTMLInputElement>("#name")!;
const notice = document.querySelector<HTMLInputElement>("#notice")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

greeting.textContent = await window.ipc.greeting.get();

window.ipc.greeting.onGreetingChanged((nextGreeting) => {
  greeting.textContent = nextGreeting;
  status.textContent = "Greeting changed by an event from the main process.";
});

window.ipc.greeting.onNoticeReceived((message) => {
  status.textContent = message;
});

document.querySelector("#set-greeting")!.addEventListener("click", () => {
  window.ipc.greeting.set(name.value);
});

document.querySelector("#send-notice")!.addEventListener("click", () => {
  window.ipc.greeting.notify(notice.value);
});
