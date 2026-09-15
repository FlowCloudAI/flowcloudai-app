#!/usr/bin/env node

// 本脚本只在显式开关构建中把临时 IIFE 内嵌为带精确哈希的画布页；默认构建不得产生画布文件。

import {spawnSync} from 'node:child_process'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    CANVAS_CSP_PLACEHOLDER,
    CANVAS_RUNTIME_PLACEHOLDER,
    createInlineScriptCspSource,
    escapeInlineScript,
    replaceExactlyOnce,
} from './page-document-canvas-artifact.mjs'

if (process.env.VITE_PAGE_DOCUMENT_CANVAS === '1') {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const viteEntry = path.resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
    const checkEntry = path.resolve(repositoryRoot, 'scripts/check-page-document-canvas-build.mjs')
    const outputRoot = path.resolve(repositoryRoot, 'dist')
    const htmlPath = path.resolve(outputRoot, 'canvas.html')
    const runtimeDirectory = path.resolve(outputRoot, 'canvas')
    const runtimePath = path.resolve(runtimeDirectory, 'runtime.js')

    const build = spawnSync(process.execPath, [viteEntry, 'build', '--config', 'vite.canvas.config.ts'], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: 'inherit',
    })
    if (build.error) throw build.error
    if (build.status !== 0) process.exit(build.status ?? 1)

    const runtime = escapeInlineScript(readFileSync(runtimePath, 'utf8'))
    const cspSource = createInlineScriptCspSource(runtime)
    let html = readFileSync(htmlPath, 'utf8')
    html = replaceExactlyOnce(html, CANVAS_CSP_PLACEHOLDER, cspSource)
    html = replaceExactlyOnce(html, CANVAS_RUNTIME_PLACEHOLDER, `<script>${runtime}</script>`)
    writeFileSync(htmlPath, html, 'utf8')
    rmSync(runtimeDirectory, {recursive: true, force: true})

    const check = spawnSync(process.execPath, [checkEntry], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: 'inherit',
    })
    if (check.error) throw check.error
    if (check.status !== 0) {
        process.exit(check.status ?? 1)
    }
} else {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const checkEntry = path.resolve(repositoryRoot, 'scripts/check-page-document-default-build.mjs')
    const check = spawnSync(process.execPath, [checkEntry], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: 'inherit',
    })
    if (check.error) throw check.error
    if (check.status !== 0) process.exit(check.status ?? 1)
}
