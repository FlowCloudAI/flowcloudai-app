#!/usr/bin/env node

// 本脚本确认正式页面编辑与隔离画布进入每个应用产物，同时把开发探针限制在独立开关内。

import assert from 'node:assert/strict'
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(repositoryRoot, 'dist')
const probeEnabled = process.env.VITE_PAGE_DOCUMENT_PROBE === '1'
const probeMarkers = [
    '隔离探针',
    '跳过作者侧校验，仅用于验证隔离',
    'forbidden-script',
    'external-css-url',
    'svg-image-external-href',
    'tests/fixtures/page-document',
    'malicious-cases.json',
]

function filesUnder(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? filesUnder(target) : [target]
    })
}

assert.equal(existsSync(outputRoot) && statSync(outputRoot).isDirectory(), true, '应用构建产物 dist 不存在')
assert.equal(existsSync(path.join(outputRoot, 'canvas.html')), true, '应用构建必须包含 canvas.html')

const files = filesUnder(outputRoot)
const searchable = files.filter(file => /\.(?:css|html|js|json|map)$/iu.test(file))
const contents = searchable.map(file => ({file, text: readFileSync(file, 'utf8')}))
const joined = contents.map(item => item.text).join('\n')

assert.match(joined, /页面编辑/u, '应用构建必须包含页面编辑入口文案')
assert.ok(
    files.some(file => /^page-document-editor-vendor-.+\.js$/u.test(path.basename(file))),
    'CodeMirror 必须保留在 page-document-editor-vendor 独立分块',
)

if (probeEnabled) {
    assert.match(joined, /隔离探针/u, '探针开关构建必须包含隔离探针入口')
    assert.match(joined, /forbidden-script/u, '探针开关构建必须包含共享恶意样例')
    console.log('页面文档应用构建检查通过：画布与编辑器默认存在，隔离探针按新开关进入产物。')
} else {
    for (const marker of probeMarkers) {
        const match = contents.find(item => item.text.includes(marker))
        assert.equal(
            match,
            undefined,
            `默认应用产物 ${match ? path.relative(outputRoot, match.file) : ''} 含探针标记：${marker}`,
        )
    }
    console.log('页面文档应用构建检查通过：画布与编辑器默认存在，隔离探针未进入产物。')
}
