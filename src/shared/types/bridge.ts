export interface IpcBridgeOptions {
  ipcDir?: string;
  outFile?: string;
  tsconfig?: string;
}

export interface ResolvedIpcBridgeOptions {
  ipcDir: string;
  outFile: string;
  tsconfig: string;
}

export interface ChannelInfo {
  key: string;
  isHandler: boolean;
  argsType: string | null;
  returnType: string;
}

export interface EmittedEventInfo {
  key: string;
  argsType: string | null;
}

export interface AnalyzedIpcModule {
  name: string;
  prefix: string;
  channels: ChannelInfo[];
  emittedEvents: EmittedEventInfo[];
  warnings: string[];
  fileName: string;
}
