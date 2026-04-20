import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    /** Динамический import в worker → несколько чанков; iife в Vite 6 для этого запрещён. */
    worker: { format: 'es' },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      dedupe: ['@tensorflow/tfjs']
    },
    optimizeDeps: {
      include: ['@tensorflow/tfjs', '@tensorflow-models/coco-ssd', 'onnxruntime-web', 'hls.js']
    }
  }
})
