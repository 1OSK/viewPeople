/**
 * Качает yt-dlp.exe (Windows x64) в resources/bin для разрешения URL страниц (Twitch, YouTube…).
 * На других ОС пропуск — положите бинарник вручную или задайте YT_DLP_PATH.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dest = path.join(root, 'resources', 'bin', 'yt-dlp.exe')

if (process.platform !== 'win32') {
  console.log('[setup:assets] yt-dlp.exe: автоскачивание только для Windows — пропуск')
  process.exit(0)
}
const url =
  process.env.YTDLP_DOWNLOAD_URL ??
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

if (fs.existsSync(dest)) {
  console.log('[setup:assets] yt-dlp.exe уже есть:', dest)
  process.exit(0)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })

const res = await fetch(url, {
  redirect: 'follow',
  headers: { 'User-Agent': 'viewPeople-setup-assets' }
})
if (!res.ok) {
  throw new Error(`Скачивание yt-dlp.exe: HTTP ${res.status}`)
}
fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
console.log('[setup:assets] сохранено:', dest)
