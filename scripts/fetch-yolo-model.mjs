/**
 * Скачивает yolov8n.onnx в resources/models для офлайн-сборки установщика.
 * Повторный запуск пропускается, если файл уже есть.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dest = path.join(root, 'resources', 'models', 'yolov8n.onnx')
const FALLBACK_URLS = [
  'https://huggingface.co/cabelo/yolov8/resolve/main/yolov8n.onnx',
  'https://huggingface.co/Kalray/yolov8/resolve/main/yolov8n.onnx'
]

async function downloadFrom(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'viewPeople-setup-assets' }
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

if (fs.existsSync(dest)) {
  console.log('[setup:assets] yolov8n.onnx уже есть:', dest)
  process.exit(0)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })

if (process.env.YOLO_ONNX_URL) {
  try {
    const buf = await downloadFrom(process.env.YOLO_ONNX_URL)
    fs.writeFileSync(dest, buf)
  } catch (e) {
    throw new Error(`Скачивание yolov8n.onnx (${process.env.YOLO_ONNX_URL}): ${e.message}`)
  }
} else {
  let lastErr
  for (const url of FALLBACK_URLS) {
    try {
      const buf = await downloadFrom(url)
      fs.writeFileSync(dest, buf)
      lastErr = null
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) {
    throw new Error(
      `Скачивание yolov8n.onnx (все зеркала): ${lastErr.message}. Задайте YOLO_ONNX_URL.`
    )
  }
}
console.log('[setup:assets] сохранено:', dest)
