/// <reference types="vite/client" />

import type {
  OfflineDetectorAssets,
  OpenVideoFileResult,
  ResolveStreamUrlResult
} from '../../shared/ipc'
import type { AppSettings } from '../../shared/settings'

export {}

declare global {
  interface Window {
    viewPeople: {
      platform: NodeJS.Platform
      openVideoFile: () => Promise<OpenVideoFileResult>
      getSettings: () => Promise<AppSettings>
      setSettings: (patch: Partial<AppSettings>) => Promise<void>
      resolveFileUrl: (absolutePath: string) => Promise<string>
      resolveStreamUrl: (pageOrStreamUrl: string) => Promise<ResolveStreamUrlResult>
      getOfflineDetectorAssets: () => Promise<OfflineDetectorAssets>
    }
  }
}
