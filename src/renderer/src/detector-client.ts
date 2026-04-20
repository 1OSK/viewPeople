import {
  DEFAULT_YOLO_ONNX_URL,
  type DetectorInitMessage
} from '../../shared/detector'

export type DetectorClientConfig =
  | { mode: 'coco-ssd' }
  | { mode: 'yolo-onnx'; modelUrl?: string }

/** Первая загрузка YOLO по сети может быть долгой. */
const INIT_TIMEOUT_MS = 600_000
/** Один кадр не должен «висеть» бесконечно. */
const DETECT_TIMEOUT_MS = 90_000

let worker: Worker | null = null
let initDone = false
let initPromise: Promise<void> | null = null

let currentConfig: DetectorClientConfig = { mode: 'coco-ssd' }

function normalize(config: DetectorClientConfig): DetectorClientConfig {
  if (config.mode === 'coco-ssd') {
    return { mode: 'coco-ssd' }
  }
  return { mode: 'yolo-onnx', modelUrl: config.modelUrl }
}

function configFingerprint(c: DetectorClientConfig): string {
  if (c.mode === 'coco-ssd') {
    return 'coco'
  }
  return `yolo:${c.modelUrl ?? 'default'}`
}

async function buildInitMessage(): Promise<DetectorInitMessage> {
  if (currentConfig.mode === 'coco-ssd') {
    return { type: 'init', mode: 'coco-ssd' }
  }
  const custom = currentConfig.modelUrl
  const offline = await window.viewPeople?.getOfflineDetectorAssets?.()
  if (offline?.modelFileUrl && offline.ortWasmDirUrl) {
    const base = offline.ortWasmDirUrl.endsWith('/')
      ? offline.ortWasmDirUrl
      : `${offline.ortWasmDirUrl}/`
    return {
      type: 'init',
      mode: 'yolo-onnx',
      modelUrl: offline.modelFileUrl,
      ortWasmBaseUrl: base
    }
  }
  return {
    type: 'init',
    mode: 'yolo-onnx',
    modelUrl: custom ?? DEFAULT_YOLO_ONNX_URL
  }
}

export function setDetectorConfig(next: DetectorClientConfig): void {
  const n = normalize(next)
  if (configFingerprint(n) === configFingerprint(currentConfig)) {
    return
  }
  currentConfig = n
  disposeDetectorWorker()
}

export function getDetectorConfig(): DetectorClientConfig {
  return normalize(currentConfig)
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export function disposeDetectorWorker(): void {
  worker?.terminate()
  worker = null
  initDone = false
  initPromise = null
}

export async function ensureDetectorLoaded(onStatus?: (text: string) => void): Promise<void> {
  if (initDone) {
    return
  }
  if (!initPromise) {
    const w = getWorker()
    initPromise = (async (): Promise<void> => {
      const payload = await buildInitMessage()
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const to = setTimeout(() => {
          if (settled) {
            return
          }
          settled = true
          w.removeEventListener('message', onMessage)
          w.terminate()
          worker = null
          initDone = false
          reject(
            new Error(
              `Инициализация модели: превышено ${INIT_TIMEOUT_MS / 60_000} мин — проверьте сеть или файлы установки`
            )
          )
        }, INIT_TIMEOUT_MS)

        const onMessage = (ev: MessageEvent): void => {
          if (settled) {
            return
          }
          const m = ev.data as { type?: string; text?: string; message?: string }
          if (m?.type === 'status' && typeof m.text === 'string') {
            onStatus?.(m.text)
          }
          if (m?.type === 'ready') {
            settled = true
            clearTimeout(to)
            w.removeEventListener('message', onMessage)
            initDone = true
            resolve()
          }
          if (m?.type === 'error') {
            settled = true
            clearTimeout(to)
            w.removeEventListener('message', onMessage)
            reject(new Error(typeof m.message === 'string' ? m.message : 'Worker init error'))
          }
        }
        w.addEventListener('message', onMessage)
        w.postMessage(payload)
      })
    })().catch((err: unknown) => {
      initPromise = null
      initDone = false
      throw err
    })
  }
  try {
    await initPromise
  } catch (e) {
    initPromise = null
    initDone = false
    throw e
  }
}

export async function countPeopleOnCanvas(
  canvas: HTMLCanvasElement,
  scoreThreshold = 0.5
): Promise<number> {
  await ensureDetectorLoaded()
  const bitmap = await createImageBitmap(canvas)
  const w = getWorker()
  return new Promise((resolve, reject) => {
    let settled = false
    const to = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      w.removeEventListener('message', onMessage)
      bitmap.close()
      reject(new Error(`Детекция: нет ответа за ${DETECT_TIMEOUT_MS / 1000} с`))
    }, DETECT_TIMEOUT_MS)

    const onMessage = (ev: MessageEvent): void => {
      if (settled) {
        return
      }
      const m = ev.data as { type?: string; count?: number; message?: string }
      if (m?.type === 'count' && typeof m.count === 'number') {
        settled = true
        clearTimeout(to)
        w.removeEventListener('message', onMessage)
        resolve(m.count)
        return
      }
      if (m?.type === 'error') {
        settled = true
        clearTimeout(to)
        w.removeEventListener('message', onMessage)
        reject(new Error(typeof m.message === 'string' ? m.message : 'Worker detect error'))
      }
    }
    w.addEventListener('message', onMessage)
    try {
      w.postMessage({ type: 'detect', scoreThreshold, bitmap }, [bitmap])
    } catch (e) {
      settled = true
      clearTimeout(to)
      w.removeEventListener('message', onMessage)
      bitmap.close()
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}
