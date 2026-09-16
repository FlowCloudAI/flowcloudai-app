#!/usr/bin/env node

// 本脚本为每次应用构建组装带精确哈希的隔离画布，并在交付 dist 前执行画布与入口检查。

import {spawnSync} from 'node:child_process'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    assemblePageDocumentCanvasHtml,
} from './page-document-canvas-artifact.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
const canvasCheckEntry = path.resolve(repositoryRoot, 'scripts/check-page-document-canvas-build.mjs')
const appCheckEntry = path.resolve(repositoryRoot, 'scripts/check-page-document-app-build.mjs')
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

const artifact = assemblePageDocumentCanvasHtml(
    readFileSync(htmlPath, 'utf8'),
    readFileSync(runtimePath, 'utf8'),
)
writeFileSync(htmlPath, artifact.html, 'utf8')
rmSync(runtimeDirectory, {recursive: true, force: true})

for (const checkEntry of [canvasCheckEntry, appCheckEntry]) {
    const check = spawnSync(process.execPath, [checkEntry], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: 'inherit',
    })
    if (check.error) throw check.error
    if (check.status !== 0) process.exit(check.status ?? 1)
}
