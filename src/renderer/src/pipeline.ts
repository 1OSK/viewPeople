export type PipelineTickResult = {
  capturedAt: number
  width: number
  height: number
}

export function drawVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): PipelineTickResult | null {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null
  }
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) {
    return null
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.drawImage(video, 0, 0, w, h)
  return { capturedAt: Date.now(), width: w, height: h }
}

export function createIntervalMs(initialMs: number): {
  get: () => number
  set: (ms: number) => void
} {
  let ms = Math.max(200, Math.min(10_000, initialMs))
  return {
    get: () => ms,
    set: (next) => {
      ms = Math.max(200, Math.min(10_000, next))
    }
  }
}
