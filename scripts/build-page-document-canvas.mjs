#!/usr/bin/env node

// 本脚本只在显式开关构建中追加经典画布产物；默认构建必须保持没有画布文件。

import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

if (process.env.VITE_PAGE_DOCUMENT_CANVAS === '1') {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const viteEntry = path.resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
    const checkEntry = path.resolve(repositoryRoot, 'scripts/check-page-document-canvas-build.mjs')

    for (const args of [
        [viteEntry, 'build', '--config', 'vite.canvas.config.ts'],
        [checkEntry],
    ]) {
        const result = spawnSync(process.execPath, args, {
            cwd: repositoryRoot,
            env: process.env,
            stdio: 'inherit',
        })
        if (result.error) throw result.error
        if (result.status !== 0) process.exit(result.status ?? 1)
    }
}
