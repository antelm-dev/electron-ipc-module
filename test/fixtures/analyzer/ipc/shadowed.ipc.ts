function defineIpcModule(prefix: string, channels: Record<string, unknown>) {
  return { prefix, channels };
}

export const createShadowedIpc = defineIpcModule("shadowed", {
  ping: { kind: "handler", fn: async () => "nope" },
});
