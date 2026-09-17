#!/usr/bin/env node

// 本检查锁定单内联脚本及其精确 CSP 哈希，防止 opaque-origin 画布重新依赖外部资源或 nonce。

import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'parse5'
import {createInlineScriptCspSource} from './page-document-canvas-artifact.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(repositoryRoot, 'dist')
const htmlPath = path.resolve(outputRoot, 'canvas.html')

assert.equal(existsSync(htmlPath), true, '开关构建缺少 dist/canvas.html')
const html = readFileSync(htmlPath, 'utf8')
const parsed = parse(html)
const elements = []

function visit(node, parent = null) {
    if (node.tagName) elements.push({node, parent})
    for (const child of node.childNodes ?? []) visit(child, node)
}

function attribute(node, name) {
    return node.attrs?.find(candidate => candidate.name.toLowerCase() === name)?.value ?? null
}

function textContent(node) {
    if (node.nodeName === '#text') return node.value
    return (node.childNodes ?? []).map(textContent).join('')
}

visit(parsed)

const scripts = elements.filter(element => element.node.tagName === 'script')
const bodies = elements.filter(element => element.node.tagName === 'body')
const roots = elements.filter(element => element.node.tagName === 'main'
    && attribute(element.node, 'id') === 'page-document-canvas-root')
assert.equal(scripts.length, 1, 'canvas.html 必须恰有一个 script 元素')
assert.equal(bodies.length, 1, 'canvas.html 必须恰有一个 body 元素')
assert.equal(roots.length, 1, 'canvas.html 必须恰有一个 main#page-document-canvas-root')

const script = scripts[0]
const body = bodies[0].node
const root = roots[0]
assert.equal(script.parent, body, '唯一脚本必须位于 body 内')
assert.equal(root.parent, body, '画布根节点必须直接位于 body 内')
assert.ok(body.childNodes.indexOf(script.node) > body.childNodes.indexOf(root.node), '唯一脚本必须位于画布根节点之后')
assert.equal(attribute(script.node, 'src'), null, '唯一脚本不得引用外部资源')
assert.notEqual(attribute(script.node, 'type')?.toLowerCase(), 'module', '唯一脚本不得是模块脚本')

for (const {node} of elements) {
    assert.equal(attribute(node, 'crossorigin'), null, '画布资源不得带 crossorigin')
    assert.notEqual(attribute(node, 'rel')?.toLowerCase(), 'modulepreload', '画布不得生成 modulepreload')
    for (const name of ['src', 'srcset', 'poster', 'data']) {
        if (node === script.node && name === 'src') continue
        assert.equal(attribute(node, name), null, `画布不得通过 ${name} 引用外部资源`)
    }
    if (node.tagName === 'link') assert.equal(attribute(node, 'href'), null, '画布不得引用外部 link 资源')
}
assert.equal(elements.some(element => element.node.tagName === 'style'), false, '画布 HTML 不得含构建期会被 Tauri 注入 nonce 的 style 元素')

const runtime = textContent(script.node)
assert.notEqual(runtime.trim(), '', '唯一内联脚本不得为空')
assert.doesNotMatch(runtime, /process\.env/u, '内联运行时不得保留 process.env 引用')
assert.doesNotMatch(runtime, /<\/script/iu, '内联运行时必须转义 HTML script 结束标签')

const cspMetas = elements.filter(element => element.node.tagName === 'meta'
    && attribute(element.node, 'http-equiv')?.toLowerCase() === 'content-security-policy')
assert.equal(cspMetas.length, 1, 'canvas.html 必须恰有一个 meta CSP')
const csp = attribute(cspMetas[0].node, 'content')
assert.ok(csp, 'canvas.html 的 meta CSP 不得为空')
const directiveParts = csp.split(';').map(directive => directive.trim().split(/\s+/u)).filter(parts => parts[0])
const directives = new Map(directiveParts.map(([name, ...sources]) => [name, sources.join(' ')]))
assert.equal(directives.size, directiveParts.length, '画布 CSP 不得重复声明指令')
assert.equal(directives.get('img-src'), 'data:', '画布只为运行时受管像素开放 data: 图片')
for (const name of ['default-src', 'connect-src', 'font-src', 'media-src', 'object-src', 'frame-src', 'child-src', 'worker-src', 'manifest-src', 'prefetch-src', 'base-uri', 'form-action']) {
    assert.equal(directives.get(name), "'none'", `${name} 不得随图片能力放宽`)
}
const scriptDirective = csp.split(';')
    .map(directive => directive.trim())
    .find(directive => directive.startsWith('script-src '))
assert.equal(scriptDirective, `script-src ${createInlineScriptCspSource(runtime)}`)
assert.doesNotMatch(scriptDirective, /'self'|'unsafe-inline'|'unsafe-eval'/u)

assert.equal(existsSync(path.resolve(outputRoot, 'canvas/runtime.js')), false)
assert.equal(existsSync(path.resolve(outputRoot, 'canvas/runtime.css')), false)

console.log(`画布产物检查通过：1 个内联脚本，${Buffer.byteLength(runtime, 'utf8')} 字节，${createInlineScriptCspSource(runtime)}。`)
