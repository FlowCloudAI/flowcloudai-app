#!/usr/bin/env node

// 本脚本扫描默认 Vite 产物，防止可选页面编辑器、CodeMirror 或画布页越过构建开关。

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(repositoryRoot, 'dist')
const forbidden = [
    '页面编辑',
    'codemirror',
    'page-document-editor',
    'page-properties',
    '属性 ·',
]

function filesUnder(directory) {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? filesUnder(target) : [target]
    })
}

if (!existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) {
    throw new Error('默认构建产物 dist 不存在。')
}
if (existsSync(path.join(outputRoot, 'canvas.html'))) {
    throw new Error('默认构建产物不应包含 canvas.html。')
}

for (const file of filesUnder(outputRoot).filter(file => /\.(?:css|html|js|json|map)$/i.test(file))) {
    const text = readFileSync(file).toString('utf8').toLowerCase()
    const matched = forbidden.find(value => text.includes(value.toLowerCase()))
    if (matched) {
        throw new Error(`默认构建产物 ${path.relative(outputRoot, file)} 含禁用标记：${matched}`)
    }
}

console.log('页面文档默认构建检查通过：无 canvas.html、页面编辑、CodeMirror、页面属性入口。')
