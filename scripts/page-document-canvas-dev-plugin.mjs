// 本插件在开发服务器最前端直接返回组装后的隔离画布；响应不进入 Vite HTML 变换与 HMR 注入。

import path from 'node:path'
import {build as viteBuild} from 'vite'
import {assemblePageDocumentCanvasHtml} from './page-document-canvas-artifact.mjs'

function normalizePath(value) {
    return value.replace(/\\/gu, '/')
}

function outputItems(result) {
    return (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
}

async function buildCanvasHtml(repositoryRoot) {
    const result = await viteBuild({
        configFile: path.resolve(repositoryRoot, 'vite.canvas.config.ts'),
        logLevel: 'silent',
        build: {
            write: false,
        },
    })
    const output = outputItems(result)
    const runtime = output.find(item => item.type === 'chunk' && item.fileName === 'canvas/runtime.js')
    const skeleton = output.find(item => item.type === 'asset' && item.fileName === 'canvas.html')
    if (!runtime || runtime.type !== 'chunk') {
        throw new Error('开发画布构建没有生成 canvas/runtime.js。')
    }
    if (!skeleton || skeleton.type !== 'asset') {
        throw new Error('开发画布构建没有生成 canvas.html 骨架。')
    }
    const skeletonText = typeof skeleton.source === 'string'
        ? skeleton.source
        : Buffer.from(skeleton.source).toString('utf8')
    return assemblePageDocumentCanvasHtml(skeletonText, runtime.code).html
}

function affectsCanvasRuntime(repositoryRoot, file) {
    const relative = normalizePath(path.relative(repositoryRoot, file))
    return relative === 'canvas.html'
        || relative === 'vite.canvas.config.ts'
        || relative === 'scripts/page-document-canvas-artifact.mjs'
        || relative.startsWith('src/features/page-document/')
}

export function pageDocumentCanvasDevPlugin(repositoryRoot) {
    let dirty = true
    let cachedHtml = null
    let assembling = null

    const assemble = async () => {
        if (!dirty && cachedHtml !== null) return cachedHtml
        if (assembling) return assembling
        dirty = false
        assembling = buildCanvasHtml(repositoryRoot)
            .then(html => {
                cachedHtml = html
                return html
            })
            .catch(error => {
                dirty = true
                throw error
            })
            .finally(() => {
                assembling = null
            })
        return assembling
    }

    return {
        name: 'page-document-canvas-dev-artifact',
        apply: 'serve',
        configureServer(server) {
            const invalidate = file => {
                if (affectsCanvasRuntime(repositoryRoot, file)) dirty = true
            }
            server.watcher.on('add', invalidate)
            server.watcher.on('change', invalidate)
            server.watcher.on('unlink', invalidate)

            // configureServer 内直接注册的中间件早于 Vite 内部 HTML fallback，故不会注入 HMR 客户端。
            server.middlewares.use(async (request, response, next) => {
                const pathname = new URL(request.url ?? '/', 'http://vite.invalid').pathname
                if (pathname !== '/canvas.html') {
                    next()
                    return
                }
                try {
                    const html = await assemble()
                    response.statusCode = 200
                    response.setHeader('Content-Type', 'text/html; charset=utf-8')
                    response.setHeader('Cache-Control', 'no-store')
                    response.end(Buffer.from(html, 'utf8'))
                } catch (error) {
                    response.statusCode = 500
                    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
                    response.end(`隔离画布开发制品组装失败：${error instanceof Error ? error.message : String(error)}`)
                }
            })
        },
    }
}
