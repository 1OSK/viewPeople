/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import type { DetectorInitMessage } from '../../shared/detector'
import { letterboxToTensor } from './yolo/letterbox'
import { countPersonsFromYoloOutput } from './yolo/yolo-postprocess'

type FromMain =
  | DetectorInitMessage
  | { type: 'detect'; scoreThreshold: number; bitmap: ImageBitmap }

const YOLO_SIZE = 640
/** Синхронно с зависимостью `onnxruntime-web` в package.json (WASM с CDN). */
const ORT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/'

let activeMode: 'coco-ssd' | 'yolo-onnx' | null = null
let cocoModel: cocoSsd.ObjectDetection | null = null
let yoloSession: import('onnxruntime-web').InferenceSession | null = null
let ortMod: typeof import('onnxruntime-web') | null = null

function postError(message: string): void {
  postMessage({ type: 'error', message })
}

self.onmessage = (ev: MessageEvent<FromMain>) => {
  void handle(ev.data)
}

async function handle(msg: FromMain): Promise<void> {
  if (msg.type === 'init') {
    activeMode = msg.mode
    if (msg.mode === 'coco-ssd') {
      yoloSession = null
      ortMod = null
        cocoModel = null
      try {
        postMessage({ type: 'status', text: 'TensorFlow.js: выбор backend…' })
        const webglOk = await tf
          .setBackend('webgl')
          .then(() => true)
          .catch(() => false)
        if (!webglOk) {
          await tf.setBackend('cpu')
        }
        await tf.ready()
        postMessage({
          type: 'status',
          text: `TensorFlow.js: ${tf.getBackend()} backend`
        })
        postMessage({ type: 'status', text: 'Загрузка COCO-SSD…' })
        cocoModel = await cocoSsd.load()
        postMessage({ type: 'status', text: 'Модель готова' })
        postMessage({ type: 'ready' })
      } catch (e) {
        cocoModel = null
        postError(e instanceof Error ? e.message : String(e))
      }
      return
    }

    cocoModel = null
    yoloSession = null
    ortMod = null
    try {
      postMessage({ type: 'status', text: 'ONNX Runtime: WASM…' })
      const ort = await import('onnxruntime-web')
      ortMod = ort
      ort.env.wasm.wasmPaths = msg.ortWasmBaseUrl ?? ORT_WASM_BASE
      ort.env.wasm.numThreads = 1
      postMessage({ type: 'status', text: `Загрузка весов YOLO…` })
      const res = await fetch(msg.modelUrl, { cache: 'force-cache' })
      if (!res.ok) {
        const src = msg.modelUrl.startsWith('file:') ? 'локальный файл' : 'сеть'
        throw new Error(`Модель (${src}): код ${res.status}`)
      }
      const buf = await res.arrayBuffer()
      postMessage({ type: 'status', text: 'Сборка графа ONNX…' })
      yoloSession = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
      postMessage({ type: 'status', text: 'YOLO готов' })
      postMessage({ type: 'ready' })
    } catch (e) {
      yoloSession = null
      ortMod = null
      postError(e instanceof Error ? e.message : String(e))
    }
    return
  }

  if (msg.type === 'detect') {
    const { bitmap, scoreThreshold } = msg
    if (activeMode === 'coco-ssd') {
      if (!cocoModel) {
        bitmap.close()
        postError('COCO-SSD не загружена')
        return
      }
      try {
        const maxSide = 512
        const bw = bitmap.width
        const bh = bitmap.height
        const scale = Math.min(1, maxSide / Math.max(bw, bh))
        const tw = Math.max(1, Math.round(bw * scale))
        const th = Math.max(1, Math.round(bh * scale))
        const canvas = new OffscreenCanvas(tw, th)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          bitmap.close()
          postError('Нет 2D-контекста')
          return
        }
        ctx.drawImage(bitmap, 0, 0, tw, th)
        bitmap.close()
        const predictions = await cocoModel.detect(
          canvas as unknown as HTMLCanvasElement,
          12,
          scoreThreshold
        )
        const count = predictions.filter((p) => p.class === 'person').length
        postMessage({ type: 'count', count })
      } catch (e) {
        try {
          bitmap.close()
        } catch {
          /* ignore */
        }
        postError(e instanceof Error ? e.message : String(e))
      }
      return
    }

    if (activeMode === 'yolo-onnx') {
      if (!yoloSession || !ortMod) {
        bitmap.close()
        postError('YOLO не загружен')
        return
      }
      try {
        const tensor = letterboxToTensor(bitmap, YOLO_SIZE, ortMod)
        const inName = yoloSession.inputNames[0]
        const outName = yoloSession.outputNames[0]
        const feeds: Record<string, import('onnxruntime-web').Tensor> = { [inName]: tensor }
        const results = await yoloSession.run(feeds)
        const out = results[outName]
        if (!out) {
          throw new Error('Пустой выход ONNX')
        }
        const data = out.data as Float32Array
        const dims = out.dims
        const count = countPersonsFromYoloOutput(data, dims, scoreThreshold, 0.5)
        postMessage({ type: 'count', count })
      } catch (e) {
        postError(e instanceof Error ? e.message : String(e))
      }
      return
    }

    bitmap.close()
    postError('Режим детекции не инициализирован')
  }
}
