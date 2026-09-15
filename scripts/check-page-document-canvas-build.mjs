#!/usr/bin/env node

// 本检查锁定经典脚本产物契约，防止 Vite 再为 opaque-origin 画布生成模块或 crossorigin 资源。

import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(repositoryRoot, 'dist')
const htmlPath = path.resolve(outputRoot, 'canvas.html')

assert.equal(existsSync(htmlPath), true, '开关构建缺少 dist/canvas.html')
const html = readFileSync(htmlPath, 'utf8')
assert.doesNotMatch(html, /type\s*=\s*["']module["']/iu)
assert.doesNotMatch(html, /crossorigin/iu)
assert.doesNotMatch(html, /modulepreload/iu)
assert.match(html, /<script\s+src="\/canvas\/runtime\.js"\s+defer><\/script>/u)
assert.match(html, /<link\s+rel="stylesheet"\s+href="\/canvas\/runtime\.css">/u)

const resourcePaths = [...html.matchAll(/(?:src|href)="\/(canvas\/[^"#?]+)"/gu)]
    .map(match => path.resolve(outputRoot, match[1]))
assert.deepEqual(
    resourcePaths.map(resourcePath => path.relative(outputRoot, resourcePath)).sort(),
    ['canvas/runtime.css', 'canvas/runtime.js'],
)
for (const resourcePath of resourcePaths) {
    assert.equal(existsSync(resourcePath), true, `画布引用的资源不存在：${resourcePath}`)
}

const runtime = readFileSync(path.resolve(outputRoot, 'canvas/runtime.js'), 'utf8')
assert.doesNotMatch(runtime, /^\s*(?:import|export)\s/mu, '画布运行时不得保留 ESM import/export')

console.log('画布产物检查通过：canvas.html 只引用无 crossorigin 的经典脚本与普通样式表。')
