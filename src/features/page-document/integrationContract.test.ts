// 本测试锁定页面编辑器的持久化边界与构建开关，避免以后误接词条 Markdown 保存链路。

import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, it} from 'node:test'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(currentDirectory, '../../..')

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const target = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(target)
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [target] : []
    })
}

describe('page document editor integration boundary', () => {
    it('components、hooks 与 application 不依赖词条 Markdown 保存 API', () => {
        const roots = ['application', 'components', 'hooks'].map(name => join(currentDirectory, name))
        for (const file of roots.flatMap(sourceFiles)) {
            const source = readFileSync(file, 'utf8')
            const label = relative(repositoryRoot, file)
            assert.doesNotMatch(source, /db_save_entry_bundle|db_save_entry\b/, label)
            for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
                assert.doesNotMatch(match[1] ?? '', /(?:^|\/)entries\//, label)
            }
        }
    })

    it('默认构建接入产物扫描并把编辑实现置于同一开关后', () => {
        const vite = readFileSync(join(repositoryRoot, 'vite.config.ts'), 'utf8')
        const build = readFileSync(join(repositoryRoot, 'scripts/build-page-document-canvas.mjs'), 'utf8')
        const checker = readFileSync(
            join(repositoryRoot, 'scripts/check-page-document-default-build.mjs'),
            'utf8',
        )
        assert.match(vite, /@page-document-editor-entry/)
        assert.match(vite, /pageDocumentCanvasEnabled[\s\S]*editor\/entry\/enabled\.tsx[\s\S]*editor\/entry\/disabled\.tsx/)
        assert.match(build, /check-page-document-default-build\.mjs/)
        for (const marker of ['页面编辑', 'codemirror', 'page-document-editor']) {
            assert.ok(checker.includes(marker), `默认产物扫描遗漏 ${marker}`)
        }
    })
})
