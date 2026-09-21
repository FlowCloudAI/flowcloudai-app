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
        assert.match(inlineRibbon, /sizeMixed[\s\S]*label: '混合'/u)
        assert.match(inlineRibbon, /isMixedValue\(inspection, property\)/u)
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

    it('颜色色块通过通用 portal 浮层展开且背景类型收在同一卡片', () => {
        const color = readFileSync(
            join(currentDirectory, 'components/properties/ColorPropertyControl.tsx'),
            'utf8',
        )
        const overlay = readFileSync(
            join(repositoryRoot, 'src/shared/ui/overlay/Overlay.tsx'),
            'utf8',
        )
        const structured = readFileSync(
            join(currentDirectory, 'components/properties/StructuredPropertyControls.tsx'),
            'utf8',
        )
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )

        assert.match(color, /<FloatingPanel[\s\S]*passive[\s\S]*page-document-color-popover/u)
        assert.match(color, /<FloatingPanel[\s\S]*anchorRef=\{triggerAnchorRef\}/u)
        assert.match(color, /const customColorGuidance = `当前\$\{field\.label\}会保持不变；选择新颜色后才会替换。`/u)
        assert.match(color, /!embedded && field\.reason/u)
        assert.match(color, /!embedded && hasCustomColor/u)
        assert.doesNotMatch(color, /复杂源码值会原样保留，请在代码模式调整/u)
        assert.match(overlay, /variant !== 'anchored'[\s\S]*resolveAnchoredOverlayPosition/u)
        assert.match(overlay, /HTMLIFrameElement[\s\S]*window\.addEventListener\('blur', onWindowBlur\)/u)
        assert.match(overlay, /createPortal\([\s\S]*document\.body/u)
        assert.doesNotMatch(color, /type="color"/u)
        assert.match(color, /\{fallbackLabel\}<\/Button>[\s\S]*<strong>主题色<\/strong>/u)
        assert.match(color, /色相[\s\S]*饱和度[\s\S]*十六进制[\s\S]*透明度/u)
        assert.match(structured, /function BackgroundPropertyControl[\s\S]*\['solid', '纯色'\][\s\S]*\['gradient', '渐变'\][\s\S]*\['image', '图片'\]/u)
        assert.match(structured, /serializeControlledBackgroundGradient/u)
        assert.match(panel, /<BackgroundPropertyControl[\s\S]*colorField=.*background-color[\s\S]*imageField=.*background-image/u)
        assert.doesNotMatch(panel, /<BackgroundImagePropertyControl/u)
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
        assert.match(panel, /<WidthPropertyControl[\s\S]*\['height', 'min-width', 'max-width', 'min-height', 'max-height'\]/u)
        assert.match(panel, /node\.kind === 'asset'[\s\S]*\['object-fit', 'object-position'\]/u)
    })

    it('属性面板按作者值折叠分组，保存期间源码编辑器进入只读', () => {
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        const disclosure = readFileSync(
            join(currentDirectory, 'components/properties/PropertyDisclosure.tsx'),
            'utf8',
        )
        const codeEditor = readFileSync(
            join(currentDirectory, 'components/source/CodeSourceEditor.tsx'),
            'utf8',
        )
        const workspace = readFileSync(
            join(currentDirectory, 'components/source/SourceWorkspace.tsx'),
            'utf8',
        )
        const editor = readFileSync(
            join(currentDirectory, 'components/PageDocumentEditor.tsx'),
            'utf8',
        )

        assert.match(panel, /PropertyDisclosure[\s\S]*文本块基础格式[\s\S]*字距与装饰[\s\S]*布局结构[\s\S]*间距[\s\S]*尺寸与环绕[\s\S]*颜色与交互[\s\S]*边框与圆角[\s\S]*阴影与效果/u)
        assert.match(disclosure, /<details[\s\S]*<summary>[\s\S]*已设置 \{presentation\.authorValueCount\}/u)
        assert.match(codeEditor, /reconfigure\(EditorView\.editable\.of\(!readOnly\)\)/u)
        assert.match(codeEditor, /aria-readonly=\{readOnly\}/u)
        assert.match(workspace, /<CodeSourceEditor[\s\S]*readOnly=\{readOnly\}/u)
        assert.match(editor, /<SourceWorkspace[\s\S]*readOnly=\{scope\.phase === 'saving'\}/u)
    })

    it('作者界面不泄漏内部标识，功能区仅图标档与固定根能力边界保持一致', () => {
        const assetPicker = readFileSync(
            join(currentDirectory, 'components/assets/PageDocumentAssetPicker.tsx'),
            'utf8',
        )
        const structured = readFileSync(
            join(currentDirectory, 'components/properties/StructuredPropertyControls.tsx'),
            'utf8',
        )
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        const layers = readFileSync(
            join(currentDirectory, 'components/layers/PageDocumentLayerTree.tsx'),
            'utf8',
        )
        const ribbon = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/DocumentOfficeRibbon.tsx'),
            'utf8',
        )
        const ribbonCss = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/DocumentOfficeRibbon.css'),
            'utf8',
        )
        const home = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/HomeRibbonControls.tsx'),
            'utf8',
        )
        const font = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/InlineRibbonStyleControls.tsx'),
            'utf8',
        )

        assert.doesNotMatch(assetPicker, /<small>\{asset\.id\}<\/small>/u)
        assert.doesNotMatch(structured, /asset\.id\.slice/u)
        assert.doesNotMatch(panel, /PAGE_DOCUMENT_NODE_KIND_LABELS\[node\.kind\] \?\? node\.kind/u)
        assert.match(layers, /'可视编辑'[\s\S]*'模板生成'[\s\S]*'仅代码编辑'/u)
        assert.match(ribbon, /iconOnly = size === 'small' && density !== 'full'/u)
        assert.doesNotMatch(ribbon, /document-ribbon-group-trigger|aria-haspopup="menu"/u)
        assert.match(ribbon, /<ArrowDownRight size=\{10\}/u)
        assert.match(ribbonCss, /\.document-ribbon-tabs\s*\{[^}]*overflow:\s*hidden/u)
        assert.match(ribbonCss, /\.document-ribbon-command\.is-icon-only > span/u)
        assert.match(ribbonCss, /\.document-ribbon-group-content \.document-ribbon-color-command \.page-document-color-trigger\.fc-btn\s*\{[^}]*width:\s*var\(--document-ribbon-control-height\)[^}]*height:\s*var\(--document-ribbon-control-height\)/u)
        assert.doesNotMatch(ribbonCss, /\.document-ribbon-group-trigger|\.document-ribbon-group-menu/u)
        assert.doesNotMatch(home, /document-ribbon-control-status/u)
        assert.doesNotMatch(home, /label="样式"/u)
        assert.match(home, /label="块操作"[\s\S]*label="删除"/u)
        assert.match(font, /字体 · 选区[\s\S]*字体 · 后续输入[\s\S]*return '字体'/u)
        assert.doesNotMatch(font, /createRibbonPropertyRequest/u)
        assert.match(font, /文字颜色[\s\S]*'color'[\s\S]*文字底色[\s\S]*'background-color'/u)
        assert.doesNotMatch(font, /label="所选文字"/u)
        assert.match(home, /aria-label="文本块行高"[\s\S]*修改文本块行高/u)
        assert.doesNotMatch(home, /label="查找"/u)
        assert.match(panel, /!fixedRoot && <NumericPropertyControl field=\{fieldFor\(fields, 'rotate'\)\}/u)
    })

    it('Flex 子项、统一宽度模式与插入位置只在适用时呈现', () => {
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        const structured = readFileSync(
            join(currentDirectory, 'components/properties/StructuredPropertyControls.tsx'),
            'utf8',
        )
        const insertion = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/BuiltInStructureRibbonControls.tsx'),
            'utf8',
        )
        const editor = readFileSync(
            join(currentDirectory, 'components/PageDocumentEditor.tsx'),
            'utf8',
        )

        assert.match(panel, /const flexParent = \/\^\(\?:inline-\)\?flex\$\/u\.test\(parentDisplay\)/u)
        assert.match(panel, /\{flexParent && <PropertyDisclosure[\s\S]*Flex 子项[\s\S]*flex-basis[\s\S]*flex-grow[\s\S]*flex-shrink/u)
        assert.match(structured, /aria-label="宽度模式"[\s\S]*>自动<[\s\S]*>设置宽度<[\s\S]*WIDTH_PRESETS/u)
        assert.match(structured, /\[25, 50, 75, 100\]/u)
        assert.match(insertion, /\{showInside && <DocumentRibbonCommand[\s\S]*label="容器内"/u)
        assert.match(editor, /showInside=\{Boolean\(insertionTargets\?\.inside\)\}/u)
    })

    it('页面节点删除同时接入功能区与属性 Dock，固定根不渲染命令', () => {
        const home = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/HomeRibbonControls.tsx'),
            'utf8',
        )
        const panel = readFileSync(
            join(currentDirectory, 'components/properties/PageDocumentPropertiesPanel.tsx'),
            'utf8',
        )
        const editor = readFileSync(
            join(currentDirectory, 'components/PageDocumentEditor.tsx'),
            'utf8',
        )

        assert.match(home, /selected\?\.managed && selected\.attributes\['data-fc-editor-root'\] === undefined/u)
        assert.match(home, /label="删除"[\s\S]*onClick=\{onRemove/u)
        assert.match(panel, /node\?\.managed && !fixedRoot[\s\S]*删除选中节点/u)
        assert.match(editor, /createPageNodeRemoval\(layerProjection\.nodes, node\.id\)[\s\S]*setSelectedNodeId\(removal\.selectionAfterRemoval\)/u)
    })

    it('状态栏与视图页签共用断点档位且不联动画布宽度', () => {
        const editor = readFileSync(
            join(currentDirectory, 'components/PageDocumentEditor.tsx'),
            'utf8',
        )
        const viewControls = readFileSync(
            join(repositoryRoot, 'src/features/document-editor/visual/PageAndViewRibbonControls.tsx'),
            'utf8',
        )
        const sharedControl = viewControls.slice(
            viewControls.indexOf('export function ResponsiveEditContextControl'),
            viewControls.indexOf('export function ViewRibbonControls'),
        )

        assert.match(editor, /<ViewRibbonControls[\s\S]*editContext=\{editContext\}[\s\S]*onEditContextChange=\{setEditContext\}/u)
        assert.match(editor, /<ResponsiveEditContextControl compact onChange=\{setEditContext\} value=\{editContext\} \/>/u)
        assert.match(viewControls, /<ResponsiveEditContextControl onChange=\{onEditContextChange\} value=\{editContext\} \/>/u)
        assert.match(sharedControl, /onClick=\{\(\) => onChange\(context\)\}/u)
        assert.doesNotMatch(sharedControl, /preview|Preview/u)
    })
})
