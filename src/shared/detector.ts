export type DetectorMode = 'coco-ssd' | 'yolo-onnx'

/** Публичная сборка YOLOv8n ONNX (зеркало; релиз ultralytics/assets для .onnx больше не отдаёт файл). */
export const DEFAULT_YOLO_ONNX_URL =
  'https://huggingface.co/cabelo/yolov8/resolve/main/yolov8n.onnx'

export type DetectorInitMessage =
  | { type: 'init'; mode: 'coco-ssd' }
  | {
      type: 'init'
      mode: 'yolo-onnx'
      modelUrl: string
      /** Если задан — WASM ONNX Runtime из установщика (каталог с завершающим `/`). */
      ortWasmBaseUrl?: string
    }
