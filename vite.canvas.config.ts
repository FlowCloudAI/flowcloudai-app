// 本配置只构建 opaque-origin 画布运行时；IIFE 经典脚本避免模块脚本对 Origin: null 发起 CORS 校验。

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    plugins: [{
        name: 'emit-page-document-canvas-html',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'canvas.html',
                source: readFileSync(path.resolve(rootDir, 'canvas.html'), 'utf8'),
            })
        },
    }],
    build: {
        target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
        minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
        sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
        outDir: path.resolve(rootDir, 'dist'),
        emptyOutDir: false,
        copyPublicDir: false,
        cssCodeSplit: false,
        lib: {
            entry: path.resolve(rootDir, 'src/features/page-document/canvas/runtime/main.ts'),
            name: 'PageDocumentCanvasRuntime',
            formats: ['iife'],
            fileName: () => 'canvas/runtime.js',
            cssFileName: 'canvas/runtime',
        },
    },
})
