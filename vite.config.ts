import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const devHost = process.env.TAURI_DEV_HOST || process.env.HOST || '127.0.0.1'
const isAndroid = process.env.TAURI_ENV_PLATFORM === 'android'
const devPort = isAndroid ? 5176 : 5175
const hmrPort = isAndroid ? 1422 : 1421
const pageDocumentCanvasEnabled = process.env.VITE_PAGE_DOCUMENT_CANVAS === '1'

function normalizeModuleId(id: string): string {
    return id.replace(/\\/g, '/')
}

function matchesNodeModulePrefix(id: string, prefixes: string[]): boolean {
    const normalized = normalizeModuleId(id)
    return prefixes.some(prefix => normalized.includes(`/node_modules/${prefix}`))
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
            react: path.resolve(rootDir, 'node_modules/react'),
            'react-dom': path.resolve(rootDir, 'node_modules/react-dom'),
            'react/jsx-runtime': path.resolve(rootDir, 'node_modules/react/jsx-runtime.js'),
            'react/jsx-dev-runtime': path.resolve(rootDir, 'node_modules/react/jsx-dev-runtime.js'),
        },
    },
    optimizeDeps: {
        include: ['react', 'react-dom', 'react/jsx-runtime'],
    },
    // 防止 Vite 清除 Rust 显示的错误
    clearScreen: false,
    server: {
        port: devPort,
        // Tauri 工作于固定端口，如果端口不可用则报错
        strictPort: true,
        // Android/iOS 开发模式下，Tauri 会注入 TAURI_DEV_HOST，前端必须监听该地址。
        host: devHost,
        hmr: {
            protocol: 'ws',
            host: devHost,
            port: hmrPort,
        },
        watch: {
            // 告诉 Vite 忽略监听 `src-tauri` 目录
            ignored: ['**/src-tauri/**'],
        },
        fs: {
            allow: ['..'],
        },
    },
    // 添加有关当前构建目标的额外前缀，使这些 CLI 设置的 Tauri 环境变量可以在客户端代码中访问
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
        // Tauri 在 Windows 上使用 Chromium，在 macOS 和 Linux 上使用 WebKit
        target:
            process.env.TAURI_ENV_PLATFORM == 'windows'
                ? 'chrome105'
                : 'safari13',
        // 在 debug 构建中不使用 minify
        minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
        // 在 debug 构建中生成 sourcemap
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
        rollupOptions: {
            input: pageDocumentCanvasEnabled
                ? {
                    main: path.resolve(rootDir, 'index.html'),
                    canvas: path.resolve(rootDir, 'canvas.html'),
                }
                : path.resolve(rootDir, 'index.html'),
            output: {
                manualChunks(id) {
                    const normalized = normalizeModuleId(id)

                    if (normalized.includes('vite/preload-helper')) {
                        return 'vite-preload'
                    }

                    if (!normalized.includes('/node_modules/')) return
                    if (normalized.endsWith('.css')) return

                    // React 基础运行时，几乎所有页面都会用到。
                    if (matchesNodeModulePrefix(normalized, [
                        'react/',
                        'react-dom/',
                        'scheduler/',
                    ])) {
                        return 'react-vendor'
                    }

                    // Tauri 桥接层单独拆出，避免混进主包。
                    if (matchesNodeModulePrefix(normalized, [
                        '@tauri-apps/api/',
                        '@tauri-apps/plugin-dialog/',
                        '@tauri-apps/plugin-log/',
                        '@tauri-apps/plugin-opener/',
                        '@tauri-apps/plugin-sql/',
                    ])) {
                        return 'tauri-vendor'
                    }

                    // 国际化在设置页、入口页和编辑页都会共用，但不该和 React/地图混在一起。
                    if (matchesNodeModulePrefix(normalized, [
                        'i18next/',
                        'react-i18next/',
                        'i18next-browser-languagedetector/',
                    ])) {
                        return 'i18n-vendor'
                    }

                    // Pixi 地图渲染链独立打包，避免进入非地图页面时加载。
                    if (matchesNodeModulePrefix(normalized, [
                        '@pixi/react/',
                        'pixi.js/',
                    ])) {
                        return 'pixi-vendor'
                    }

                    // Markdown 编辑器及其语法树链通常体积较大，适合和主工作台隔离。
                    if (matchesNodeModulePrefix(normalized, [
                        '@uiw/react-md-editor/',
                        '@uiw/react-markdown-preview/',
                        '@codemirror/',
                        'codemirror/',
                        'unified/',
                        'remark-',
                        'rehype-',
                        'micromark',
                        'mdast-',
                        'hast-',
                        'property-information/',
                        'space-separated-tokens/',
                        'comma-separated-tokens/',
                    ])) {
                        return 'markdown-vendor'
                    }

                    // 内部 UI 库和常用前端辅助库拆成共享 UI 包，减轻主入口体积。
                    if (matchesNodeModulePrefix(normalized, [
                        'flowcloudai-ui/',
                        'classnames/',
                        'react-dropzone/',
                        'react-window/',
                    ])) {
                        return 'ui-vendor'
                    }
                },
            },
        },
    },
})
