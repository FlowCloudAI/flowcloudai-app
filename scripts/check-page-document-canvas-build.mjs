#!/usr/bin/env node

// 本检查锁定单内联脚本及其精确 CSP 哈希，防止 opaque-origin 画布重新依赖外部资源或 nonce。

import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createInlineScriptCspSource} from './page-document-canvas-artifact.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(repositoryRoot, 'dist')
const htmlPath = path.resolve(outputRoot, 'canvas.html')

assert.equal(existsSync(htmlPath), true, '开关构建缺少 dist/canvas.html')
const html = readFileSync(htmlPath, 'utf8')
assert.doesNotMatch(html, /type\s*=\s*["']module["']/iu)
assert.doesNotMatch(html, /crossorigin/iu)
assert.doesNotMatch(html, /modulepreload/iu)
assert.doesNotMatch(html, /<style\b/iu, '画布 HTML 不得含构建期会被 Tauri 注入 nonce 的 style 元素')
assert.doesNotMatch(html, /<link\b[^>]*\brel\s*=\s*["']stylesheet["']/iu, '画布不得引用外部样式表')

const openingScripts = [...html.matchAll(/<script\b([^>]*)>/giu)]
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
assert.equal(openingScripts.length, 1, 'canvas.html 必须恰有一个 script 元素')
assert.equal(inlineScripts.length, 1, 'canvas.html 必须恰有一个完整的内联 script 元素')
assert.doesNotMatch(openingScripts[0][1], /\bsrc\s*=/iu, '唯一脚本不得引用外部资源')
const runtime = inlineScripts[0][2]
assert.notEqual(runtime.trim(), '', '唯一内联脚本不得为空')
assert.doesNotMatch(runtime, /process\.env/u, '内联运行时不得保留 process.env 引用')
assert.doesNotMatch(runtime, /<\/script/iu, '内联运行时必须转义 HTML script 结束标签')

const cspMatch = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)">/iu.exec(html)
assert.ok(cspMatch, 'canvas.html 缺少 meta CSP')
const scriptDirective = cspMatch[1].split(';')
    .map(directive => directive.trim())
    .find(directive => directive.startsWith('script-src '))
assert.equal(scriptDirective, `script-src ${createInlineScriptCspSource(runtime)}`)
assert.doesNotMatch(scriptDirective, /'self'|'unsafe-inline'|'unsafe-eval'/u)

assert.equal(existsSync(path.resolve(outputRoot, 'canvas/runtime.js')), false)
assert.equal(existsSync(path.resolve(outputRoot, 'canvas/runtime.css')), false)

console.log(`画布产物检查通过：1 个内联脚本，${Buffer.byteLength(runtime, 'utf8')} 字节，${createInlineScriptCspSource(runtime)}。`)
