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
        for (const marker of [
            '页面编辑',
            'codemirror',
            'page-document-editor',
            'page-properties',
            '属性 ·',
            '修改生效范围：所有宽度',
            '清除本级设置',
            '该元素尚未纳入可视编辑',
        ]) {
            assert.ok(checker.includes(marker), `默认产物扫描遗漏 ${marker}`)
        }
    })

    it('属性组件只把结构化白名单值交给编辑适配层', () => {
        const propertiesRoot = join(currentDirectory, 'components/properties')
        const componentSources = sourceFiles(propertiesRoot)
            .map(file => readFileSync(file, 'utf8'))
            .join('\n')
        const adapter = readFileSync(join(currentDirectory, 'application/visualPropertyEditing.ts'), 'utf8')

        assert.doesNotMatch(componentSources, /validateVisualPropertyValue|rawCssValue/u)
        assert.doesNotMatch(adapter, /export function validateVisualPropertyValue/u)
        assert.match(adapter, /changes:\s*readonly VisualPropertyChange\[\]/u)
        assert.match(adapter, /serializeVisualPropertyValue\(change\.property, change\.value\)/u)
    })

    it('连续属性交互经会话调度且结束与切换节点都会冲刷尾帧', () => {
        const numeric = readFileSync(
            join(currentDirectory, 'components/properties/NumericPropertyControl.tsx'),
            'utf8',
        )
        const color = readFileSync(
            join(currentDirectory, 'components/properties/ColorPropertyControl.tsx'),
            'utf8',
        )
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        const session = readFileSync(
            join(currentDirectory, 'hooks/useEntryPageDocumentSession.ts'),
            'utf8',
        )

        assert.match(session, /LIVE_VISUAL_COMMIT_DELAY_MS = 140/u)
        assert.match(session, /createLiveVisualCommitScheduler<.*ScheduledKernelEntry>/u)
        assert.match(numeric, /readonly immediate\?: boolean/u)
        assert.match(numeric, /onPointerUp=\{finish\}/u)
        assert.match(numeric, /onBlur=\{finish\}/u)
        assert.match(color, /透明度[\s\S]*onPointerUp=\{finish\}/u)
        assert.match(panel, /\(\) => \(\) => flushPendingChanges\(\)/u)
    })
})
