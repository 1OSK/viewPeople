import type { DetectorMode } from './detector'

export type AppSettings = {
  intervalMs?: number
  cameraDeviceId?: string
  lastVideoPath?: string
  /** Последняя ссылка на онлайн-трансляцию (страница Twitch и т.п. или прямой поток). */
  lastStreamUrl?: string
  /** Что восстанавливать при старте: камера, файл или поток по URL. */
  lastSource?: 'camera' | 'file' | 'stream'
  /** Режим детекции: лёгкий COCO-SSD или YOLOv8n ONNX (лучше на дистанции). */
  detectorMode?: DetectorMode
}
