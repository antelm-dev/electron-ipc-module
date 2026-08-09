import {
  createIpcContainer,
  createIpcHelpers,
  defineChannel,
  defineIpcEvents,
  defineIpcModule,
  handle,
  handleOnce,
  IpcAuthorizationError,
  IpcChannelCollisionError,
  IpcContainerDisposedError,
  IpcObserverError,
  listen,
  listenOnce,
  type AnalyzedIpcModule,
  type ChannelDef,
  type ChannelInfo,
  type ChannelType,
  type DefineIpcModuleOptions,
  type EmittedEventInfo,
  type IpcBridgeOptions,
  type IpcChannelContext,
  type IpcCleanup,
  type IpcContainerEmitter,
  type IpcContainerEvents,
  type IpcEventMap,
  type IpcHandler,
  type IpcListener,
  type IpcModuleCleanup,
  type IpcModuleRegister,
  type IpcModuleRegistration,
  type LoggerLike,
  type MaybePromise,
  type MethodsOnly,
  type ResolvedIpcBridgeOptions,
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
} from "electron-ipc-module/generator";
import type { IpcMain } from "electron";

type Events = { changed: [value: string] };
const helpers = createIpcHelpers<Events>();
const handler = helpers.handle<[value: string], number>((event, value) => {
  event.sender.send("changed", value);
  return value.length;
});
const listener = helpers.listen<[value: string]>((event, value) => {
  event.reply("changed", value);
});
const registration = defineIpcModule(
  "public",
  { handler, listener },
  {
    authorize: () => true,
    validate: { handler: () => undefined },
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
new IpcChannelCollisionError("channel", "one", "two");
new IpcContainerDisposedError();
new IpcObserverError("loaded", "module", new Error("reason"));

const pluginOptions: PluginOptions = { ipcDir: "./ipc" };
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
  IpcCleanup,
  IpcContainerEmitter,
  IpcContainerEvents,
  IpcEventMap,
  IpcHandler,
  IpcListener,
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

type SerializableAssertions = [
  // Class instances arrive as plain data: the prototype is gone, so methods
  // become `never` while own properties survive.
  Expect<Equal<Serializable<User>, { id: string; createdAt: Date; greet: never }>>,
  // Structured clone throws on functions rather than dropping them silently.
  Expect<Equal<Serializable<() => void>, never>>,
  Expect<Equal<Serializable<{ run: () => void }>, { run: never }>>,
  // Built-ins the algorithm reproduces with their prototypes intact.
  Expect<Equal<Serializable<Date>, Date>>,
  Expect<Equal<Serializable<Map<string, Date>>, Map<string, Date>>>,
  Expect<Equal<Serializable<Set<number>>, Set<number>>>,
  Expect<Equal<Serializable<Uint8Array>, Uint8Array>>,
  // Tuples keep their labels and arity; optional and readonly modifiers survive.
  Expect<Equal<Serializable<[id: string, run: () => void]>, [id: string, run: never]>>,
  Expect<Equal<Serializable<{ a?: string }>, { a?: string }>>,
  Expect<Equal<Serializable<{ readonly a: string }>, { readonly a: string }>>,
  // Recurses through arrays and nested objects.
  Expect<
    Equal<
      Serializable<{ users: User[] }>,
      { users: { id: string; createdAt: Date; greet: never }[] }
    >
  >,
  // Unions distribute; primitives and `any` pass through untouched.
  Expect<Equal<Serializable<string | (() => void)>, string | never>>,
  Expect<Equal<Serializable<any>, any>>,
  Expect<Equal<Serializable<string | undefined>, string | undefined>>,
];

declare const ipcMain: IpcMain;
registration(ipcMain);
void (null as unknown as SerializableAssertions);
void [loadResult, loadAllResult, unloadResult, unloadAllResult, disposeResult];
void (null as unknown as PublicTypes);
