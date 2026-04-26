import {
  DEFAULT_YOLO_ONNX_URL,
  type DetectorInitMessage
} from '../../shared/detector'

export type DetectorClientConfig =
  | { mode: 'coco-ssd' }
  | { mode: 'yolo-onnx'; modelUrl?: string }

/** Индексы воркеров: 0 — одиночный поток (файл/поток/первая камера), 1 — вторая камера (параллельный инференс). */
export type DetectorWorkerSlot = 0 | 1

/** Первая загрузка YOLO по сети может быть долгой. */
const INIT_TIMEOUT_MS = 600_000
/** Один кадр не должен «висеть» бесконечно. */
const DETECT_TIMEOUT_MS = 90_000

const NUM_WORKERS = 2 as const
const workers: [Worker | null, Worker | null] = [null, null]
const initDone: [boolean, boolean] = [false, false]
const initPromise: [Promise<void> | null, Promise<void> | null] = [null, null]

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

function getWorker(slot: DetectorWorkerSlot): Worker {
  if (!workers[slot]) {
    workers[slot] = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })
  }
  return workers[slot]!
}

/**
 * Гарантирует, что воркер `slot` загружен (модель в памяти).
 * Слот 0 — обычный путь; слот 1 — вторая камера (два экземпляра модели — параллельный инференс).
 */
export async function ensureWorkerSlotLoaded(
  slot: DetectorWorkerSlot,
  onStatus?: (text: string) => void
): Promise<void> {
  if (initDone[slot]) {
    return
  }
  if (!initPromise[slot]) {
    const w = getWorker(slot)
    initPromise[slot] = (async (): Promise<void> => {
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
          workers[slot] = null
          initDone[slot] = false
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
            initDone[slot] = true
            resolve()
            return
          }
          if (m?.type === 'error') {
            settled = true
            clearTimeout(to)
            w.removeEventListener('message', onMessage)
            reject(new Error(typeof m.message === 'string' ? m.message : 'Worker init error'))
          }
        }
        w.addEventListener('message', onMessage)
        try {
          w.postMessage(payload)
        } catch (e) {
          settled = true
          clearTimeout(to)
          w.removeEventListener('message', onMessage)
          workers[slot] = null
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })().catch((err: unknown) => {
      initPromise[slot] = null
      initDone[slot] = false
      throw err
    })
  }
  try {
    await initPromise[slot]!
  } catch (e) {
    initPromise[slot] = null
    initDone[slot] = false
    throw e
  }
}

/** Совместимость: один воркер (слот 0) — для файла/трансляции и «одна камера». */
export async function ensureDetectorLoaded(onStatus?: (text: string) => void): Promise<void> {
  await ensureWorkerSlotLoaded(0, onStatus)
}

/** Второй воркер YOLO/COCO — только для параллельного анализа второй камеры. */
export async function ensureSecondDetectorWorker(onStatus?: (text: string) => void): Promise<void> {
  await ensureWorkerSlotLoaded(1, onStatus)
}

export function disposeDetectorWorker(): void {
  for (const slot of [0, 1] as const) {
    workers[slot]?.terminate()
    workers[slot] = null
    initDone[slot] = false
    initPromise[slot] = null
  }
}

function runDetectOnBitmap(
  bitmap: ImageBitmap,
  slot: DetectorWorkerSlot,
  scoreThreshold: number
): Promise<number> {
  const w = getWorker(slot)
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

/**
 * Кадр уже в `ImageBitmap` — детекция в указанном воркере (для параллельного `Promise.all` с двумя кадрами).
 */
export async function countPeopleOnImageBitmap(
  bitmap: ImageBitmap,
  slot: DetectorWorkerSlot,
  scoreThreshold = 0.5
): Promise<number> {
  try {
    await ensureWorkerSlotLoaded(slot)
  } catch (e) {
    try {
      bitmap.close()
    } catch {
      // no-op: bitmap may already be detached/closed
    }
    throw e
  }
  return runDetectOnBitmap(bitmap, slot, scoreThreshold)
}

/**
 * @param slot — 0 (по умолчанию) для основного потока; 1 — если нужен отдельный проход (редко; для API совместимости)
 */
export async function countPeopleOnCanvas(
  canvas: HTMLCanvasElement,
  scoreThreshold = 0.5,
  slot: DetectorWorkerSlot = 0
): Promise<number> {
  await ensureWorkerSlotLoaded(slot)
  const bitmap = await createImageBitmap(canvas)
  return runDetectOnBitmap(bitmap, slot, scoreThreshold)
}
