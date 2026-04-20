import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type OfflineDetectorAssets,
  type OpenVideoFileResult,
  type ResolveStreamUrlResult
} from '../shared/ipc'
import type { AppSettings } from '../shared/settings'

contextBridge.exposeInMainWorld('viewPeople', {
  platform: process.platform,
  openVideoFile: (): Promise<OpenVideoFileResult> =>
    ipcRenderer.invoke(IPC.OPEN_VIDEO_FILE),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (patch: Partial<AppSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  resolveFileUrl: (absolutePath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.RESOLVE_FILE_URL, absolutePath),
  resolveStreamUrl: (pageOrStreamUrl: string): Promise<ResolveStreamUrlResult> =>
    ipcRenderer.invoke(IPC.RESOLVE_STREAM_URL, pageOrStreamUrl),
  getOfflineDetectorAssets: (): Promise<OfflineDetectorAssets> =>
    ipcRenderer.invoke(IPC.OFFLINE_DETECTOR_ASSETS)
})
