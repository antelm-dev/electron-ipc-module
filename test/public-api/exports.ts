import {
  createIpcContainer,
  createIpcEmitter,
  createIpcHelpers,
  defineChannel,
  defineIpcEvents,
  defineIpcModule,
  handle,
  handleOnce,
  IpcAuthorizationError,
  IpcValidationError,
  IpcChannelCollisionError,
  IpcContainerDisposedError,
  IpcObserverError,
  listen,
  listenOnce,
  type ChannelDef,
  type ChannelType,
  type CloneableChannel,
  type HandlerDef,
  type ListenerDef,
  type DefineIpcModuleOptions,
  type IpcChannelContext,
  type IpcChannelValidator,
  type IpcCleanup,
  type IpcContainerEmitter,
  type IpcContainerEvents,
  type IpcEventMap,
  type IpcEmitter,
  type IpcHandler,
  type IpcListener,
  type IpcModuleCleanup,
  type IpcModuleRegister,
  type IpcModuleRegistration,
  type LoggerLike,
  type MaybePromise,
  type MethodsOnly,
  type IpcUncloneable,
  type Serializable,
  type TypedIpcMainEvent,
  type TypedIpcMainInvokeEvent,
  type TypedWebContents,
  type TypedWebFrameMain,
} from "electron-ipc-module";
import ipcBridge, {
  type IpcBridgeOptions as PluginOptions,
} from "electron-ipc-module/rollup-plugin";
import {
  getIpcBridgeWatchTargets,
  isIpcBridgeRelevantFile,
  resolveIpcBridgeOptions,
  runIpcBridgeGeneration,
  type AnalyzedIpcModule,
  type ChannelInfo,
  type EmittedEventInfo,
  type IpcBridgeOptions,
  type ResolvedIpcBridgeOptions,
} from "electron-ipc-module/generator";

// The generator's types are deliberately absent from the root. Each directive
// below is an error today, and an *unused* directive — itself a build failure —
// the moment one leaks back, so the narrowing cannot silently regress.
// @ts-expect-error `AnalyzedIpcModule` belongs to "electron-ipc-module/generator"
import type { AnalyzedIpcModule as _MovedAnalyzedIpcModule } from "electron-ipc-module";
// @ts-expect-error `ChannelInfo` belongs to "electron-ipc-module/generator"
import type { ChannelInfo as _MovedChannelInfo } from "electron-ipc-module";
// @ts-expect-error `EmittedEventInfo` belongs to "electron-ipc-module/generator"
import type { EmittedEventInfo as _MovedEmittedEventInfo } from "electron-ipc-module";
// @ts-expect-error `IpcBridgeOptions` belongs to "electron-ipc-module/generator"
import type { IpcBridgeOptions as _MovedIpcBridgeOptions } from "electron-ipc-module";
// @ts-expect-error `ResolvedIpcBridgeOptions` belongs to "electron-ipc-module/generator"
import type { ResolvedIpcBridgeOptions as _MovedResolvedOptions } from "electron-ipc-module";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { IpcMain, WebContents } from "electron";

type Events = { changed: [value: string] };
const emitter = createIpcEmitter<Events>("public");
emitter.emit("changed", "value");
declare const webContents: WebContents;
emitter.emitTo(webContents, "changed", "targeted");
// @ts-expect-error event keys must be declared in the event map
emitter.emit("missing", "value");
// @ts-expect-error the declared payload is required
emitter.emit("changed");
// @ts-expect-error payload types must match the declared tuple
emitter.emit("changed", 123);
const helpers = createIpcHelpers<Events>();
const handler = helpers.handle<[value: string], number>((event, value) => {
  event.sender.send("changed", value);
  return value.length;
});
const listener = helpers.listen<[value: string]>((event, value) => {
  event.reply("changed", value);
});
// A Standard Schema whose output matches the listener's declared parameters, so
// this file fails to compile if the two stop lining up.
const valueSchema: StandardSchemaV1<readonly unknown[], [value: string]> = {
  "~standard": {
    version: 1,
    vendor: "public-api",
    validate: (args) => ({ value: [String((args as readonly unknown[])[0])] }),
  },
};
const registration = defineIpcModule(
  "public",
  { handler, listener },
  {
    authorize: () => true,
    validate: { handler: () => undefined, listener: valueSchema },
    eventPrefix: true,
  },
);

const container = createIpcContainer();
const loadResult: Promise<string[]> = container.load("public", registration);
const loadAllResult: Promise<Record<string, string[]>> = container.loadAll({
  public: registration,
});
const unloadResult: Promise<boolean> = container.unload("public");
const unloadAllResult: Promise<void> = container.unloadAll();
const disposeResult: Promise<void> = container.dispose();

defineChannel("handle", async () => "ok");
defineIpcEvents<Events>();
handle(() => undefined);
handleOnce(() => undefined);
listen(() => undefined);
listenOnce(() => undefined);
new IpcAuthorizationError("channel");
new IpcValidationError("channel", [{ message: "invalid" }]);
new IpcChannelCollisionError("channel", "one", "two");
new IpcContainerDisposedError();
new IpcObserverError("loaded", "module", new Error("reason"));

const pluginOptions: PluginOptions = { ipcDir: "./ipc", logger: console satisfies LoggerLike };
ipcBridge(pluginOptions);
resolveIpcBridgeOptions(pluginOptions);
getIpcBridgeWatchTargets(pluginOptions);
isIpcBridgeRelevantFile("module.ipc.ts", pluginOptions);
runIpcBridgeGeneration(pluginOptions, { write: false });

// Type-only exports are named here so accidental removal fails this build.
type PublicTypes = [
  AnalyzedIpcModule,
  ChannelDef,
  ChannelInfo,
  ChannelType,
  DefineIpcModuleOptions,
  EmittedEventInfo,
  IpcBridgeOptions,
  IpcChannelContext,
  IpcChannelValidator,
  IpcCleanup,
  IpcContainerEmitter,
  IpcContainerEvents,
  IpcEventMap,
  IpcEmitter<Events>,
  IpcHandler,
  IpcListener,
  IpcUncloneable<string>,
  HandlerDef,
  ListenerDef,
  CloneableChannel<ChannelDef, [id: string], string>,
  IpcModuleCleanup,
  IpcModuleRegister,
  IpcModuleRegistration,
  LoggerLike,
  MaybePromise<string>,
  MethodsOnly<{ method(): void; value: string }>,
  Serializable<string>,
  ResolvedIpcBridgeOptions,
  TypedIpcMainEvent,
  TypedIpcMainInvokeEvent,
  TypedWebContents,
  TypedWebFrameMain,
];

// `Serializable` models the structured clone boundary. These assertions are
// compile errors if it stops matching what Electron actually delivers.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare class User {
  id: string;
  createdAt: Date;
  greet(): string;
}

declare class Account {
  id: string;
  createdAt: Date;
}

type SerializableAssertions = [
  // A method makes the whole payload uncloneable: structured clone rejects the
  // value outright rather than delivering it without the method.
  Expect<Equal<Serializable<User>, IpcUncloneable<User>>>,
  Expect<Equal<Serializable<() => void>, IpcUncloneable<() => void>>>,
  Expect<Equal<Serializable<{ run: () => void }>, IpcUncloneable<{ run: () => void }>>>,
  // A class with only data still arrives, as a plain object without its identity.
  Expect<Equal<Serializable<Account>, { id: string; createdAt: Date }>>,
  // Built-ins the algorithm reproduces with their prototypes intact.
  Expect<Equal<Serializable<Date>, Date>>,
  Expect<Equal<Serializable<Map<string, Date>>, Map<string, Date>>>,
  Expect<Equal<Serializable<Set<number>>, Set<number>>>,
  Expect<Equal<Serializable<Uint8Array>, Uint8Array>>,
  // Electron converts Buffer on the way across.
  Expect<Equal<Serializable<Buffer>, Uint8Array>>,
  // A built-in subclass keeps its base, not its own surface.
  Expect<Equal<Serializable<RangeError>, Error>>,
  // Tuples keep their labels and arity; optional and readonly modifiers survive.
  Expect<Equal<Serializable<[id: string, at: Date]>, [id: string, at: Date]>>,
  Expect<
    Equal<
      Serializable<[id: string, run: () => void]>,
      IpcUncloneable<[id: string, run: () => void]>
    >
  >,
  Expect<Equal<Serializable<{ a?: string }>, { a?: string }>>,
  Expect<Equal<Serializable<{ readonly a: string }>, { readonly a: string }>>,
  // Recurses through arrays and nested objects, and the failure propagates out.
  Expect<
    Equal<Serializable<{ accounts: Account[] }>, { accounts: { id: string; createdAt: Date }[] }>
  >,
  Expect<Equal<Serializable<{ users: User[] }>, IpcUncloneable<{ users: User[] }>>>,
  // A union is only as cloneable as its least cloneable member.
  Expect<Equal<Serializable<string | (() => void)>, IpcUncloneable<string | (() => void)>>>,
  Expect<Equal<Serializable<any>, any>>,
  Expect<Equal<Serializable<string | undefined>, string | undefined>>,
];

declare const ipcMain: IpcMain;
registration(ipcMain);
void (null as unknown as SerializableAssertions);
void [loadResult, loadAllResult, unloadResult, unloadAllResult, disposeResult];
void (null as unknown as PublicTypes);
