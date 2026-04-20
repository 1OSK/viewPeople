import Hls from 'hls.js'

export type SourceMode = 'none' | 'camera' | 'file' | 'stream'

let hlsPlayer: Hls | null = null

export async function listCameraDevices(): Promise<MediaDeviceInfo[]> {
  let devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'videoinput'
  )
  const needsLabels = devices.some((d) => !d.label)
  if (needsLabels) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    stream.getTracks().forEach((t) => t.stop())
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
  }
  return devices
}

export async function startCamera(video: HTMLVideoElement, deviceId?: string): Promise<MediaStream> {
  stopVideoElement(video)
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: deviceId ? { deviceId: { exact: deviceId } } : true
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  video.srcObject = stream
  await video.play()
  return stream
}

export async function startFile(video: HTMLVideoElement, fileUrl: string): Promise<void> {
  stopVideoElement(video)
  video.srcObject = null
  video.src = fileUrl
  video.loop = true
  await video.play()
}

function destroyHls(): void {
  if (hlsPlayer) {
    hlsPlayer.destroy()
    hlsPlayer = null
  }
}

/**
 * Воспроизведение HTTP(S) потока: прогрессивное видео или HLS (.m3u8) через hls.js.
 */
export async function startHttpStream(video: HTMLVideoElement, streamUrl: string): Promise<void> {
  stopVideoElement(video)
  video.srcObject = null
  video.removeAttribute('src')
  video.load()

  const url = streamUrl.trim()
  const looksHls = /\.m3u8(\?|$)/i.test(url) || url.toLowerCase().includes('m3u8')

  if (looksHls && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 60
    })
    hlsPlayer = hls
    hls.loadSource(url)
    hls.attachMedia(video)
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error('Таймаут загрузки HLS')), 45_000)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        window.clearTimeout(t)
        resolve()
      })
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          window.clearTimeout(t)
          reject(new Error(data.details || 'Ошибка HLS'))
        }
      })
    })
    await video.play()
    return
  }

  if (looksHls && video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
    await video.play()
    return
  }

  video.src = url
  video.loop = false
  await video.play()
}

export function stopVideoElement(video: HTMLVideoElement): void {
  destroyHls()
  const obj = video.srcObject
  if (obj && 'getTracks' in obj) {
    ;(obj as MediaStream).getTracks().forEach((t) => t.stop())
  }
  video.srcObject = null
  video.removeAttribute('src')
  video.load()
}
