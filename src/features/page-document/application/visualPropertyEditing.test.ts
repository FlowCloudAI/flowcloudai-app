// 这些测试锁定属性 Dock 经文档内核生成最小源码补丁，并与代码模式、历史和覆盖确认共用同一草稿。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntrySourceSnapshot} from '../domain/contract.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {utf16Range, type ComponentHandle} from '../domain/kernel/index.ts'
import {
    createDocumentDraft,
    redoEntryDraft,
    undoEntryDraft,
    type DocumentDraftModel,
} from './documentDraftModel.ts'
import {
    createDocumentKernelDraftRuntime,
    type KernelComponentInspectionRequest,
} from './documentKernelDraftRuntime.ts'
import {createLiveVisualCommitScheduler} from './liveVisualCommitScheduler.ts'
import {
    createVisualPropertyEditRequest,
    createInteractionColorPropertyEditRequest,
    inspectVisualProperties,
    parseSerializedVisualColor,
    serializeVisualPropertyValue,
    type VisualPropertyChange,
    type VisualPropertyEditValue,
    type VisualPropertyName,
} from './visualPropertyEditing.ts'

const ENTRY_ID = '11111111-1111-7111-8111-111111111111'
const ROOT_ID = '22222222-2222-7222-8222-222222222222'
const PARAGRAPH_ID = '33333333-3333-7333-8333-333333333333'

function snapshot(styleCss = baseStyle()): EntrySourceSnapshot {
    return {
        project: {
            projectRevision: 1,
            templateVersion: 1,
            hashes: {article: 'a'.repeat(64), style: 'b'.repeat(64)},
            defaultArticleHtml:
                '<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head></head><body><main data-fc-slot="entry-root"><div data-fc-slot="entry-body"></div></main></body></html>',
            defaultStyleCss:
                '@layer fc-renderer, fc-project, fc-entry, fc-node; @layer fc-project { :root { --fc-entry-text: #28241f; } }',
            diagnostics: [],
            sourceStatus: 'ready',
        },
        entry: {id: ENTRY_ID, title: '属性测试', summary: '', tags: []},
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision: 2,
        hashes: {article: 'c'.repeat(64), style: 'd'.repeat(64)},
        articleHtml: `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" data-author-keep="逐字保留"><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph">正文 <span data-extra="keep">未知合法片段</span></p></div></template></template>`,
        styleCss,
        assets: [],
        editorLimits: {
            paragraph: 100,
            asset: 100,
            managedNodes: 512,
            containerDepth: 3,
            containerChildren: 32,
        },
        diagnostics: [],
        sourceStatus: 'ready',
    }
}

function baseStyle(): string {
    return `/* unknown-before */
@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] .author-unknown { letter-spacing: .03em; } }
@layer fc-node {
  [data-fc-node-id="${ROOT_ID}"][data-fc-node-kind="container"] { display: grid; gap: 1rem; }
  [data-fc-node-id="${PARAGRAPH_ID}"][data-fc-node-kind="paragraph"] { color: #334455; padding-block-start: 2px; }
}
/* unknown-after */`
}

function paragraph(model: DocumentDraftModel) {
    const pending = [...createLayerProjection(model.entry.sources['article.html']).nodes]
    let node = pending.shift()
    while (node && node.id !== PARAGRAPH_ID) {
        pending.unshift(...node.children)
        node = pending.shift()
    }
    assert.ok(node)
    return node
}

function apply(
    model: DocumentDraftModel,
    source: EntrySourceSnapshot,
    property: VisualPropertyName,
    value: VisualPropertyChange['value'],
    historyGroupId?: string,
): DocumentDraftModel {
    const runtime = createDocumentKernelDraftRuntime()
    const request = createVisualPropertyEditRequest(
        PARAGRAPH_ID,
        [{property, value}],
        {historyGroupId, styleContext: 'mobile'},
        () => `${property}:${value.kind}`,
    )
    const prepared = runtime.prepare(model, source, request)
    assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
    if (prepared.status !== 'ready') return model
    const update = runtime.applyPrepared(model, source, prepared.edit, `修改${property}`, {
        historyGroupId,
    })
    assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
    return update.model
}

describe('visual property editing', () => {
    it('属性修改只改目标声明，未知合法源码与无关声明逐字保留并可在代码草稿看到', () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        const next = apply(initial, source, 'font-size', {kind: 'numeric', value: 18, unit: 'px', numberText: '18'})

        assert.equal(next.entry.sources['article.html'], source.articleHtml)
        assert.match(next.entry.sources['style.css'], /font-size: 18px/u)
        for (const untouched of [
            '/* unknown-before */',
            `[data-fc-entry-id="${ENTRY_ID}"] .author-unknown { letter-spacing: .03em; }`,
            'color: #334455; padding-block-start: 2px;',
            '/* unknown-after */',
        ]) {
            assert.ok(next.entry.sources['style.css'].includes(untouched), untouched)
        }
    })

    it('属性修改后撤销与重做回到原源码', () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        const changed = apply(initial, source, 'line-height', {kind: 'numeric', value: 1.7, unit: '', numberText: '1.7'})
        const undone = undoEntryDraft(changed)
        const redone = redoEntryDraft(undone.model)

        assert.equal(undone.applied, true)
        assert.deepEqual(undone.model.entry.sources, initial.entry.sources)
        assert.equal(redone.applied, true)
        assert.deepEqual(redone.model.entry.sources, changed.entry.sources)
    })

    it('连续调整共用 historyGroupId 时只产生一次历史', () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        const first = apply(initial, source, 'font-size', {kind: 'numeric', value: 17, unit: 'px', numberText: '17'}, 'font-size-drag-1')
        const second = apply(first, source, 'font-size', {kind: 'numeric', value: 19, unit: 'px', numberText: '19'}, 'font-size-drag-1')

        assert.equal(second.entry.undo.length, 1)
        assert.match(second.entry.sources['style.css'], /font-size: 19px/u)
        assert.deepEqual(undoEntryDraft(second).model.entry.sources, initial.entry.sources)
    })

    it('连续调节在交互结束时提交尾帧且仍只产生一次撤销', async () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        let model = initial
        let commitCount = 0
        const scheduler = createLiveVisualCommitScheduler<VisualPropertyChange['value']>({
            delayMs: 140,
            commit: async (value, metadata) => {
                commitCount += 1
                model = apply(model, source, 'font-size', value, metadata.historyGroupId)
                return true
            },
            onStatus: () => undefined,
        })
        const group = 'font-size-drag-tail'
        const scheduled = [17, 19, 21].map(value => scheduler.schedule(
            {kind: 'numeric', value, unit: 'px', numberText: String(value)},
            {historyGroupId: group},
        ))

        scheduler.flush()
        assert.deepEqual(await Promise.all(scheduled), [true, true, true])

        assert.equal(commitCount, 1)
        assert.match(model.entry.sources['style.css'], /font-size: 21px/u)
        assert.equal(model.entry.undo.length, 1)
        assert.deepEqual(undoEntryDraft(model).model.entry.sources, initial.entry.sources)
        scheduler.dispose()
    })

    it('所有宽度修改会把其他区间覆盖交给调用方确认，取消前草稿不变', () => {
        const withoutBaseColor = baseStyle().replace('color: #334455; ', '')
        const source = snapshot(`${withoutBaseColor}\n@layer fc-entry { @media (min-width: 48rem) { [data-fc-entry-id="${ENTRY_ID}"] p { color: #556677; } } }`)
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const request = createVisualPropertyEditRequest(
            PARAGRAPH_ID,
            [{property: 'color', value: {kind: 'color', value: '#112233', opacity: 100}}],
            {styleContext: 'mobile'},
            () => 'color-with-breakpoint',
        )
        const prepared = runtime.prepare(model, source, request)

        assert.equal(prepared.status, 'needs-decision', JSON.stringify(prepared))
        assert.deepEqual(model.entry.sources, createDocumentDraft(source).entry.sources)
        if (prepared.status !== 'needs-decision') return
        assert.ok(prepared.decisions.some(item => /桌面|区间|上下文/u.test(item.message)))
        const accepted = runtime.applyPrepared(model, source, prepared.edit, '修改文字颜色')
        assert.equal(accepted.applied, true)
        assert.match(accepted.model.entry.sources['style.css'], /color: #112233/u)
    })

    it('检查结果区分本级、其他区间与容器适用性', () => {
        const withoutBaseColor = baseStyle().replace('color: #334455; ', '')
        const selector = `[data-fc-node-id="${PARAGRAPH_ID}"][data-fc-node-kind="paragraph"]`
        const source = snapshot(`${withoutBaseColor}\n@layer fc-node { @media (min-width: 48rem) { ${selector} { color: #556677; } } }`)
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const states = inspectVisualProperties(
            paragraph(model),
            request => runtime.inspectComponent(model, source, request),
            source.styleCss,
            'mobile',
        )

        assert.equal(states.find(item => item.property === 'color')?.sourceState, 'other-viewport', JSON.stringify(states.find(item => item.property === 'color')))
        assert.match(states.find(item => item.property === 'color')?.statusText ?? '', /其他区间有覆盖/u)
        assert.equal(states.find(item => item.property === 'gap')?.disabled, true)
        assert.match(states.find(item => item.property === 'gap')?.statusText ?? '', /需要 Grid 或 Flex/u)
        assert.equal(states.some(item => /本(?:级|档|状态)未设置/u.test(item.statusText)), false)
    })

    it('属性任务窗格仍能分档写入节点字号，桌面覆盖清除后回落移动基础', () => {
        const source = snapshot()
        const runtime = createDocumentKernelDraftRuntime()
        let model = createDocumentDraft(source)
        const applyContext = (
            context: 'mobile' | 'desktop',
            value: VisualPropertyEditValue,
            id: string,
        ) => {
            const request = createVisualPropertyEditRequest(
                PARAGRAPH_ID,
                [{property: 'font-size', value}],
                {styleContext: context},
                () => id,
            )
            const prepared = runtime.prepare(model, source, request)
            assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
            if (prepared.status !== 'ready') return
            const changed = runtime.applyPrepared(model, source, prepared.edit, `修改${context}字号`)
            assert.equal(changed.applied, true, JSON.stringify(changed.diagnostics))
            model = changed.model
        }
        applyContext('mobile', {kind: 'numeric', value: 16, unit: 'px', numberText: '16'}, 'mobile-font')
        applyContext('desktop', {kind: 'numeric', value: 24, unit: 'px', numberText: '24'}, 'desktop-font')
        assert.match(model.entry.sources['style.css'], /@media \(min-width: 48rem\)[\s\S]*font-size: 24px/u)
        applyContext('desktop', {kind: 'clear-override'}, 'desktop-font-clear')
        const desktop = inspectVisualProperties(
            paragraph(model),
            request => runtime.inspectComponent(model, source, request),
            model.entry.sources['style.css'],
            'desktop',
        ).find(field => field.property === 'font-size')
        assert.equal(desktop?.localValue, null)
        assert.equal(desktop?.value, '16px')
        assert.equal(desktop?.sourceState, 'other-viewport')
        assert.match(desktop?.statusText ?? '', /继承/u)
        assert.equal(desktop?.clearTitle, '清除后继承移动基础设置。')
    })

    it('旧词条的节点级字体规则保留在源码中并继续按断点读数', () => {
        const style = baseStyle().replace(
            'color: #334455; padding-block-start: 2px;',
            'color: #334455; font-size: 17px; font-weight: 600; padding-block-start: 2px;',
        ) + `
@layer fc-node {
  @media (min-width: 48rem) {
    [data-fc-node-id="${PARAGRAPH_ID}"][data-fc-node-kind="paragraph"] { font-size: 23px; }
  }
}`
        const source = snapshot(style)
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const read = (context: 'mobile' | 'desktop') => inspectVisualProperties(
            paragraph(model),
            request => runtime.inspectComponent(model, source, request),
            model.entry.sources['style.css'],
            context,
        )
        const mobile = read('mobile')
        const desktop = read('desktop')

        assert.equal(mobile.find(item => item.property === 'font-size')?.value, '17px')
        assert.equal(mobile.find(item => item.property === 'font-weight')?.value, '600')
        assert.equal(desktop.find(item => item.property === 'font-size')?.value, '23px')
        assert.equal(model.entry.sources['style.css'], style)
    })

    it('属性状态区分默认、继承、多值与复杂源码，清除说明给出真实回退结果', () => {
        const style = baseStyle().replace(
            'color: #334455; padding-block-start: 2px;',
            'color: #334455; font-size: 16px; font-size: 18px; line-height: calc(1 + .2); padding-block-start: 2px;',
        )
        const source = snapshot(style)
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const states = inspectVisualProperties(
            paragraph(model),
            request => runtime.inspectComponent(model, source, request),
            source.styleCss,
            'mobile',
        )
        const fontSize = states.find(item => item.property === 'font-size')
        const lineHeight = states.find(item => item.property === 'line-height')
        const opacity = states.find(item => item.property === 'opacity')

        assert.match(source.styleCss, /font-size: 16px; font-size: 18px/u)
        assert.equal(fontSize?.sourceState, 'mixed')
        assert.equal(fontSize?.statusText, '多种值 · 调整后统一')
        assert.equal(lineHeight?.sourceState, 'local')
        assert.equal(lineHeight?.value, 'calc(1 + .2)')
        assert.equal(opacity?.sourceState, 'default')
        assert.equal(opacity?.statusText, '默认')
        assert.equal(opacity?.clearTitle, '清除后恢复浏览器默认值。')
        assert.equal(states.some(item => /本(?:级|档|状态)未设置/u.test(item.statusText)), false)
    })

    it('交互态颜色绑定写入独立 hover 与 focus-within 通道且不携带断点', () => {
        const bindings = new Map([[PARAGRAPH_ID, {
            handleId: 'handle:interaction' as ComponentHandle['handleId'],
            nodeId: PARAGRAPH_ID as ComponentHandle['nodeId'],
            instanceId: 'instance:interaction',
            kind: 'paragraph' as const,
            origin: {kind: 'author' as const, source: {scope: 'entry' as const, file: 'article.html' as const}, range: utf16Range(0, 1)},
            analysisStamp: 'analysis:interaction' as ComponentHandle['analysisStamp'],
        }]])
        for (const context of ['hover', 'focus-within'] as const) {
            const request = createInteractionColorPropertyEditRequest(
                PARAGRAPH_ID,
                context,
                'border-color',
                {kind: 'color', value: '#112233', opacity: 100},
                {},
                () => `interaction-${context}`,
            )
            const intent = request.createIntents(bindings)[0]
            assert.equal(intent?.kind, 'edit-property')
            if (intent?.kind !== 'edit-property') continue
            assert.deepEqual(intent.destination, {scope: 'entry', channel: {kind: 'conditional-rule', context}})
            assert.equal(intent.readContext.viewport, 'mobile')
            assert.equal(intent.readContext.interactions.hover, context === 'hover')
            assert.equal(intent.readContext.interactions.focusWithin, context === 'focus-within')
        }
        assert.throws(() => createInteractionColorPropertyEditRequest(
            PARAGRAPH_ID,
            'hover',
            'opacity' as 'color',
            {kind: 'color', value: '#112233', opacity: 100},
        ), /只开放/u)
    })

    it('交互态属性检查只读取三项颜色且不执行视口回退检查', () => {
        const source = snapshot()
        const model = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const requests: KernelComponentInspectionRequest[] = []
        const states = inspectVisualProperties(
            paragraph(model),
            request => {
                requests.push(request)
                return runtime.inspectComponent(model, source, request)
            },
            source.styleCss,
            'hover',
            ['color', 'background-color', 'border-color'],
        )

        assert.equal(requests.length, 1)
        assert.deepEqual(requests[0]?.properties, ['color', 'background-color', 'border-color'])
        assert.deepEqual(states.map(state => state.property), ['color', 'background-color', 'border-color'])
    })

    it('结构化属性值只序列化白名单形式并拒绝伪造结构', () => {
        assert.equal(serializeVisualPropertyValue('font-size', {kind: 'numeric', value: 18, unit: 'px', numberText: '18'}), '18px')
        assert.equal(serializeVisualPropertyValue('line-height', {kind: 'numeric', value: 1.6, unit: '', numberText: '1.6'}), '1.6')
        assert.equal(serializeVisualPropertyValue('margin-inline-start', {kind: 'numeric', value: -2, unit: 'rem', numberText: '-2'}), '-2rem')
        assert.equal(serializeVisualPropertyValue('font-weight', {kind: 'font-weight', value: '700'}), '700')
        assert.equal(serializeVisualPropertyValue('color', {kind: 'color', value: '#112233', opacity: 50}), 'rgb(17 34 51 / 50%)')
        assert.equal(serializeVisualPropertyValue('color', {kind: 'clear-override'}), null)
        assert.throws(() => serializeVisualPropertyValue('font-size', {kind: 'numeric', value: 18, unit: '' as 'px', numberText: '18'}), /单位/u)
        assert.throws(() => serializeVisualPropertyValue('padding-block-start', {kind: 'numeric', value: -1, unit: 'px', numberText: '-1'}), /负数/u)
        assert.throws(() => serializeVisualPropertyValue('font-weight', {kind: 'color', value: '#112233', opacity: 100}), /颜色结构/u)
        assert.equal(serializeVisualPropertyValue('display', {kind: 'display', value: 'grid'}), 'grid')
        assert.equal(serializeVisualPropertyValue('grid-template-columns', {kind: 'grid-columns', value: 'repeat(2, minmax(0, 1fr))'}), 'repeat(2, minmax(0, 1fr))')
        assert.equal(serializeVisualPropertyValue('align-items', {kind: 'align-items', value: 'center'}), 'center')
        assert.equal(serializeVisualPropertyValue('justify-content', {kind: 'justify-content', value: 'space-between'}), 'space-between')
        assert.throws(() => serializeVisualPropertyValue('display', {kind: 'display', value: 'inline' as never}), /布局方式/u)
        assert.throws(() => serializeVisualPropertyValue('grid-template-columns', {kind: 'grid-columns', value: 'repeat(9, 1fr)' as never}), /分栏/u)
        assert.throws(() => serializeVisualPropertyValue('align-items', {kind: 'align-items', value: 'space-around' as never}), /纵向/u)
        assert.throws(() => serializeVisualPropertyValue('justify-content', {kind: 'justify-content', value: 'unsafe' as never}), /横向/u)
    })

    it('扩展属性经属性面板绑定生成受管 intents，并拒绝值结构错配', () => {
        const handle: ComponentHandle = {
            handleId: 'handle:extended-properties' as ComponentHandle['handleId'],
            nodeId: PARAGRAPH_ID as ComponentHandle['nodeId'],
            instanceId: 'instance:extended-properties',
            kind: 'paragraph',
            origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: utf16Range(0, 1)},
            analysisStamp: 'analysis:extended-properties' as ComponentHandle['analysisStamp'],
        }
        const shadowLength = (value: number) => ({kind: 'numeric' as const, value, unit: 'px' as const, numberText: String(value)})
        const cases = [
            ['border-width', {kind: 'numeric', value: 2, unit: 'px', numberText: '2'}, '2px'],
            ['border-style', {kind: 'keyword', value: 'dashed'}, 'dashed'],
            ['border-color', {kind: 'color', value: '#112233', opacity: 100}, '#112233'],
            ['border-radius', {kind: 'numeric', value: 8, unit: 'px', numberText: '8'}, '8px'],
            ['background-image', {kind: 'background-image', value: 'linear-gradient(135deg, var(--fc-entry-accent), transparent)'}, 'linear-gradient(135deg, var(--fc-entry-accent), transparent)'],
            ['box-shadow', {kind: 'box-shadow', layers: [{offsetX: shadowLength(0), offsetY: shadowLength(2), blur: shadowLength(8), spread: shadowLength(0), color: '#000000', inset: false}]}, '0px 2px 8px 0px #000000'],
            ['opacity', {kind: 'numeric', value: 0.5, unit: '', numberText: '0.5'}, '0.5'],
            ['rotate', {kind: 'numeric', value: 15, unit: 'deg', numberText: '15'}, '15deg'],
            ['width', {kind: 'keyword', value: 'fit-content'}, 'fit-content'],
            ['height', {kind: 'numeric', value: 12, unit: 'rem', numberText: '12'}, '12rem'],
            ['min-width', {kind: 'keyword', value: 'min-content'}, 'min-content'],
            ['max-width', {kind: 'keyword', value: 'none'}, 'none'],
            ['min-height', {kind: 'numeric', value: 6, unit: 'rem', numberText: '6'}, '6rem'],
            ['max-height', {kind: 'keyword', value: 'fit-content'}, 'fit-content'],
            ['row-gap', {kind: 'numeric', value: 1, unit: 'rem', numberText: '1'}, '1rem'],
            ['column-gap', {kind: 'numeric', value: 2, unit: 'rem', numberText: '2'}, '2rem'],
            ['letter-spacing', {kind: 'numeric', value: 0.04, unit: 'em', numberText: '0.04'}, '0.04em'],
            ['word-spacing', {kind: 'numeric', value: 0.2, unit: 'em', numberText: '0.2'}, '0.2em'],
            ['text-decoration-line', {kind: 'keyword', value: 'underline'}, 'underline'],
            ['text-decoration-color', {kind: 'color', value: '#334455', opacity: 100}, '#334455'],
            ['text-decoration-style', {kind: 'keyword', value: 'wavy'}, 'wavy'],
            ['object-fit', {kind: 'keyword', value: 'cover'}, 'cover'],
            ['object-position', {kind: 'keyword', value: 'right bottom'}, 'right bottom'],
            ['float', {kind: 'keyword', value: 'inline-start'}, 'inline-start'],
            ['list-style-type', {kind: 'keyword', value: 'decimal'}, 'decimal'],
            ['list-style-position', {kind: 'keyword', value: 'inside'}, 'inside'],
            ['flex-basis', {kind: 'keyword', value: '50%'}, '50%'],
            ['flex-grow', {kind: 'numeric', value: 2, unit: '', numberText: '2'}, '2'],
            ['flex-shrink', {kind: 'numeric', value: 0.5, unit: '', numberText: '0.5'}, '0.5'],
        ] as const satisfies readonly [VisualPropertyName, VisualPropertyEditValue, string][]
        for (const [property, value, expected] of cases) {
            const request = createVisualPropertyEditRequest(
                PARAGRAPH_ID,
                [{property, value}],
                {styleContext: 'mobile'},
                () => `extended-${property}`,
            )
            const intent = request.createIntents(new Map([[PARAGRAPH_ID, handle]]))[0]
            assert.equal(intent?.kind, 'edit-property')
            assert.equal(intent?.property, property)
            assert.deepEqual(intent?.action, {kind: 'set-value', value: expected})
        }
        assert.throws(() => serializeVisualPropertyValue('color', {kind: 'keyword', value: 'cover'}), /关键字结构/u)
        assert.throws(() => serializeVisualPropertyValue('opacity', {kind: 'background-image', value: 'linear-gradient(90deg, var(--fc-entry-surface), transparent)'}), /背景图结构/u)
        assert.throws(() => serializeVisualPropertyValue('border-radius', {kind: 'box-shadow', layers: []}), /阴影结构/u)
        assert.throws(() => serializeVisualPropertyValue('opacity', {kind: 'numeric', value: 2, unit: '', numberText: '2'}), /0–1/u)
        assert.throws(() => serializeVisualPropertyValue('rotate', {kind: 'numeric', value: 2, unit: 'px', numberText: '2'}), /单位/u)
        assert.throws(() => serializeVisualPropertyValue('flex-grow', {kind: 'numeric', value: -1, unit: '', numberText: '-1'}), /负数/u)
    })

    it('半透明标准色与主题色写回后仍能由调节控件精确回读', () => {
        const standard = {kind: 'color' as const, value: '#112233', opacity: 50}
        const theme = {kind: 'color' as const, value: 'var(--fc-entry-accent)', opacity: 75}

        assert.deepEqual(parseSerializedVisualColor(serializeVisualPropertyValue('color', standard) ?? ''), standard)
        assert.deepEqual(parseSerializedVisualColor(serializeVisualPropertyValue('background-color', theme) ?? ''), theme)
        assert.equal(parseSerializedVisualColor('linear-gradient(red, blue)'), null)
    })

    it('清除本级设置使用 clear-override 且可以撤销', () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        const cleared = apply(initial, source, 'color', {kind: 'clear-override'})

        assert.doesNotMatch(cleared.entry.sources['style.css'], /color:\s*#334455/u)
        assert.deepEqual(undoEntryDraft(cleared).model.entry.sources, initial.entry.sources)
    })

    it('四边联动在同一请求内原子写入两条白名单声明', () => {
        const source = snapshot()
        const initial = createDocumentDraft(source)
        const runtime = createDocumentKernelDraftRuntime()
        const request = createVisualPropertyEditRequest(PARAGRAPH_ID, [
            {property: 'padding-block-start', value: {kind: 'numeric', value: 3, unit: 'px', numberText: '3'}},
            {property: 'padding-block-end', value: {kind: 'numeric', value: 3, unit: 'px', numberText: '3'}},
        ], {styleContext: 'mobile'}, () => 'linked-padding')
        const prepared = runtime.prepare(initial, source, request)

        assert.equal(prepared.status, 'ready', JSON.stringify(prepared))
        if (prepared.status !== 'ready') return
        const changed = runtime.applyPrepared(initial, source, prepared.edit, '调整内距')
        assert.equal(changed.applied, true)
        assert.match(changed.model.entry.sources['style.css'], /padding-block-start:\s*3px/u)
        assert.match(changed.model.entry.sources['style.css'], /padding-block-end:\s*3px/u)
    })
})
