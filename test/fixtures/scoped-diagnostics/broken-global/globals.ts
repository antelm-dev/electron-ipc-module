// Contributes a type to the global scope, and is broken. Nothing imports it —
// a global augmentation has no import edge by construction.
declare global {
  type GlobalPayload = { id: string };
}

export const brokenGlobalHelper: string = 42;
