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
  ResolvedIpcBridgeOptions,
  TypedIpcMainEvent,
  TypedIpcMainInvokeEvent,
  TypedWebContents,
  TypedWebFrameMain,
];

declare const ipcMain: IpcMain;
registration(ipcMain);
void [loadResult, loadAllResult, unloadResult, unloadAllResult, disposeResult];
void (null as unknown as PublicTypes);
