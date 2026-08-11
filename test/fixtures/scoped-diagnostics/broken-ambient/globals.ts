// Broken, and reachable by no edge whatsoever: no import, and no triple-slash
// reference points here either. It is in the program because the tsconfig
// includes it, and its `declare global` applies program-wide regardless.
declare global {
  type AmbientPayload = { id: string };
}

export const brokenAmbientHelper: string = 42;
