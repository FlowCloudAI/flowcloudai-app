// 本测试锁定页面编辑器的持久化边界、默认入口与探针裁剪。

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

    it('画布与编辑器默认指向真实实现，只有隔离探针保留独立开关', () => {
        const vite = readFileSync(join(repositoryRoot, 'vite.config.ts'), 'utf8')
        const build = readFileSync(join(repositoryRoot, 'scripts/build-page-document-canvas.mjs'), 'utf8')
        const checker = readFileSync(
            join(repositoryRoot, 'scripts/check-page-document-app-build.mjs'),
            'utf8',
        )
        const devPlugin = readFileSync(
            join(repositoryRoot, 'scripts/page-document-canvas-dev-plugin.mjs'),
            'utf8',
        )
        assert.match(vite, /@page-document-editor-entry/)
        assert.match(vite, /@page-document-canvas-entry[\s\S]*canvas\/entry\/enabled\.tsx/u)
        assert.match(vite, /@page-document-editor-entry[\s\S]*editor\/entry\/enabled\.tsx/u)
        assert.match(vite, /@page-document-editor-runtime[\s\S]*editor\/runtime\/enabled\.ts/u)
        assert.match(vite, /VITE_PAGE_DOCUMENT_PROBE/u)
        assert.doesNotMatch(vite, /VITE_PAGE_DOCUMENT_CANVAS|pageDocumentCanvasEnabled/u)
        assert.match(vite, /const devPort = isAndroid \? 5176 : 5175/u)
        assert.match(devPlugin, /configureServer\(server\)/u)
        assert.match(devPlugin, /assemblePageDocumentCanvasHtml/u)
        assert.doesNotMatch(devPlugin, /transformIndexHtml/u)
        assert.match(build, /check-page-document-canvas-build\.mjs/u)
        assert.match(build, /check-page-document-app-build\.mjs/u)
        assert.match(checker, /canvas\.html/u)
        assert.match(checker, /页面编辑/u)
        assert.match(checker, /page-document-editor-vendor/u)
        for (const marker of [
            '隔离探针',
            '跳过作者侧校验，仅用于验证隔离',
            'forbidden-script',
            'external-css-url',
            'svg-image-external-href',
            'tests/fixtures/page-document',
            'malicious-cases.json',
        ]) {
            assert.ok(checker.includes(marker), `默认产物扫描遗漏探针标记 ${marker}`)
        }
    })

    it('生产预览不导入共享样例，探针样例只能从新开关别名到达', () => {
        const production = readFileSync(
            join(currentDirectory, 'canvas/entry/PageDocumentCanvasEntry.tsx'),
            'utf8',
        )
        const probeEntry = readFileSync(
            join(currentDirectory, 'canvas/development/entry/enabled.tsx'),
            'utf8',
        )
        const vite = readFileSync(join(repositoryRoot, 'vite.config.ts'), 'utf8')

        for (const marker of [
            'tests/fixtures',
            'malicious-cases.json',
            'probeFixtures',
            'CANVAS_PROBE_CASES',
        ]) {
            assert.doesNotMatch(production, new RegExp(marker.replace('.', '\\.'), 'u'))
        }
        assert.match(production, /@page-document-probe-entry/u)
        assert.match(probeEntry, /PageDocumentProbeSection/u)
        assert.match(vite, /pageDocumentProbeEnabled[\s\S]*development\/entry\/enabled\.tsx[\s\S]*development\/entry\/disabled\.tsx/u)
    })

    it('默认产物检查不再把正式编辑标记当成禁止项', () => {
        const checker = readFileSync(
            join(repositoryRoot, 'scripts/check-page-document-app-build.mjs'),
            'utf8',
        )
        const probeMarkersStart = checker.indexOf('const probeMarkers')
        const probeMarkersEnd = checker.indexOf('\n]', probeMarkersStart)
        assert.ok(probeMarkersStart >= 0 && probeMarkersEnd > probeMarkersStart)
        const probeMarkersBlock = checker.slice(probeMarkersStart, probeMarkersEnd)
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
            assert.equal(probeMarkersBlock.includes(`'${marker}'`), false)
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
        assert.doesNotMatch(componentSources, /清除本级设置/u)
        assert.match(componentSources, /aria-label="清除"/u)
        assert.match(componentSources, /<code>\{customValue\.raw\}<\/code>/u)
        assert.match(componentSources, /\(!guardedSource \|\| takeover\) && <div className="page-document-property__numeric">/u)

        const inlineRibbon = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/InlineRibbonStyleControls.tsx'),
            'utf8',
        )
        assert.match(inlineRibbon, /sizeMixed[\s\S]*多种字号/u)
        assert.match(inlineRibbon, /colorMixed[\s\S]*多种颜色/u)
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

    it('可视画布只由外层舞台滚动且未达页宽上限时不留内边距', () => {
        const editorCss = readFileSync(
            join(currentDirectory, 'components/PageDocumentEditor.css'),
            'utf8',
        )
        const runtimeCss = readFileSync(
            join(currentDirectory, 'canvas/runtime/runtime.css'),
            'utf8',
        )

        assert.match(editorCss, /\.page-document-editor__canvas-stage\s*\{[^}]*overflow:\s*auto;[^}]*padding:\s*0;/u)
        assert.match(runtimeCss, /html,\s*body\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/u)
    })

    it('图片低频说明默认折叠且尺寸与填充仍留在常驻布局面板', () => {
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        assert.match(panel, /<details className="page-document-image-details__description">\s*<summary>替代文本与图注<\/summary>/u)
        assert.doesNotMatch(panel, /<details[^>]*\sopen(?:=|\s|>)/u)
        assert.match(panel, /\['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height'\]/u)
        assert.match(panel, /node\.kind === 'asset'[\s\S]*\['object-fit', 'object-position'\]/u)
    })
})
