import { contextBridge, ipcRenderer } from "electron";
import type { BrandKit, SaveResult } from "@shared/brand";

// The only bridge between the UI and the main process.
const api = {
  getBrand: (): Promise<BrandKit | null> => ipcRenderer.invoke("brand:get"),
  saveBrand: (brand: BrandKit): Promise<SaveResult> => ipcRenderer.invoke("brand:save", brand),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld("api", api);
