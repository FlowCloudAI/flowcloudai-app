// 本配置只生成待内嵌的 opaque-origin 画布运行时；最终 HTML 与 CSP 哈希由构建脚本组装。

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.LANG': 'undefined',
    },
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
        sourcemap: false,
        outDir: path.resolve(rootDir, 'dist'),
        emptyOutDir: false,
        copyPublicDir: false,
        cssCodeSplit: false,
        lib: {
            entry: path.resolve(rootDir, 'src/features/page-document/canvas/runtime/main.ts'),
            name: 'PageDocumentCanvasRuntime',
            formats: ['iife'],
            fileName: () => 'canvas/runtime.js',
        },
    },
})
