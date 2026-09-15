// 本测试扫描页面文档生产源码，禁止再用 Unicode 符号冒充箭头、类型或状态图标。

import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const pageDocumentRoot = resolve(currentDirectory, '..')
const repositoryRoot = resolve(pageDocumentRoot, '../../..')
const forbiddenSymbols = /[\u2190-\u21ff\u2300-\u23ff\u25a0-\u27bf¶•‹›«»]/u

function productionSourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const target = join(directory, entry.name)
        if (entry.isDirectory()) return productionSourceFiles(target)
        if (!/\.(?:css|ts|tsx)$/u.test(entry.name) || entry.name.includes('.test.')) return []
        return [target]
    })
}

test('页面文档生产源码不使用 Unicode 字符充当图标', () => {
    for (const file of productionSourceFiles(pageDocumentRoot)) {
        const source = readFileSync(file, 'utf8')
        assert.doesNotMatch(source, forbiddenSymbols, relative(repositoryRoot, file))
    }
})
