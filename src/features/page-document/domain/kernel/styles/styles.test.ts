// 本模块验证样式索引不会丢失源码归属，并在组合后的真实祖先关系上按冻结上下文匹配选择器。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {createComponentIndex} from '../components/index.ts'
import type {ReadContext} from '../contracts/context.ts'
import {analysisStampId} from '../contracts/identity.ts'
import {sourceKey} from '../contracts/source.ts'
import {getAttribute, parseHtmlSource} from '../../engine/htmlParser.ts'
import {mergeEntryTemplate} from '../../engine/templateMerge.ts'
import {
    createAuthorStyleIndex,
    createPropertyAnalyzer,
    createSelectorEnvironment,
    styleRuleCondition,
} from './index.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'
const METADATA = {id: ENTRY_ID, title: '样式索引', summary: '', tags: []}
const BASE_CONTEXT: ReadContext = Object.freeze({
    viewport: 'desktop',
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'ltr',
    writingMode: 'horizontal-tb',
})

function createComposition(
    entryMarkup = `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p>`,
) {
    const project = parseHtmlSource(
        `<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head><title data-fc-bind="title"></title></head><body><main class="article" data-fc-slot="entry-root"><div data-fc-slot="body"></div></main></body></html>`,
        {mode: 'document', scope: 'project'},
    )
    const entry = parseHtmlSource(
        `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body">${entryMarkup}</template></template>`,
        {mode: 'fragment', scope: 'entry'},
    )
    const result = mergeEntryTemplate(project, entry, METADATA)
    assert.ok(result.composition)
    const target = result.parsedHtml?.elements.find(
        element => getAttribute(element, 'data-fc-node-id') === NODE_ID,
    )
    assert.ok(target)
    return {composition: result.composition, target}
}

function createAnalyzer(projectCss: string, entryCss: string, entryMarkup?: string) {
    const {composition} = createComposition(entryMarkup)
    const stamp = analysisStampId('analysis:styles')
    const components = createComponentIndex(composition, {
        analysisStamp: stamp,
        instanceNamespace: ENTRY_ID,
    })
    const handle = components.bind([NODE_ID]).handles[0]
    assert.ok(handle)
    const styles = createAuthorStyleIndex([
        {key: sourceKey('project', 'style.css'), content: projectCss},
        {key: sourceKey('entry', 'style.css'), content: entryCss},
    ])
    const analyzer = createPropertyAnalyzer({
        composition,
        components,
        styles,
        analysisStamp: stamp,
        writableScopes: ['project', 'entry'],
    })
    return {analyzer, handle}
}

describe('kernel style analysis foundations', () => {
    it('使用组合后的项目祖先匹配词条节点，并区分冻结的交互状态', () => {
        const {composition, target: paragraph} = createComposition()
        const selectors = createSelectorEnvironment(composition)

        assert.equal(
            selectors.match('.article [data-fc-node-kind="paragraph"]', paragraph, BASE_CONTEXT)
                .condition,
            'active',
        )
        assert.equal(selectors.match('p:hover', paragraph, BASE_CONTEXT).condition, 'inactive')
        assert.equal(
            selectors.match('p:hover', paragraph, {
                ...BASE_CONTEXT,
                interactions: {...BASE_CONTEXT.interactions, hover: true},
            }).condition,
            'active',
        )
        assert.equal(
            selectors.match('p:visited', paragraph, BASE_CONTEXT).condition,
            'indeterminate',
        )
        assert.equal(
            selectors.match('p::first-letter', paragraph, BASE_CONTEXT).condition,
            'not-matched',
        )
    })

    it('分别保留项目、词条、layer、媒体条件和源码范围', () => {
        const index = createAuthorStyleIndex([
            {
                key: sourceKey('project', 'style.css'),
                content: '.article p { color: #c00; gap: 1rem; }',
            },
            {
                key: sourceKey('entry', 'style.css'),
                content:
                    '@layer entry { @media (min-width: 48rem) { p { color: blue; } } }\n@media print { p { width: 50%; } }',
            },
        ])

        assert.deepEqual(
            index.declarations
                .filter(item => item.property === 'color')
                .map(item => ({
                    scope: item.origin.source?.scope,
                    layer: item.layer,
                    media: item.media,
                    hasRange: item.origin.range !== null,
                })),
            [
                {scope: 'project', layer: null, media: null, hasRange: true},
                {
                    scope: 'entry',
                    layer: 'entry',
                    media: '(min-width: 48rem)',
                    hasRange: true,
                },
            ],
        )
        assert.deepEqual(
            index.declarationsRelatedTo('row-gap').map(item => item.property),
            ['gap'],
        )
        const desktopColor = index.declarations.find(
            item => item.origin.source?.scope === 'entry' && item.property === 'color',
        )
        const printWidth = index.declarations.find(item => item.property === 'width')
        assert.ok(desktopColor)
        assert.ok(printWidth)
        assert.equal(styleRuleCondition(desktopColor, BASE_CONTEXT).condition, 'active')
        assert.equal(
            styleRuleCondition(desktopColor, {...BASE_CONTEXT, viewport: 'mobile'}).condition,
            'inactive',
        )
        assert.equal(styleRuleCondition(printWidth, BASE_CONTEXT).condition, 'indeterminate')
    })

    it('对不同文件中的同类语法损坏给出一致诊断而不建立虚假声明', () => {
        const index = createAuthorStyleIndex([
            {
                key: sourceKey('project', 'style.css'),
                content: '.project { font-family: "A\nB"; width: 37%; }',
            },
            {
                key: sourceKey('entry', 'style.css'),
                content: '.entry { font-family: "A\nB"; width: 37%; }',
            },
        ])

        assert.equal(index.diagnostics.length, 2)
        assert.equal(index.declarations.length, 0)
        assert.deepEqual(
            index.diagnostics.map(item => item.source.scope),
            ['project', 'entry'],
        )
    })

    it('从项目祖先继承作者值、解析变量并保留声明来源', () => {
        const {analyzer, handle} = createAnalyzer(
            '.article { --brand: #123456; color: var(--brand); }',
            '',
        )
        const state = analyzer.inspect(handle, 'color', BASE_CONTEXT)

        assert.ok(state)
        assert.deepEqual(state.directDeclarations, [])
        assert.equal(state.confidence.kind, 'proven')
        assert.equal(state.effectiveValue?.rawValue, 'var(--brand)')
        assert.equal(state.effectiveValue?.resolvedValue, '#123456')
        assert.equal(state.effectiveValue?.inherited, true)
        assert.equal(state.effectiveValue?.origin.source?.scope, 'project')
        assert.deepEqual(state.dependencies.variables, ['--brand'])
        assert.equal(state.valueCapability.kind, 'editable')
    })

    it('按 layer、important 与行内来源计算级联而不合并源码归属', () => {
        const markup = `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="color: green">正文</p>`
        const {analyzer, handle} = createAnalyzer(
            '@layer base { p { color: red !important; } }',
            '@layer entry { p { color: blue !important; } }',
            markup,
        )
        const state = analyzer.inspect(handle, 'color', BASE_CONTEXT)

        assert.ok(state)
        assert.equal(state.effectiveValue?.rawValue, 'red')
        assert.equal(state.effectiveValue?.origin.source?.scope, 'project')
        assert.deepEqual(
            state.directDeclarations.map(item => [item.sourceKind, item.origin.source?.scope]),
            [
                ['stylesheet', 'project'],
                ['stylesheet', 'entry'],
                ['inline', 'entry'],
            ],
        )

        const inlineImportant = createAnalyzer(
            '@layer base { p { color: red !important; } }',
            '',
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="color: green !important">正文</p>`,
        )
        assert.equal(
            inlineImportant.analyzer.inspect(inlineImportant.handle, 'color', BASE_CONTEXT)
                ?.effectiveValue?.rawValue,
            'green',
        )
    })

    it('选择器列表使用所有匹配分支中的最高优先级', () => {
        const {analyzer, handle} = createAnalyzer(
            `.article .layout, .article .layout.wide { gap: 10px; }
.article .layout { gap: 20px; }`,
            '',
            `<div class="layout wide" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`,
        )
        const state = analyzer.inspect(handle, 'gap', BASE_CONTEXT)

        assert.equal(state?.confidence.kind, 'proven')
        assert.equal(state?.effectiveValue?.rawValue, '10px')
    })

    it('选择器列表保留可能改变级联结果的未知高优先级分支', () => {
        const markup = `<div class="layout wide" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`
        const combined = createAnalyzer(
            `.article .layout, .article .layout.wide:active { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            markup,
        )
        const split = createAnalyzer(
            `.article .layout { gap: 10px; }
.article .layout.wide:active { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            markup,
        )

        const combinedState = combined.analyzer.inspect(combined.handle, 'gap', BASE_CONTEXT)
        const splitState = split.analyzer.inspect(split.handle, 'gap', BASE_CONTEXT)
        assert.equal(combinedState?.effectiveValue?.rawValue, '20px')
        assert.equal(combinedState?.confidence.kind, 'unknown')
        assert.equal(combinedState?.valueCapability.kind, 'read-only')
        assert.equal(splitState?.effectiveValue?.rawValue, '20px')
        assert.equal(splitState?.confidence.kind, 'unknown')
        assert.equal(splitState?.valueCapability.kind, 'read-only')
        assert.equal(combinedState?.directDeclarations.length, 2)
    })

    it('属性形式的 id 使用属性选择器权重而不冒充 ID 选择器', () => {
        const markup = `<div id="target" class="layout wide" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`
        const attribute = createAnalyzer(
            `.article [id="target"] { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            markup,
        )
        const shorthand = createAnalyzer(
            `.article #target { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            markup,
        )

        assert.equal(
            attribute.analyzer.inspect(attribute.handle, 'gap', BASE_CONTEXT)?.effectiveValue
                ?.rawValue,
            '20px',
        )
        assert.equal(
            shorthand.analyzer.inspect(shorthand.handle, 'gap', BASE_CONTEXT)?.effectiveValue
                ?.rawValue,
            '10px',
        )
    })

    it('nth-child of 计入过滤选择器权重并传播其中的未知交互条件', () => {
        const markup = `<div id="target" class="layout" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`
        const staticSelector = createAnalyzer(
            `.article .layout:nth-child(1 of #target) { gap: 10px; }
.article #target.layout { gap: 20px; }`,
            '',
            markup,
        )
        const dynamicSelector = createAnalyzer(
            `.article .layout:nth-child(1 of #target:active) { gap: 10px; }
.article #target.layout { gap: 20px; }`,
            '',
            markup,
        )

        const staticState = staticSelector.analyzer.inspect(
            staticSelector.handle,
            'gap',
            BASE_CONTEXT,
        )
        assert.equal(staticState?.effectiveValue?.rawValue, '10px')
        assert.equal(staticState?.confidence.kind, 'proven')

        const dynamicState = dynamicSelector.analyzer.inspect(
            dynamicSelector.handle,
            'gap',
            BASE_CONTEXT,
        )
        assert.equal(dynamicState?.effectiveValue?.rawValue, '20px')
        assert.equal(dynamicState?.confidence.kind, 'unknown')
        assert.equal(dynamicState?.valueCapability.kind, 'read-only')
    })

    it('nth-child of 的未知过滤集合不使用放宽后的兄弟序号排除目标', () => {
        const precedingSibling = `<div>前项</div><div class="layout wide" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`
        const followingSibling = `<div class="layout wide" data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div><div>后项</div>`
        const fromStart = createAnalyzer(
            `.article .layout:nth-child(1 of :active) { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            precedingSibling,
        )
        const fromEnd = createAnalyzer(
            `.article .layout:nth-last-child(1 of :active) { gap: 10px; }
.article .layout.wide { gap: 20px; }`,
            '',
            followingSibling,
        )

        for (const {analyzer, handle} of [fromStart, fromEnd]) {
            const state = analyzer.inspect(handle, 'gap', BASE_CONTEXT)
            assert.equal(state?.effectiveValue?.rawValue, '20px')
            assert.equal(state?.confidence.kind, 'unknown')
            assert.equal(state?.valueCapability.kind, 'read-only')
        }
    })

    it('行内声明保留字符串内分号、数据 URL 与 important 优先级', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            '',
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="--payload: &quot;a;b&quot;; background-image: url(&quot;data:image/svg+xml;a=b;c=d&quot;); color: red !important;">正文</p>`,
        )

        assert.equal(
            analyzer.inspect(handle, 'background-image', BASE_CONTEXT)?.effectiveValue?.rawValue,
            'url("data:image/svg+xml;a=b;c=d")',
        )
        assert.equal(
            analyzer.inspect(handle, 'color', BASE_CONTEXT)?.effectiveValue?.rawValue,
            'red',
        )
        assert.equal(
            analyzer.inspect(handle, 'color', BASE_CONTEXT)?.directDeclarations[0]?.important,
            true,
        )
    })

    it('未知条件只污染相关属性，确定的高优先级声明屏蔽低级不确定来源', () => {
        const markup = `<div data-fc-node-id="${NODE_ID}" data-fc-node-kind="container" style="gap: 8px"><p>正文</p></div>`
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { display: grid; }
[data-fc-node-id="${NODE_ID}"]:visited { gap: 40px; flex-direction: column; }`,
            markup,
        )
        const gap = analyzer.inspect(handle, 'gap', BASE_CONTEXT)
        const flexDirection = analyzer.inspect(handle, 'flex-direction', BASE_CONTEXT)

        assert.ok(gap)
        assert.equal(gap.confidence.kind, 'proven')
        assert.equal(gap.effectiveValue?.rawValue, '8px')
        assert.equal(gap.applicability.kind, 'applicable')
        assert.ok(flexDirection)
        assert.equal(flexDirection.confidence.kind, 'unknown')
        assert.equal(flexDirection.applicability.kind, 'not-applicable')
    })

    it('从 gap 与四向简写中读取分项，并按书写方向解释逻辑边', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { display: grid; gap: 8px 12px; padding: 1px 2px 3px 4px; }`,
            `<div data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`,
        )

        assert.equal(
            analyzer.inspect(handle, 'row-gap', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '8px',
        )
        assert.equal(
            analyzer.inspect(handle, 'column-gap', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '12px',
        )
        assert.equal(
            analyzer.inspect(handle, 'padding-inline-start', BASE_CONTEXT)?.effectiveValue
                ?.resolvedValue,
            '4px',
        )
        assert.equal(
            analyzer.inspect(handle, 'padding-inline-start', {
                ...BASE_CONTEXT,
                direction: 'rtl',
            })?.effectiveValue?.resolvedValue,
            '2px',
        )
    })

    it('完整展开 flex-flow 并保留未显式书写分量的初始值', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { display: flex; flex-flow: column; flex: 2 0 auto; }`,
            `<div data-fc-node-id="${NODE_ID}" data-fc-node-kind="container"><p>正文</p></div>`,
        )

        assert.equal(
            analyzer.inspect(handle, 'flex-direction', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            'column',
        )
        assert.equal(
            analyzer.inspect(handle, 'flex-wrap', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            'nowrap',
        )
        assert.equal(
            analyzer.inspect(handle, 'flex-grow', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '2',
        )
        assert.equal(
            analyzer.inspect(handle, 'flex-shrink', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '0',
        )
        assert.equal(
            analyzer.inspect(handle, 'flex-basis', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            'auto',
        )
    })

    it('按语义而非 token 顺序拆分边框，并只从纯色背景简写读取背景色', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { border: solid #c00 1px; background: rgb(12 34 56 / 50%); }`,
        )

        assert.equal(
            analyzer.inspect(handle, 'border-width', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '1px',
        )
        assert.equal(
            analyzer.inspect(handle, 'border-style', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            'solid',
        )
        assert.equal(
            analyzer.inspect(handle, 'border-color', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            '#c00',
        )
        assert.equal(
            analyzer.inspect(handle, 'background-color', BASE_CONTEXT)?.effectiveValue
                ?.resolvedValue,
            'rgb(12 34 56 / 50%)',
        )

        const complex = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { background: url(example.png) center / cover, #fff; }`,
        )
        assert.equal(
            complex.analyzer.inspect(complex.handle, 'background-color', BASE_CONTEXT)?.confidence
                .kind,
            'partial',
        )
    })

    it('把 Grid 轴简写解析为起止线并保留省略终点的 auto', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { grid-column: 2 / span 3; grid-row: 4; }`,
        )

        assert.equal(
            analyzer.inspect(handle, 'grid-column-start', BASE_CONTEXT)?.effectiveValue
                ?.resolvedValue,
            '2',
        )
        assert.equal(
            analyzer.inspect(handle, 'grid-column-end', BASE_CONTEXT)?.effectiveValue
                ?.resolvedValue,
            'span 3',
        )
        assert.equal(
            analyzer.inspect(handle, 'grid-row-end', BASE_CONTEXT)?.effectiveValue?.resolvedValue,
            'auto',
        )
    })

    it('相对两边不会互相覆盖，尚未展开的相关简写明确降级而非假装缺失', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { padding-top: 10px; padding-bottom: 20px; font: italic 700 18px/1.5 serif; }`,
        )

        const top = analyzer.inspect(handle, 'padding-top', BASE_CONTEXT)
        assert.equal(top?.effectiveValue?.rawValue, '10px')
        assert.deepEqual(
            top?.directDeclarations.map(item => item.declaredProperty),
            ['padding-top'],
        )
        const weight = analyzer.inspect(handle, 'font-weight', BASE_CONTEXT)
        assert.equal(weight?.confidence.kind, 'partial')
        assert.equal(weight?.directDeclarations[0]?.declaredProperty, 'font')
        assert.equal(weight?.valueCapability.kind, 'read-only')
    })

    it('逻辑相对两边在未知书写方向下仍是独立声明', () => {
        const css = `[data-fc-node-id="${NODE_ID}"] { margin-inline-start: 10px; margin-inline-end: 20px; }`
        const index = createAuthorStyleIndex([{key: sourceKey('entry', 'style.css'), content: css}])
        assert.deepEqual(
            index.declarationsRelatedTo('margin-inline-start').map(item => item.property),
            ['margin-inline-start'],
        )
        const {analyzer, handle} = createAnalyzer('', css)
        const unknownContext: ReadContext = {
            ...BASE_CONTEXT,
            direction: 'unknown',
            writingMode: 'unknown',
        }
        assert.equal(
            analyzer.inspect(handle, 'margin-inline-start', unknownContext)?.effectiveValue
                ?.resolvedValue,
            '10px',
        )
        assert.equal(
            analyzer.inspect(handle, 'margin-inline-end', unknownContext)?.effectiveValue
                ?.resolvedValue,
            '20px',
        )
    })

    it('区分未声明与推荐值，并按移动基础和桌面覆盖读取实际作者规则', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            `[data-fc-node-id="${NODE_ID}"] { font-size: 16px; }
@media (min-width: 48rem) { [data-fc-node-id="${NODE_ID}"] { font-size: 20px; } }
@media (min-width: 60rem) { [data-fc-node-id="${NODE_ID}"] { font-size: 22px; } }`,
        )

        assert.equal(
            analyzer.inspect(handle, 'width', BASE_CONTEXT)?.valueCapability.kind,
            'absent',
        )
        assert.equal(
            analyzer.inspect(handle, 'font-size', {...BASE_CONTEXT, viewport: 'mobile'})
                ?.effectiveValue?.rawValue,
            '16px',
        )
        assert.equal(
            analyzer.inspect(handle, 'font-size', BASE_CONTEXT)?.effectiveValue?.rawValue,
            '20px',
        )
        assert.equal(
            analyzer.inspect(handle, 'font-size', BASE_CONTEXT)?.confidence.kind,
            'unknown',
        )
    })

    it('HTML 实体解码后的损坏行内样式与样式表使用同一语法边界', () => {
        const {analyzer, handle} = createAnalyzer(
            '',
            '',
            `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="font-family:&quot;A&#10;B&quot;;width:37%">正文</p>`,
        )
        const state = analyzer.inspect(handle, 'width', BASE_CONTEXT)

        assert.ok(state)
        assert.equal(state.confidence.kind, 'unknown')
        assert.equal(state.valueCapability.kind, 'read-only')
        assert.equal(
            state.diagnostics.some(item => item.code === 'css_syntax_error'),
            true,
        )
    })

    it('变量缺失时使用显式回退，revert-layer 则保持可见但不伪装成已解析值', () => {
        const fallback = createAnalyzer('', `p { color: var(--missing, rgb(1 2 3)); }`)
        const fallbackState = fallback.analyzer.inspect(fallback.handle, 'color', BASE_CONTEXT)
        assert.equal(fallbackState?.confidence.kind, 'proven')
        assert.equal(fallbackState?.effectiveValue?.resolvedValue, 'rgb(1 2 3)')

        const reverted = createAnalyzer('', '@layer entry { p { color: revert-layer; } }')
        const revertedState = reverted.analyzer.inspect(reverted.handle, 'color', BASE_CONTEXT)
        assert.equal(revertedState?.effectiveValue?.rawValue, 'revert-layer')
        assert.equal(revertedState?.effectiveValue?.resolvedValue, null)
        assert.equal(revertedState?.confidence.kind, 'partial')
        assert.equal(revertedState?.valueCapability.kind, 'read-only')
    })
})
