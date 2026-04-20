import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import Store from 'electron-store'
import {
  IPC,
  type OfflineDetectorAssets,
  type OpenVideoFileResult,
  type ResolveStreamUrlResult
} from '../shared/ipc'
import type { AppSettings } from '../shared/settings'

/** CSP только для собранного приложения (в dev Vite остаётся без этого заголовка). */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https: blob: file: data:; " +
  "worker-src 'self' blob:; " +
  "img-src 'self' blob: data:; " +
  "media-src 'self' blob: file: mediastream: data: https: http:; " +
  "font-src 'self' data:; " +
  "frame-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self';"

function dirToFileUrl(dir: string): string {
  const trailing = dir.endsWith(sep) ? dir : dir + sep
  return pathToFileURL(trailing).href
}

function resolveOfflineDetectorAssets(): OfflineDetectorAssets {
  const modelPackaged = join(process.resourcesPath, 'models', 'yolov8n.onnx')
  const ortPackaged = join(process.resourcesPath, 'ort')
  const modelDev = join(app.getAppPath(), 'resources', 'models', 'yolov8n.onnx')
  const ortDev = join(app.getAppPath(), 'node_modules', 'onnxruntime-web', 'dist')

  const modelPath = app.isPackaged ? modelPackaged : modelDev
  const ortDir = app.isPackaged ? ortPackaged : ortDev

  if (!fs.existsSync(modelPath) || !fs.existsSync(ortDir)) {
    return null
  }
  let hasWasm = false
  try {
    hasWasm = fs.readdirSync(ortDir).some((f) => f.endsWith('.wasm'))
  } catch {
    hasWasm = false
  }
  if (!hasWasm) {
    return null
  }

  return {
    modelFileUrl: pathToFileURL(modelPath).href,
    ortWasmDirUrl: dirToFileUrl(ortDir)
  }
}

const execFileAsync = promisify(execFile)

function getTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

function resolveYtdlpPath(): string | null {
  const fromEnv = process.env.YT_DLP_PATH?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv
  }
  const packaged = join(process.resourcesPath, 'bin', 'yt-dlp.exe')
  const dev = join(app.getAppPath(), 'resources', 'bin', 'yt-dlp.exe')
  const candidate = app.isPackaged ? packaged : dev
  return fs.existsSync(candidate) ? candidate : null
}

function parseResolvedStreamLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http://') || l.startsWith('https://'))
}

function pickPlaybackUrl(lines: string[]): string | null {
  if (lines.length === 0) {
    return null
  }
  const m3u8 = lines.find((u) => /\.m3u8(\?|$)/i.test(u))
  return m3u8 ?? lines[0]
}

function registerIpc(store: Store<AppSettings>): void {
  ipcMain.handle(IPC.OPEN_VIDEO_FILE, async (): Promise<OpenVideoFileResult> => {
    const win = getTargetWindow()
    const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Видео',
          extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v']
        }
      ]
    })
    if (canceled || filePaths.length === 0) {
      return { canceled: true }
    }
    const filePath = filePaths[0]
    return {
      canceled: false,
      fileUrl: pathToFileURL(filePath).href,
      filePath
    }
  })

  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => {
    return { ...store.store }
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_e, patch: unknown): void => {
    if (!patch || typeof patch !== 'object') {
      return
    }
    const p = patch as Partial<AppSettings>
    if (typeof p.intervalMs === 'number' && Number.isFinite(p.intervalMs)) {
      store.set('intervalMs', Math.max(200, Math.min(10_000, Math.round(p.intervalMs))))
    }
    if (typeof p.cameraDeviceId === 'string') {
      store.set('cameraDeviceId', p.cameraDeviceId)
    }
    if (typeof p.lastVideoPath === 'string') {
      store.set('lastVideoPath', p.lastVideoPath)
    }
    if (typeof p.lastStreamUrl === 'string') {
      store.set('lastStreamUrl', p.lastStreamUrl)
    }
    if (p.lastSource === 'camera' || p.lastSource === 'file' || p.lastSource === 'stream') {
      store.set('lastSource', p.lastSource)
    }
    if (p.detectorMode === 'coco-ssd' || p.detectorMode === 'yolo-onnx') {
      store.set('detectorMode', p.detectorMode)
    }
  })

  ipcMain.handle(IPC.RESOLVE_FILE_URL, (_e, filePath: unknown): string => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return ''
    }
    const allowed = store.get('lastVideoPath')
    if (typeof allowed !== 'string' || allowed.length === 0) {
      return ''
    }
    if (normalize(filePath) !== normalize(allowed)) {
      return ''
    }
    try {
      return pathToFileURL(filePath).href
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.OFFLINE_DETECTOR_ASSETS, (): OfflineDetectorAssets => {
    return resolveOfflineDetectorAssets()
  })

  ipcMain.handle(IPC.RESOLVE_STREAM_URL, async (_e, raw: unknown): Promise<ResolveStreamUrlResult> => {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return { ok: false, message: 'Пустая ссылка' }
    }
    let pageUrl: URL
    try {
      pageUrl = new URL(raw.trim())
    } catch {
      return { ok: false, message: 'Некорректный URL' }
    }
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      return { ok: false, message: 'Разрешены только ссылки http(s)' }
    }

    const bin = resolveYtdlpPath()
    if (!bin) {
      return {
        ok: true,
        url: pageUrl.href,
        warning:
          'yt-dlp не найден (выполните npm run setup:assets). Страницы Twitch/YouTube могут не открыться; прямые .m3u8/.mp4 — попробуйте.'
      }
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        bin,
        [
          '--no-warnings',
          '--no-check-certificates',
          '-f',
          'bv*[height<=720]+ba/b*[height<=720]/best[height<=720]/best',
          '-g',
          pageUrl.href
        ],
        {
          timeout: 120_000,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true
        }
      )
      const lines = parseResolvedStreamLines(stdout)
      const playUrl = pickPlaybackUrl(lines)
      if (!playUrl) {
        const hint = stderr?.trim() ? stderr.trim().slice(0, 280) : 'нет URL в выводе yt-dlp'
        return { ok: false, message: hint }
      }
      return { ok: true, url: playUrl }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, message: `yt-dlp: ${msg}` }
    }
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const store = new Store<AppSettings>({
    name: 'viewpeople-settings',
    defaults: {
      intervalMs: 1000,
      lastSource: 'camera'
    }
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'camera') {
      callback(true)
    } else {
      callback(false)
    }
  })

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (!details.url.startsWith('file:')) {
        callback({ responseHeaders: details.responseHeaders ?? {} })
        return
      }
      const headers = { ...(details.responseHeaders ?? {}) }
      headers['Content-Security-Policy'] = [CONTENT_SECURITY_POLICY]
      callback({ responseHeaders: headers })
    })
  }

  registerIpc(store)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
