import type { DetectorMode } from '../../../shared/detector'
import type { AppSettings } from '../../../shared/settings'
import {
  countPeopleOnCanvas,
  disposeDetectorWorker,
  ensureDetectorLoaded,
  setDetectorConfig
} from '../detector'
import { createIntervalMs, drawVideoFrame } from '../pipeline'
import {
  listCameraDevices,
  startCamera,
  startFile,
  startHttpStream,
  stopVideoElement
} from '../video-source'

type VideoSourceMode = 'camera' | 'file' | 'stream'

function qs<T extends HTMLElement>(parent: ParentNode, selector: string): T | null {
  return parent.querySelector(selector) as T | null
}

function persist(patch: Partial<AppSettings>): void {
  void window.viewPeople?.setSettings?.(patch)
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <main class="app">
      <header class="header">
        <div class="header-row">
          <h1 class="title">ViewPeople</h1>
          <span class="title-tag">подсчёт в кадре</span>
        </div>
        <p class="lede">Сначала выберите источник кадра, затем детектор. Трансляции — URL (Twitch и др.) через yt-dlp из сборки.</p>
      </header>

      <section class="source-block" aria-label="Источник изображения">
        <p class="source-block-title">Источник кадра</p>
        <div class="source-tabs" role="tablist" aria-label="Режим источника">
          <button type="button" class="source-tab" role="tab" data-source="camera" id="tab-camera" aria-selected="true">
            Камера
          </button>
          <button type="button" class="source-tab" role="tab" data-source="file" id="tab-file" aria-selected="false">
            Видеофайл
          </button>
          <button type="button" class="source-tab" role="tab" data-source="stream" id="tab-stream" aria-selected="false">
            Трансляция
          </button>
        </div>
        <div class="source-panels">
          <div class="source-panel" id="panel-camera" role="tabpanel" aria-labelledby="tab-camera">
            <div class="field">
              <label for="cam-select">Устройство</label>
              <select id="cam-select"></select>
            </div>
            <button type="button" class="btn secondary" id="btn-refresh">Обновить список</button>
          </div>
          <div class="source-panel source-panel--hidden" id="panel-file" role="tabpanel" aria-labelledby="tab-file" hidden>
            <button type="button" class="btn" id="btn-file">Открыть видео…</button>
            <p class="source-hint">Файл с диска. При смене режима воспроизведение останавливается.</p>
          </div>
          <div class="source-panel source-panel--hidden" id="panel-stream" role="tabpanel" aria-labelledby="tab-stream" hidden>
            <div class="field stream-field">
              <label for="stream-url">URL потока или страницы</label>
              <input
                id="stream-url"
                type="url"
                placeholder="https://www.twitch.tv/…"
                spellcheck="false"
                autocomplete="off"
              />
            </div>
            <button type="button" class="btn secondary" id="btn-stream">Подключить</button>
            <p class="source-hint">Нужен yt-dlp (npm run setup:assets). Прямые .m3u8 / .mp4 могут работать без него.</p>
          </div>
        </div>
      </section>

      <section class="toolbar" aria-label="Детектор и интервал">
        <div class="field mode-field">
          <label for="detector-mode">Детектор</label>
          <select id="detector-mode">
            <option value="coco-ssd">COCO-SSD</option>
            <option value="yolo-onnx">YOLOv8n ONNX</option>
          </select>
        </div>
        <div class="field interval">
          <label for="interval">Интервал, мс</label>
          <input id="interval" type="number" min="200" max="10000" step="100" value="1000" />
        </div>
      </section>

      <section class="preview-wrap">
        <video id="preview" class="preview" playsinline muted></video>
      </section>

      <canvas id="grab" class="grab" width="0" height="0" hidden></canvas>

      <section class="stats" aria-label="Результат">
        <div class="stat stat--hero">
          <span class="label">Людей в кадре</span>
          <span class="value" id="count">—</span>
        </div>
        <div class="stat stat--side">
          <span class="label">Время кадра</span>
          <span class="value value-mono" id="last-frame">—</span>
        </div>
        <p class="status-line" id="status" role="status">Готово</p>
      </section>

      <section class="help-block" aria-labelledby="help-heading">
        <h2 id="help-heading" class="help-block-title">Help</h2>
        <p class="help-author">Ильин Константин Юрьевич ИУ5-81Б</p>
      </section>
    </main>
  `

  const video = qs<HTMLVideoElement>(root, '#preview')!
  const canvas = qs<HTMLCanvasElement>(root, '#grab')!
  const modeSelect = qs<HTMLSelectElement>(root, '#detector-mode')!
  const camSelect = qs<HTMLSelectElement>(root, '#cam-select')!
  const btnRefresh = qs<HTMLButtonElement>(root, '#btn-refresh')!
  const btnFile = qs<HTMLButtonElement>(root, '#btn-file')!
  const streamUrlInput = qs<HTMLInputElement>(root, '#stream-url')!
  const btnStream = qs<HTMLButtonElement>(root, '#btn-stream')!
  const intervalInput = qs<HTMLInputElement>(root, '#interval')!
  const countEl = qs(root, '#count')!
  const lastFrameEl = qs(root, '#last-frame')!
  const statusEl = qs(root, '#status')!

  const tabCamera = qs<HTMLButtonElement>(root, '#tab-camera')!
  const tabFile = qs<HTMLButtonElement>(root, '#tab-file')!
  const tabStream = qs<HTMLButtonElement>(root, '#tab-stream')!
  const panelCamera = qs<HTMLElement>(root, '#panel-camera')!
  const panelFile = qs<HTMLElement>(root, '#panel-file')!
  const panelStream = qs<HTMLElement>(root, '#panel-stream')!

  const intervalCfg = createIntervalMs(Number(intervalInput.value) || 1000)
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false
  let lastAppliedMode: DetectorMode = 'coco-ssd'
  let activeVideoSource: VideoSourceMode = 'camera'

  const setStatus = (text: string): void => {
    statusEl.textContent = text
  }

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  const prepareVideoSwitch = (): void => {
    stopTimer()
    stopVideoElement(video)
    countEl.textContent = '—'
    lastFrameEl.textContent = '—'
  }

  const updateSourceUi = (): void => {
    const tabs = [tabCamera, tabFile, tabStream]
    const panels: Record<VideoSourceMode, HTMLElement> = {
      camera: panelCamera,
      file: panelFile,
      stream: panelStream
    }
    for (const t of tabs) {
      const m = t.dataset.source as VideoSourceMode
      const on = m === activeVideoSource
      t.setAttribute('aria-selected', on ? 'true' : 'false')
      t.tabIndex = on ? 0 : -1
    }
    for (const m of Object.keys(panels) as VideoSourceMode[]) {
      const el = panels[m]!
      const show = m === activeVideoSource
      el.classList.toggle('source-panel--hidden', !show)
      el.hidden = !show
    }
  }

  const startTimer = (): void => {
    stopTimer()
    timer = setInterval(() => {
      void tick()
    }, intervalCfg.get())
  }

  const tick = async (): Promise<void> => {
    if (busy) {
      return
    }
    const snap = drawVideoFrame(video, canvas)
    if (!snap) {
      return
    }
    busy = true
    lastFrameEl.textContent = new Date(snap.capturedAt).toLocaleTimeString()
    try {
      const n = await countPeopleOnCanvas(canvas, 0.5)
      countEl.textContent = String(n)
    } catch (e) {
      setStatus(`Детекция: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busy = false
    }
  }

  const fillCameras = async (): Promise<void> => {
    try {
      setStatus('Запрос списка камер…')
      const devices = await listCameraDevices()
      const current = camSelect.value
      camSelect.innerHTML = ''
      for (const d of devices) {
        const opt = document.createElement('option')
        opt.value = d.deviceId
        opt.textContent = d.label || `Камера ${d.deviceId.slice(0, 8)}…`
        camSelect.appendChild(opt)
      }
      if (current && [...camSelect.options].some((o) => o.value === current)) {
        camSelect.value = current
      }
      setStatus('Список камер обновлён')
    } catch (e) {
      setStatus(`Камеры: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onCameraChange = async (): Promise<void> => {
    const id = camSelect.value
    if (!id) {
      return
    }
    try {
      setStatus('Запуск камеры…')
      await startCamera(video, id)
      setStatus('Камера активна')
      persist({ cameraDeviceId: id, lastSource: 'camera', lastStreamUrl: '' })
      startTimer()
    } catch (e) {
      setStatus(`Камера: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const connectStream = async (pageUrl: string): Promise<void> => {
    const api = window.viewPeople
    if (!api.resolveStreamUrl) {
      throw new Error('Нет API resolveStreamUrl (preload)')
    }
    prepareVideoSwitch()
    setStatus('Разрешение ссылки…')
    const res = await api.resolveStreamUrl(pageUrl.trim())
    if (!res.ok) {
      throw new Error(res.message)
    }
    if (res.warning) {
      setStatus(res.warning)
    }
    setStatus('Запуск потока…')
    await startHttpStream(video, res.url)
    persist({ lastStreamUrl: pageUrl.trim(), lastSource: 'stream' })
    setStatus('Поток воспроизводится')
    startTimer()
  }

  /**
   * Переключение вкладки источника: останавливает текущее воспроизведение и запускает сценарий режима.
   */
  const applyVideoSourceMode = async (mode: VideoSourceMode): Promise<void> => {
    if (mode === activeVideoSource) {
      if (mode === 'stream') {
        streamUrlInput.focus()
      }
      return
    }
    prepareVideoSwitch()
    activeVideoSource = mode
    updateSourceUi()

    if (mode === 'camera') {
      persist({ lastSource: 'camera', lastStreamUrl: '' })
      await onCameraChange()
      return
    }
    if (mode === 'file') {
      persist({ lastSource: 'file', lastStreamUrl: '' })
      setStatus('Выберите видеофайл кнопкой «Открыть видео…»')
      return
    }
    persist({ lastSource: 'stream' })
    setStatus('Введите URL и нажмите «Подключить»')
    streamUrlInput.focus()
  }

  tabCamera.addEventListener('click', () => {
    void applyVideoSourceMode('camera')
  })
  tabFile.addEventListener('click', () => {
    void applyVideoSourceMode('file')
  })
  tabStream.addEventListener('click', () => {
    void applyVideoSourceMode('stream')
  })

  modeSelect.addEventListener('change', () => {
    void (async () => {
      const prev = lastAppliedMode
      const next = modeSelect.value as DetectorMode
      try {
        persist({ detectorMode: next })
        if (next === 'yolo-onnx') {
          setDetectorConfig({ mode: 'yolo-onnx' })
        } else {
          setDetectorConfig({ mode: 'coco-ssd' })
        }
        setStatus('Смена детектора: загрузка…')
        await ensureDetectorLoaded(setStatus)
        lastAppliedMode = next
        setStatus('Готово')
      } catch (e) {
        modeSelect.value = prev
        persist({ detectorMode: prev })
        if (prev === 'yolo-onnx') {
          setDetectorConfig({ mode: 'yolo-onnx' })
        } else {
          setDetectorConfig({ mode: 'coco-ssd' })
        }
        try {
          await ensureDetectorLoaded(setStatus)
        } catch {
          setStatus('Не удалось восстановить детектор после ошибки')
          return
        }
        setStatus(`Детектор: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  })

  btnRefresh.addEventListener('click', () => {
    void fillCameras()
  })

  camSelect.addEventListener('change', () => {
    if (activeVideoSource !== 'camera') {
      return
    }
    void onCameraChange()
  })

  btnFile.addEventListener('click', () => {
    void (async () => {
      if (activeVideoSource !== 'file') {
        await applyVideoSourceMode('file')
      }
      try {
        const api = window.viewPeople
        if (!api?.openVideoFile) {
          setStatus('Нет API выбора файла (preload)')
          return
        }
        setStatus('Выбор файла…')
        const res = await api.openVideoFile()
        if (res.canceled) {
          setStatus('Файл не выбран')
          return
        }
        prepareVideoSwitch()
        setStatus('Открытие видео…')
        await startFile(video, res.fileUrl)
        setStatus('Видео воспроизводится')
        persist({ lastVideoPath: res.filePath, lastSource: 'file', lastStreamUrl: '' })
        startTimer()
      } catch (e) {
        setStatus(`Файл: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  })

  btnStream.addEventListener('click', () => {
    void (async () => {
      if (activeVideoSource !== 'stream') {
        await applyVideoSourceMode('stream')
      }
      const raw = streamUrlInput.value.trim()
      if (!raw) {
        setStatus('Введите URL трансляции')
        return
      }
      try {
        await connectStream(raw)
      } catch (e) {
        setStatus(`Поток: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  })

  streamUrlInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      btnStream.click()
    }
  })

  intervalInput.addEventListener('change', () => {
    const v = Number(intervalInput.value)
    intervalCfg.set(Number.isFinite(v) ? v : 1000)
    intervalInput.value = String(intervalCfg.get())
    persist({ intervalMs: intervalCfg.get() })
    if (timer !== null) {
      startTimer()
    }
  })

  window.addEventListener('beforeunload', () => {
    stopTimer()
    stopVideoElement(video)
    disposeDetectorWorker()
  })

  void (async () => {
    try {
      let settings: AppSettings = {}
      try {
        settings = (await window.viewPeople.getSettings()) ?? {}
      } catch {
        settings = {}
      }

      if (typeof settings.intervalMs === 'number' && Number.isFinite(settings.intervalMs)) {
        intervalCfg.set(settings.intervalMs)
        intervalInput.value = String(intervalCfg.get())
      }

      const offline = await window.viewPeople.getOfflineDetectorAssets()
      const saved = settings.detectorMode
      const dm: DetectorMode =
        saved === 'yolo-onnx' || saved === 'coco-ssd'
          ? saved
          : offline
            ? 'yolo-onnx'
            : 'coco-ssd'
      modeSelect.value = dm
      if (dm === 'yolo-onnx') {
        setDetectorConfig({ mode: 'yolo-onnx' })
      } else {
        setDetectorConfig({ mode: 'coco-ssd' })
      }

      setStatus('Загрузка модели (worker)…')
      await ensureDetectorLoaded(setStatus)
      lastAppliedMode = dm

      await fillCameras()

      const camId = settings.cameraDeviceId
      const hasCam =
        typeof camId === 'string' && [...camSelect.options].some((o) => o.value === camId)

      const savedSource = settings.lastSource
      if (savedSource === 'file' || savedSource === 'stream' || savedSource === 'camera') {
        activeVideoSource = savedSource
      } else {
        activeVideoSource = 'camera'
      }
      updateSourceUi()

      if (typeof settings.lastStreamUrl === 'string' && settings.lastStreamUrl.length > 0) {
        streamUrlInput.value = settings.lastStreamUrl
      }

      if (
        settings.lastSource === 'stream' &&
        typeof settings.lastStreamUrl === 'string' &&
        settings.lastStreamUrl.length > 0
      ) {
        try {
          await connectStream(settings.lastStreamUrl)
          return
        } catch {
          setStatus('Сохранённый поток недоступен — выберите другой источник')
          activeVideoSource = 'stream'
          updateSourceUi()
        }
      }

      if (
        settings.lastSource === 'file' &&
        typeof settings.lastVideoPath === 'string' &&
        settings.lastVideoPath.length > 0
      ) {
        try {
          setStatus('Открытие сохранённого видео…')
          const url = await window.viewPeople.resolveFileUrl(settings.lastVideoPath)
          if (!url) {
            throw new Error('Пустой file URL')
          }
          await startFile(video, url)
          setStatus('Видео воспроизводится')
          activeVideoSource = 'file'
          updateSourceUi()
          startTimer()
          return
        } catch {
          setStatus('Сохранённый файл недоступен — выберите камеру или другой файл')
          activeVideoSource = 'file'
          updateSourceUi()
        }
      }

      if (settings.lastSource === 'camera' && hasCam) {
        camSelect.value = camId!
        activeVideoSource = 'camera'
        updateSourceUi()
        await onCameraChange()
        return
      }

      activeVideoSource = 'camera'
      updateSourceUi()
      if (camSelect.options.length > 0) {
        camSelect.selectedIndex = 0
        await onCameraChange()
      } else {
        setStatus('Нет камер — переключитесь на «Видеофайл» или «Трансляция»')
      }
    } catch (e) {
      lastAppliedMode = modeSelect.value as DetectorMode
      setStatus(`Старт: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()
}
