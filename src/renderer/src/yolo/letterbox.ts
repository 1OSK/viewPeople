/// <reference lib="webworker" />

import type * as ortNs from 'onnxruntime-web'

/** Letterbox 114 + CHW RGB /255, вход 640 (как у стандартного экспорта YOLOv8). */
export function letterboxToTensor(
  bitmap: ImageBitmap,
  size: number,
  ort: typeof import('onnxruntime-web')
): ortNs.Tensor {
  const w = bitmap.width
  const h = bitmap.height
  const r = Math.min(size / w, size / h)
  const nw = Math.round(w * r)
  const nh = Math.round(h * r)
  const padX = (size - nw) / 2
  const padY = (size - nh) / 2

  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Нет 2D для letterbox')
  }
  ctx.fillStyle = 'rgb(114, 114, 114)'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, padX, padY, nw, nh)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, size, size)
  const px = imageData.data
  const plane = size * size
  const float32 = new Float32Array(3 * plane)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const rr = px[i]! / 255
      const gg = px[i + 1]! / 255
      const bb = px[i + 2]! / 255
      const o = y * size + x
      float32[o] = rr
      float32[plane + o] = gg
      float32[2 * plane + o] = bb
    }
  }

  return new ort.Tensor('float32', float32, [1, 3, size, size])
}
