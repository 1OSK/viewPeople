import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import './style.css'
import { mountApp } from './ui/app'

const root = document.querySelector<HTMLElement>('#root')
if (root) {
  mountApp(root)
}
