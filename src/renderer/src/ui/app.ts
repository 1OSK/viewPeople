import type { DetectorMode } from '../../../shared/detector'
import type { AppSettings } from '../../../shared/settings'
import {
  countPeopleOnCanvas,
  countPeopleOnImageBitmap,
  disposeDetectorWorker,
  ensureDetectorLoaded,
  ensureSecondDetectorWorker,
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
        <p class="lede">В режиме «Камера» — одновременно до двух устройств и отдельный счёт. Файл и поток — один кадр. Трансляции — URL (Twitch и др.) через yt-dlp из сборки.</p>
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
              <label for="cam-select">Камера 1</label>
              <select id="cam-select" aria-label="Первая камера"></select>
            </div>
            <div class="field">
              <label for="cam-select-2">Камера 2</label>
              <select id="cam-select-2" aria-label="Вторая камера (необязательно)">
                <option value="">— не выбрана —</option>
              </select>
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

      <section class="preview-wrap" id="preview-wrap" aria-label="Превью">
        <div class="preview-row-dual" id="preview-dual" hidden>
          <div class="preview-cell">
            <video id="preview-1" class="preview" playsinline muted></video>
            <p class="preview-label">Камера 1</p>
          </div>
          <div class="preview-cell">
            <video id="preview-2" class="preview" playsinline muted></video>
            <p class="preview-label">Камера 2</p>
          </div>
        </div>
        <div class="preview-row-single" id="preview-single">
          <video id="preview" class="preview" playsinline muted></video>
        </div>
      </section>

      <canvas id="grab" class="grab" width="0" height="0" hidden></canvas>

      <section class="stats" aria-label="Результат">
        <div id="stats-hero-dual" class="stats-hero-dual" hidden>
          <div class="stat stat--hero stat--cam">
            <span class="label">Камера 1, людей</span>
            <span class="value" id="count-1">—</span>
          </div>
          <div class="stat stat--hero stat--cam">
            <span class="label">Камера 2, людей</span>
            <span class="value" id="count-2">—</span>
          </div>
          <div class="stat stat--hero stat--cam stat--total">
            <span class="label">Итого (камера 1 + камера 2)</span>
            <span class="value" id="count-total">—</span>
          </div>
        </div>
        <div id="stats-hero-single" class="stat stat--hero">
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
  const video1 = qs<HTMLVideoElement>(root, '#preview-1')!
  const video2 = qs<HTMLVideoElement>(root, '#preview-2')!
  const previewWrap = qs<HTMLElement>(root, '#preview-wrap')!
  const previewDual = qs<HTMLElement>(root, '#preview-dual')!
  const previewSingle = qs<HTMLElement>(root, '#preview-single')!
  const statsHeroDual = qs<HTMLElement>(root, '#stats-hero-dual')!
  const statsHeroSingle = qs<HTMLElement>(root, '#stats-hero-single')!
  const canvas = qs<HTMLCanvasElement>(root, '#grab')!
  const modeSelect = qs<HTMLSelectElement>(root, '#detector-mode')!
  const camSelect = qs<HTMLSelectElement>(root, '#cam-select')!
  const camSelect2 = qs<HTMLSelectElement>(root, '#cam-select-2')!
  const btnRefresh = qs<HTMLButtonElement>(root, '#btn-refresh')!
  const btnFile = qs<HTMLButtonElement>(root, '#btn-file')!
  const streamUrlInput = qs<HTMLInputElement>(root, '#stream-url')!
  const btnStream = qs<HTMLButtonElement>(root, '#btn-stream')!
  const intervalInput = qs<HTMLInputElement>(root, '#interval')!
  const countEl = qs(root, '#count')!
  const count1El = qs(root, '#count-1')!
  const count2El = qs(root, '#count-2')!
  const countTotalEl = qs(root, '#count-total')!
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
  /** Номер актуального асинхронного переключения источника (защита от гонок UI). */
  let sourceSwitchToken = 0

  const setStatus = (text: string): void => {
    statusEl.textContent = text
  }

  /** Режим «камера»: два превью + два показателя; иначе одно полноэкранное превью и одно число. */
  const syncPreviewAndStats = (): void => {
    const dual = activeVideoSource === 'camera'
    previewWrap.classList.toggle('preview-wrap--dual', dual)
    previewDual.hidden = !dual
    previewSingle.hidden = dual
    statsHeroDual.hidden = !dual
    statsHeroSingle.hidden = dual
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
    stopVideoElement(video1)
    stopVideoElement(video2)
    countEl.textContent = '—'
    count1El.textContent = '—'
    count2El.textContent = '—'
    countTotalEl.textContent = '—'
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
    syncPreviewAndStats()
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
    if (activeVideoSource === 'camera') {
      const id2 = camSelect2.value
      const snap1 = drawVideoFrame(video1, canvas)
      if (!snap1) {
        return
      }
      busy = true
      const t0 = snap1.capturedAt
      lastFrameEl.textContent = new Date(t0).toLocaleTimeString()
      try {
        if (id2) {
          const bitmap1 = await createImageBitmap(canvas)
          try {
            const snap2 = drawVideoFrame(video2, canvas)
            if (!snap2) {
              const n1 = await countPeopleOnImageBitmap(bitmap1, 0, 0.5)
              count1El.textContent = String(n1)
              count2El.textContent = '—'
              countTotalEl.textContent = String(n1)
              return
            }
            const t1 = Math.max(t0, snap2.capturedAt)
            lastFrameEl.textContent = new Date(t1).toLocaleTimeString()
            const bitmap2 = await createImageBitmap(canvas)
            try {
              const [r0, r1] = await Promise.allSettled([
                countPeopleOnImageBitmap(bitmap1, 0, 0.5),
                countPeopleOnImageBitmap(bitmap2, 1, 0.5)
              ])
              if (r0.status === 'fulfilled') {
                count1El.textContent = String(r0.value)
              } else {
                count1El.textContent = '—'
              }
              if (r1.status === 'fulfilled') {
                count2El.textContent = String(r1.value)
              } else {
                count2El.textContent = '—'
              }
              const v1 = r0.status === 'fulfilled' ? r0.value : 0
              const v2 = r1.status === 'fulfilled' ? r1.value : 0
              countTotalEl.textContent = String(v1 + v2)
              const err0 = r0.status === 'rejected' ? r0.reason : null
              const err1 = r1.status === 'rejected' ? r1.reason : null
              if (err0 ?? err1) {
                const parts = [err0, err1]
                  .filter((x) => x != null)
                  .map((e) => (e instanceof Error ? e.message : String(e)))
                setStatus(`Детекция: ${parts.join(' · ')}`)
              }
            } finally {
              try {
                bitmap2.close()
              } catch {
                // no-op: bitmap may already be detached/closed after transfer
              }
            }
          } finally {
            try {
              bitmap1.close()
            } catch {
              // no-op: bitmap may already be detached/closed after transfer
            }
          }
        } else {
          const n1 = await countPeopleOnCanvas(canvas, 0.5, 0)
          count1El.textContent = String(n1)
          count2El.textContent = '—'
          countTotalEl.textContent = String(n1)
        }
      } catch (e) {
        setStatus(`Детекция: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        busy = false
      }
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
      const current2 = camSelect2.value
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

      camSelect2.replaceChildren()
      const empty2 = document.createElement('option')
      empty2.value = ''
      empty2.textContent = '— не выбрана —'
      camSelect2.appendChild(empty2)
      for (const d of devices) {
        const opt = document.createElement('option')
        opt.value = d.deviceId
        opt.textContent = d.label || `Камера ${d.deviceId.slice(0, 8)}…`
        camSelect2.appendChild(opt)
      }
      if (current2 && [...camSelect2.options].some((o) => o.value === current2)) {
        camSelect2.value = current2
      } else {
        camSelect2.value = ''
      }
      if (camSelect2.value && camSelect2.value === camSelect.value) {
        camSelect2.value = ''
      }

      setStatus('Список камер обновлён')
    } catch (e) {
      setStatus(`Камеры: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onCameraChange = async (token?: number): Promise<void> => {
    const id = camSelect.value
    if (!id) {
      return
    }
    let id2 = camSelect2.value
    if (id2 && id2 === id) {
      // Защита от двойного открытия одного и того же устройства: на части драйверов это даёт "зелёное" мерцание.
      camSelect2.value = ''
      id2 = ''
      setStatus('Камера 2 совпадает с Камерой 1 — второй канал отключён')
    }
    try {
      setStatus(id2 ? 'Запуск двух камер…' : 'Запуск камеры…')
      await startCamera(video1, id)
      if (token !== undefined && token !== sourceSwitchToken) {
        return
      }
      if (activeVideoSource !== 'camera') {
        return
      }
      if (id2) {
        await startCamera(video2, id2)
        if (token !== undefined && token !== sourceSwitchToken) {
          return
        }
        if (activeVideoSource !== 'camera') {
          return
        }
        setStatus('Загрузка модели для канала 2 (параллельный воркер)…')
        await ensureSecondDetectorWorker(setStatus)
      } else {
        stopVideoElement(video2)
      }
      setStatus(id2 ? 'Обе камеры активны' : 'Камера 1 активна')
      const patch: Partial<AppSettings> = {
        cameraDeviceId: id,
        lastSource: 'camera',
        lastStreamUrl: ''
      }
      if (id2) {
        patch.cameraDeviceId2 = id2
      } else {
        patch.cameraDeviceId2 = null
      }
      persist(patch)
      startTimer()
    } catch (e) {
      setStatus(`Камера: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const connectStream = async (pageUrl: string, token?: number): Promise<void> => {
    const api = window.viewPeople
    if (!api.resolveStreamUrl) {
      throw new Error('Нет API resolveStreamUrl (preload)')
    }
    prepareVideoSwitch()
    setStatus('Разрешение ссылки…')
    const res = await api.resolveStreamUrl(pageUrl.trim())
    if (token !== undefined && token !== sourceSwitchToken) {
      return
    }
    if (activeVideoSource !== 'stream') {
      return
    }
    if (!res.ok) {
      throw new Error(res.message)
    }
    if (res.warning) {
      setStatus(res.warning)
    }
    setStatus('Запуск потока…')
    await startHttpStream(video, res.url)
    if (token !== undefined && token !== sourceSwitchToken) {
      return
    }
    if (activeVideoSource !== 'stream') {
      return
    }
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
    const token = ++sourceSwitchToken
    prepareVideoSwitch()
    activeVideoSource = mode
    updateSourceUi()

    if (mode === 'camera') {
      persist({ lastSource: 'camera', lastStreamUrl: '' })
      await onCameraChange(token)
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
    void onCameraChange(++sourceSwitchToken)
  })

  camSelect2.addEventListener('change', () => {
    if (activeVideoSource !== 'camera') {
      return
    }
    void onCameraChange(++sourceSwitchToken)
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
        await connectStream(raw, ++sourceSwitchToken)
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
    stopVideoElement(video1)
    stopVideoElement(video2)
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
      const camId2 = settings.cameraDeviceId2
      const hasCam2 =
        typeof camId2 === 'string' &&
        camId2.length > 0 &&
        [...camSelect2.options].some((o) => o.value === camId2)
      if (hasCam2) {
        camSelect2.value = camId2
      } else {
        camSelect2.value = ''
      }

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
          await connectStream(settings.lastStreamUrl, ++sourceSwitchToken)
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
        await onCameraChange(++sourceSwitchToken)
        return
      }

      activeVideoSource = 'camera'
      updateSourceUi()
      if (camSelect.options.length > 0) {
        camSelect.selectedIndex = 0
        await onCameraChange(++sourceSwitchToken)
      } else {
        setStatus('Нет камер — переключитесь на «Видеофайл» или «Трансляция»')
      }
    } catch (e) {
      lastAppliedMode = modeSelect.value as DetectorMode
      setStatus(`Старт: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()
}
