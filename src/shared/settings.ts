import type { DetectorMode } from './detector'

export type AppSettings = {
  intervalMs?: number
  /** Первая камера (основной поток в режиме «камера»). */
  cameraDeviceId?: string
  /**
   * Вторая камера. Если `null` при сохранении — ключ удаляется (только вторая отключена).
   * @see `cameraDeviceId`
   */
  cameraDeviceId2?: string | null
  lastVideoPath?: string
  /** Последняя ссылка на онлайн-трансляцию (страница Twitch и т.п. или прямой поток). */
  lastStreamUrl?: string
  /** Что восстанавливать при старте: камера, файл или поток по URL. */
  lastSource?: 'camera' | 'file' | 'stream'
  /** Режим детекции: лёгкий COCO-SSD или YOLOv8n ONNX (лучше на дистанции). */
  detectorMode?: DetectorMode
}
