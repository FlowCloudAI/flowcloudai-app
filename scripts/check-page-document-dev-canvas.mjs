#!/usr/bin/env node

// 本冒烟测试启动真实 Vite 开发服务器，确认 canvas.html 绕过 HTML 变换且保持生产级精确哈希 CSP。

import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'parse5'
import {createInlineScriptCspSource} from './page-document-canvas-artifact.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.resolve(repositoryRoot, 'node_modules/vite/bin/vite.js')
const host = '127.0.0.1'
const targets = [
    {label: '桌面', platform: '', port: 5175},
    {label: 'Android', platform: 'android', port: 5176},
]

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function requestCanvas(server, url, output) {
    let lastError = null
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (server.exitCode !== null) {
            throw new Error(`Vite 开发服务器提前退出（${server.exitCode}）：\n${output()}`)
        }
        try {
            const response = await fetch(url)
            const body = await response.text()
            if (response.ok) return body
            lastError = new Error(`${response.status} ${body}`)
        } catch (error) {
            lastError = error
        }
        await delay(250)
    }
    throw new Error(`等待开发画布超时：${lastError instanceof Error ? lastError.message : String(lastError)}\n${output()}`)
}

function elementsUnder(root) {
    const result = []
    const visit = node => {
        if (node.tagName) result.push(node)
        for (const child of node.childNodes ?? []) visit(child)
    }
    visit(root)
    return result
}

function attribute(node, name) {
    return node.attrs?.find(candidate => candidate.name.toLowerCase() === name)?.value ?? null
}

function textContent(node) {
    if (node.nodeName === '#text') return node.value
    return (node.childNodes ?? []).map(textContent).join('')
}

async function stopServer(server) {
    if (server.exitCode !== null) return
    server.kill('SIGTERM')
    await Promise.race([
        new Promise(resolve => server.once('exit', resolve)),
        delay(3_000).then(() => {
            if (server.exitCode === null) server.kill('SIGKILL')
        }),
    ])
}

function assertCanvasArtifact(html, label, url) {
    const elements = elementsUnder(parse(html))
    const scripts = elements.filter(node => node.tagName === 'script')
    assert.equal(scripts.length, 1, '开发 canvas.html 必须恰有一个 script')
    const runtime = textContent(scripts[0])
    assert.notEqual(runtime.trim(), '', '开发 canvas.html 的唯一脚本不得为空')
    assert.equal(attribute(scripts[0], 'src'), null, '开发画布不得使用外链脚本')
    assert.notEqual(attribute(scripts[0], 'type')?.toLowerCase(), 'module', '开发画布不得使用模块脚本')
    assert.doesNotMatch(html, /\/@vite\/client|type=["']module["']|modulepreload/iu)

    const cspMeta = elements.find(node => node.tagName === 'meta'
        && attribute(node, 'http-equiv')?.toLowerCase() === 'content-security-policy')
    assert.ok(cspMeta, '开发 canvas.html 必须包含 meta CSP')
    const csp = attribute(cspMeta, 'content') ?? ''
    const scriptDirective = csp.split(';')
        .map(value => value.trim())
        .find(value => value.startsWith('script-src '))
    assert.equal(scriptDirective, `script-src ${createInlineScriptCspSource(runtime)}`)
    assert.doesNotMatch(scriptDirective ?? '', /'self'|'unsafe-inline'|'unsafe-eval'|nonce-/u)

    console.log(`${label}开发画布冒烟检查通过：${url} 返回 1 个内联脚本，${Buffer.byteLength(runtime, 'utf8')} 字节，${createInlineScriptCspSource(runtime)}。`)
}

async function checkTarget({label, platform, port}) {
    const url = `http://${host}:${port}/canvas.html`
    let output = ''
    const server = spawn(process.execPath, [viteEntry, '--host', host, '--port', String(port)], {
        cwd: repositoryRoot,
        env: {
            ...process.env,
            TAURI_DEV_HOST: host,
            TAURI_ENV_PLATFORM: platform,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout.on('data', chunk => {
        output += chunk.toString()
    })
    server.stderr.on('data', chunk => {
        output += chunk.toString()
    })
    try {
        const html = await requestCanvas(server, url, () => output)
        assertCanvasArtifact(html, label, url)
    } finally {
        await stopServer(server)
    }
}

for (const target of targets) {
    await checkTarget(target)
}
