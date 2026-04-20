export const IPC = {
  OPEN_VIDEO_FILE: 'viewpeople:open-video-file',
  SETTINGS_GET: 'viewpeople:settings-get',
  SETTINGS_SET: 'viewpeople:settings-set',
  RESOLVE_FILE_URL: 'viewpeople:resolve-file-url',
  RESOLVE_STREAM_URL: 'viewpeople:resolve-stream-url',
  OFFLINE_DETECTOR_ASSETS: 'viewpeople:offline-detector-assets'
} as const

/** Разрешение страницы/ссылки в URL воспроизведения (через yt-dlp при наличии). */
export type ResolveStreamUrlResult =
  | { ok: true; url: string; warning?: string }
  | { ok: false; message: string }

/** Локальные file:// URL к модели и каталогу WASM (если файлы собраны в установщик). */
export type OfflineDetectorAssets = {
  modelFileUrl: string
  ortWasmDirUrl: string
} | null

export type OpenVideoFileResult =
  | { canceled: true }
  | { canceled: false; fileUrl: string; filePath: string }
