/**
 * Type-level tests for `Serializable` and the cloneability constraint.
 *
 * Checked by `pnpm run typecheck`, not executed by vitest (which only collects
 * `*.test.ts`). Negative cases use `@ts-expect-error`, which fails the build if
 * the error it claims stops happening.
 */
import { createIpcHelpers, defineIpcModule } from "../../src/runtime/ipc-module.js";
import type { IpcUncloneable, Serializable } from "../../src/shared/types/runtime.js";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type IsUncloneable<T> = Serializable<T> extends IpcUncloneable<unknown> ? true : false;

const { handle, listen } = createIpcHelpers();

// --- values that survive unchanged -----------------------------------------

type _primitives = Expect<Equal<Serializable<string>, string>>;
type _bigint = Expect<Equal<Serializable<bigint>, bigint>>;
type _date = Expect<Equal<Serializable<Date>, Date>>;
type _regexp = Expect<Equal<Serializable<RegExp>, RegExp>>;
type _plainObject = Expect<Equal<Serializable<{ id: string }>, { id: string }>>;
type _tupleLabels = Expect<Equal<Serializable<[name: string]>, [name: string]>>;
type _nestedMap = Expect<Equal<Serializable<Map<string, Set<number>>>, Map<string, Set<number>>>>;
type _emptyObject = Expect<Equal<Serializable<{}>, {}>>;
type _any = Expect<Equal<Serializable<any>, any>>;

// A class carrying only data survives, but loses its nominal identity: the
// renderer receives a plain object, so `instanceof` is false there.
declare class DataOnly {
  id: string;
  count: number;
}
type _classData = Expect<Equal<Serializable<DataOnly>, { id: string; count: number }>>;

// --- #20: Buffer and built-in subclasses ------------------------------------

// Electron delivers Buffer as Uint8Array, so Buffer-only methods must be gone.
type _bufferOut = Expect<Equal<Serializable<Buffer>, Uint8Array>>;
type _bufferIn = Expect<Equal<Serializable<[data: Buffer]>, [data: Uint8Array]>>;
type _bufferNested = Expect<
  Equal<Serializable<{ file: { bytes: Buffer } }>, { file: { bytes: Uint8Array } }>
>;
type _bufferInArray = Expect<Equal<Serializable<Buffer[]>, Uint8Array[]>>;

declare const received: Serializable<Buffer>;
// @ts-expect-error - readUInt32LE is a Buffer method and does not cross IPC
received.readUInt32LE(0);

// A plain Uint8Array is untouched.
type _uint8 = Expect<Equal<Serializable<Uint8Array>, Uint8Array>>;

// Custom Error subclasses arrive as a plain Error: no added fields, no methods.
declare class HttpError extends Error {
  status: number;
  isRetryable(): boolean;
}
type _errorSubclass = Expect<Equal<Serializable<HttpError>, Error>>;

declare const failure: Serializable<HttpError>;
void failure.message;
// @ts-expect-error - a custom Error field does not survive structured clone
void failure.status;
// @ts-expect-error - a custom Error method does not survive structured clone
failure.isRetryable();

// --- #21: an uncloneable member invalidates the whole payload ---------------

type _function = Expect<Equal<IsUncloneable<{ id: string; run: () => void }>, true>>;
type _symbol = Expect<Equal<IsUncloneable<{ id: string; tag: symbol }>, true>>;
type _promise = Expect<Equal<IsUncloneable<{ id: string; pending: Promise<string> }>, true>>;
type _weakMap = Expect<Equal<IsUncloneable<{ id: string; cache: WeakMap<object, string> }>, true>>;
type _weakSet = Expect<Equal<IsUncloneable<{ id: string; seen: WeakSet<object> }>, true>>;
type _bareFunction = Expect<Equal<IsUncloneable<() => void>, true>>;

// The container is invalid, not just the offending member. Before this, the
// mapped type produced `{ id: string; run: never }` and left `id` readable.
declare const poisoned: Serializable<{ id: string; run: () => void }>;
// @ts-expect-error - the whole payload is rejected, so `id` is unreachable
void poisoned.id;

// Nested failures propagate out of every container.
type _inArray = Expect<Equal<IsUncloneable<{ id: string; run: () => void }[]>, true>>;
type _inTuple = Expect<Equal<IsUncloneable<[ok: string, bad: () => void]>, true>>;
type _inMapValue = Expect<Equal<IsUncloneable<Map<string, () => void>>, true>>;
type _inMapKey = Expect<Equal<IsUncloneable<Map<() => void, string>>, true>>;
type _inSet = Expect<Equal<IsUncloneable<Set<symbol>>, true>>;
type _deeplyNested = Expect<Equal<IsUncloneable<{ a: { b: { c: { run: () => void }[] } } }>, true>>;

// A union member that could hold a function taints the union.
type _union = Expect<Equal<IsUncloneable<string | (() => void)>, true>>;

// A class with methods is rejected: a type cannot tell an own function property
// (which throws) from a prototype method (which is silently dropped).
declare class WithMethods {
  id: string;
  refresh(): void;
}
type _classMethods = Expect<Equal<IsUncloneable<WithMethods>, true>>;

// --- #21: optional members --------------------------------------------------

// Optional and cloneable stays valid; being omittable is not a defect.
type _optionalPresent = Expect<
  Equal<
    Serializable<{ id: string; note?: string }>,
    {
      id: string;
      note?: string;
    }
  >
>;
type _optionalUndefinedUnion = Expect<Equal<IsUncloneable<{ id: string; note?: string }>, false>>;

// Optional and uncloneable is rejected: the declaration permits a value that
// would make structured clone throw, and optionality cannot rescue it.
type _optionalUncloneable = Expect<Equal<IsUncloneable<{ id: string; run?: () => void }>, true>>;

// --- producer side: the error lands on the handler, not the generated bridge -

// A cloneable handler is accepted as normal.
defineIpcModule("ok", {
  get: handle(async (_event, id: string) => ({ id })),
  ping: listen((_event, message: string) => {
    void message;
  }),
});

defineIpcModule("bad", {
  // @ts-expect-error - the returned object carries a method, so nothing arrives
  get: handle(async () => ({ id: "1", run: () => {} })),
});

defineIpcModule("badArgs", {
  // @ts-expect-error - the argument cannot be cloned on the way in
  set: handle(async (_event, _input: { run: () => void }) => undefined),
});

defineIpcModule("badListenerArgs", {
  // @ts-expect-error - listener arguments cross IPC too
  ping: listen((_event, _input: { run: () => void }) => undefined),
});

// A listener's return value never goes back to the renderer, so it is exempt.
defineIpcModule("listenerResult", {
  ping: listen(() => ({ run: () => {} })),
});

// Shapes that must keep compiling: the constraint is easy to make too strict.
function wrapHandler<T>(fn: () => Promise<T>) {
  // `T` is unresolved here. An unresolvable type is treated as cloneable, the
  // same way `any` is — the check never blocks what it cannot inspect.
  return handle(async () => fn());
}

defineIpcModule("shapes", {
  returnsVoid: handle(async () => {}),
  returnsUndefined: handle(async () => undefined),
  returnsNull: handle(async () => null),
  returnsUnion: handle(async () => "a" as string | number),
  returnsArray: handle(async () => [{ id: "1" }]),
  returnsGeneric: wrapHandler(async () => ({ id: "1" })),
});
