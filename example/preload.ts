import { contextBridge } from "electron";
import { bridge } from "./generated/ipc-bridge.js";

contextBridge.exposeInMainWorld("ipc", bridge);
