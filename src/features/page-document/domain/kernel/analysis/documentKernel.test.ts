// 本模块验证公共内核外观以同一分析版本完成查询、绑定和属性检查，并拒绝跨版本句柄。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {
    idempotencyKey,
    interactionId,
    nodeId,
    parseSourceSnapshot,
    utf16Range,
    utf8Range,
    type ReadContext,
    type SourceSnapshot,
} from '../contracts/index.ts'
import {createDocumentKernel} from './documentKernel.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_NODE_ID = '33333333-3333-4333-8333-333333333333'
const ROOT_ID = '44444444-4444-4444-8444-444444444444'
const CONTEXT: ReadContext = {
    viewport: 'desktop',
    interactions: {hover: false, focusWithin: false},
    direction: 'ltr',
    writingMode: 'horizontal-tb',
}
const MOBILE_CONTEXT: ReadContext = {...CONTEXT, viewport: 'mobile'}

function sourceSnapshot(overrides: Partial<Record<string, string>> = {}): SourceSnapshot {
    const sources = {
        'project:article.html': `<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head><title data-fc-bind="title"></title></head><body><main class="article" data-fc-slot="entry-root"><div data-fc-slot="body"></div></main></body></html>`,
        'project:style.css': '.article { color: var(--ink); --ink: #123456; }',
        'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p></template></template>`,
        'entry:style.css': `@layer fc-node { [data-fc-node-id="${NODE_ID}"] { font-size: 18px; } }`,
        ...overrides,
    }
    return parseSourceSnapshot({
        id: `snapshot:${overrides['entry:style.css']?.length ?? 0}:${overrides['project:article.html']?.length ?? 0}`,
        templateVersion: 1,
        documents: Object.entries(sources).map(([key, content], index) => {
            const [scope, file] = key.split(':')
            return {
                key: {scope, file},
                content,
                contentHash: `hash:${index}:${content.length}`,
                persistentRevision: 1,
            }
        }),
    })
}

function analyze(snapshot = sourceSnapshot()) {
    const kernel = createDocumentKernel()
    const analysis = kernel.analyze({
        sourceSnapshot: snapshot,
        metadata: {id: ENTRY_ID, title: '内核测试', summary: '', tags: []},
        assetHash: 'assets:none',
        componentRegistryVersion: 'components:1',
        policyVersion: 'policy:1',
        writableScopes: ['entry'],
    })
    return {kernel, analysis}
}

describe('DocumentKernel read facade', () => {
    it('主题令牌分开报告本级声明与组合页面有效值', () => {
        const kernel = createDocumentKernel()
        const analysis = kernel.analyze({
            sourceSnapshot: sourceSnapshot({
                'project:style.css':
                    '@layer fc-project { :root { --fc-entry-text: #111111; --fc-entry-accent: #812345; } }',
                'entry:style.css': `@layer fc-entry { [ data-fc-entry-id = '${ENTRY_ID}' ] { --fc-entry-text: #222222; } }`,
            }),
            metadata: {id: ENTRY_ID, title: '内核测试', summary: '', tags: []},
            assetHash: 'assets:none',
            componentRegistryVersion: 'components:1',
            policyVersion: 'policy:1',
            writableScopes: ['project', 'entry'],
        })

        const entry = kernel.inspectThemeTokens(analysis, {
            scope: 'entry',
            properties: ['--fc-entry-text', '--fc-entry-accent'],
        })
        const project = kernel.inspectThemeTokens(analysis, {
            scope: 'project',
            properties: ['--fc-entry-text'],
        })

        assert.deepEqual(entry.failures, [])
        assert.equal(entry.tokens['--fc-entry-text'].managedValue?.rawValue, '#222222')
        assert.equal(entry.tokens['--fc-entry-text'].effectiveValue?.rawValue, '#222222')
        assert.equal(entry.tokens['--fc-entry-accent'].managedValue, null)
        assert.equal(entry.tokens['--fc-entry-accent'].effectiveValue?.rawValue, '#812345')
        assert.equal(project.tokens['--fc-entry-text'].managedValue?.rawValue, '#111111')
        assert.equal(project.tokens['--fc-entry-text'].effectiveValue?.rawValue, '#222222')
    })

    it('主题令牌写入经过候选分析并只验证目标作用域声明', () => {
        const kernel = createDocumentKernel()
        const analysis = kernel.analyze({
            sourceSnapshot: sourceSnapshot({
                'project:style.css': '@layer fc-project { :root { --fc-entry-text: #111111; } }',
                'entry:style.css': `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { --fc-entry-text: #222222; } }`,
            }),
            metadata: {id: ENTRY_ID, title: '内核测试', summary: '', tags: []},
            assetHash: 'assets:none',
            componentRegistryVersion: 'components:1',
            policyVersion: 'policy:1',
            writableScopes: ['project', 'entry'],
        })
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('request:project-theme-token'),
            interactionId: null,
            authorizedScopes: ['project'],
            intents: [
                {
                    kind: 'edit-theme-token',
                    target: {kind: 'theme-root', scope: 'project'},
                    property: '--fc-entry-text',
                    action: {kind: 'set-value', value: '#333333'},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const projectCss = result.prepared.candidateSnapshot.documents.find(
            document => document.key.scope === 'project' && document.key.file === 'style.css',
        )?.content
        const entryCss = result.prepared.candidateSnapshot.documents.find(
            document => document.key.scope === 'entry' && document.key.file === 'style.css',
        )?.content
        assert.match(projectCss ?? '', /--fc-entry-text: #333333/u)
        assert.match(entryCss ?? '', /--fc-entry-text: #222222/u)
    })

    it('以同一分析版本完成组件查询、绑定和来源感知属性检查', () => {
        const {kernel, analysis} = analyze()
        const queried = kernel.queryComponents(analysis, {kinds: ['paragraph']})
        const binding = kernel.bindComponents(analysis, [NODE_ID])

        assert.equal(analysis.diagnostics.length, 0)
        assert.equal(queried.length, 1)
        assert.deepEqual(binding.handles, [queried[0].handle])
        const result = kernel.inspectComponents(analysis, [
            {
                handle: queried[0].handle,
                properties: ['color', 'font-size', 'width'],
                context: CONTEXT,
            },
        ])
        assert.deepEqual(result.failures, [])
        const properties = result.components[0].properties
        assert.equal(properties.color.effectiveValue?.resolvedValue, '#123456')
        assert.equal(properties.color.effectiveValue?.inherited, true)
        assert.equal(properties['font-size'].effectiveValue?.rawValue, '18px')
        assert.equal(properties.width.valueCapability.kind, 'absent')
    })

    it('组件检查统一返回标签、属性、内容形态、来源与语义部位状态', () => {
        const assetId = '44444444-4444-4444-8444-444444444444'
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><figure data-fc-node-id="${assetId}" data-fc-node-kind="asset"><img alt="甲 &amp; 乙" src="asset://55555555-5555-4555-8555-555555555555"><figcaption>第一行<br>第二行</figcaption></figure></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['asset']})[0].handle
        const result = kernel.inspectComponents(analysis, [
            {handle, properties: [], context: CONTEXT},
            {
                handle,
                target: {kind: 'semantic-part', part: 'asset-image'},
                properties: [],
                context: CONTEXT,
            },
            {
                handle,
                target: {kind: 'semantic-part', part: 'asset-caption'},
                properties: [],
                context: CONTEXT,
            },
        ])

        assert.deepEqual(result.failures, [])
        assert.equal(result.components[0].structure.tagName, 'figure')
        assert.equal(
            result.components[0].structure.semanticParts.find(part => part.id === 'asset-caption')
                ?.status,
            'resolved',
        )
        assert.equal(result.components[1].structure.attributes.alt, '甲 & 乙')
        assert.equal(result.components[1].structure.origin?.source?.scope, 'entry')
        assert.equal(result.components[2].structure.textContent, '第一行\n第二行')
        assert.equal(result.components[2].structure.contentShape, 'plain-text')

        const custom = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><figure data-fc-node-id="${assetId}" data-fc-node-kind="asset"><img alt="" src="asset://55555555-5555-4555-8555-555555555555"><figcaption><em>自定义</em></figcaption></figure></template></template>`,
                'entry:style.css': '',
            }),
        )
        const customHandle = custom.kernel.queryComponents(custom.analysis, {kinds: ['asset']})[0]
            .handle
        const customCaption = custom.kernel.inspectComponents(custom.analysis, [
            {
                handle: customHandle,
                target: {kind: 'semantic-part', part: 'asset-caption'},
                properties: [],
                context: CONTEXT,
            },
        ])
        assert.equal(customCaption.components[0].structure.contentShape, 'structured')
    })

    it('组件结构检查从组合后的作者树统一回读矩形表格尺寸', () => {
        const tableId = '66666666-6666-4666-8666-666666666666'
        const cellIds = [
            '77777777-7777-4777-8777-777777777771',
            '77777777-7777-4777-8777-777777777772',
            '77777777-7777-4777-8777-777777777773',
            '77777777-7777-4777-8777-777777777774',
        ]
        const managedCell = (tag: 'th' | 'td', id: string, text: string) =>
            `<${tag} data-fc-node-id="${id}" data-fc-node-kind="table-cell">${text}</${tag}>`
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><table data-fc-node-id="${tableId}" data-fc-node-kind="table"><thead><tr>${managedCell('th', cellIds[0], '甲')}${managedCell('th', cellIds[1], '乙')}</tr></thead><tbody><tr>${managedCell('td', cellIds[2], '丙')}${managedCell('td', cellIds[3], '丁')}</tr></tbody></table></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['table']})[0].handle
        const result = kernel.inspectComponents(analysis, [
            {handle, properties: [], context: CONTEXT},
        ])

        assert.deepEqual(result.failures, [])
        assert.deepEqual(result.components[0].structure.table, {
            status: 'rectangular',
            rowCount: 2,
            columnCount: 2,
        })
    })

    it('组件删除入口统一报告父级、来源与结构安全限制', () => {
        const siblingId = '55555555-5555-4555-8555-555555555555'
        const listId = '66666666-6666-4666-8666-666666666666'
        const itemId = '77777777-7777-4777-8777-777777777777'
        const projectHtml = `<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head><title data-fc-bind="title"></title></head><body><main data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container" data-fc-editor-root data-fc-slot="entry-root"><div data-fc-slot="body"></div></main></body></html>`
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'project:article.html': projectHtml,
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p><p data-fc-node-id="${siblingId}" data-fc-node-kind="paragraph">保留</p><ul data-fc-node-id="${listId}" data-fc-node-kind="list"><li data-fc-node-id="${itemId}" data-fc-node-kind="list-item">唯一项</li></ul></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handles = kernel.bindComponents(analysis, [NODE_ID, ROOT_ID, itemId]).handles
        const inspections = kernel.inspectComponents(
            analysis,
            handles.map(handle => ({handle, properties: [], context: CONTEXT})),
        )

        assert.deepEqual(inspections.failures, [])
        const byId = new Map(
            inspections.components.map(component => [component.handle.nodeId, component]),
        )
        assert.deepEqual(byId.get(nodeId(NODE_ID))?.structure.removal, {
            status: 'available',
            parentNodeId: ROOT_ID,
            destinationScope: 'entry',
        })
        assert.deepEqual(byId.get(nodeId(NODE_ID))?.structure.movement, {
            status: 'available',
            parentNodeId: ROOT_ID,
            siblingNodeIds: [NODE_ID, siblingId, listId],
            currentIndex: 0,
            destinationScope: 'entry',
        })
        assert.deepEqual(byId.get(nodeId(ROOT_ID))?.structure.removal, {
            status: 'unavailable',
            code: 'editor-root-remove-forbidden',
            reason: '页面根容器不能删除。',
        })
        assert.deepEqual(byId.get(nodeId(ROOT_ID))?.structure.movement, {
            status: 'unavailable',
            code: 'editor-root-move-forbidden',
            reason: '页面根容器不能移动。',
        })
        assert.deepEqual(byId.get(nodeId(itemId))?.structure.removal, {
            status: 'unavailable',
            code: 'last-list-item-required',
            reason: '列表必须至少保留一个列表项。',
        })

        const [targetHandle, rootHandle, siblingHandle] = kernel.bindComponents(analysis, [
            NODE_ID,
            ROOT_ID,
            siblingId,
        ]).handles
        const moved = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('request:root-child-move'),
            interactionId: interactionId('interaction:root-child-move'),
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'move-component',
                    target: {kind: 'component-root', component: targetHandle},
                    expectedParentNodeId: rootHandle.nodeId,
                    expectedPreviousSiblingNodeId: null,
                    parent: rootHandle,
                    after: siblingHandle,
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(moved.status, 'ready')
        if (moved.status === 'ready') {
            const html = moved.prepared.candidateSnapshot.documents.find(
                document => document.key.scope === 'entry' && document.key.file === 'article.html',
            )?.content
            assert.ok(html)
            assert.ok(html.indexOf(siblingId) < html.indexOf(NODE_ID))
        }

        const onlyParagraph = analyze(
            sourceSnapshot({
                'project:article.html': projectHtml,
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">最后正文</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const paragraph = onlyParagraph.kernel.bindComponents(onlyParagraph.analysis, [NODE_ID])
            .handles[0]
        const lastParagraph = onlyParagraph.kernel.inspectComponents(onlyParagraph.analysis, [
            {handle: paragraph, properties: [], context: CONTEXT},
        ])
        assert.deepEqual(lastParagraph.components[0].structure.removal, {
            status: 'unavailable',
            code: 'visible_paragraph_required',
            reason: '隐藏后必须至少保留一个实际可见的段落。',
        })
    })

    it('组件移动入口只开放同一作者 HTML 中可证明的直接子项顺序', () => {
        const containerId = '55555555-5555-4555-8555-555555555555'
        const siblingId = '66666666-6666-4666-8666-666666666666'
        const wrappedId = '77777777-7777-4777-8777-777777777777'
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><div data-fc-node-id="${containerId}" data-fc-node-kind="container"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲</p><p data-fc-node-id="${siblingId}" data-fc-node-kind="paragraph">乙</p><section><p data-fc-node-id="${wrappedId}" data-fc-node-kind="paragraph">包装内容</p></section></div></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handles = kernel.bindComponents(analysis, [NODE_ID, wrappedId]).handles
        const inspected = kernel.inspectComponents(
            analysis,
            handles.map(handle => ({handle, properties: [], context: CONTEXT})),
        )

        assert.deepEqual(inspected.failures, [])
        const byId = new Map(
            inspected.components.map(component => [component.handle.nodeId, component]),
        )
        assert.deepEqual(byId.get(nodeId(NODE_ID))?.structure.movement, {
            status: 'available',
            parentNodeId: containerId,
            siblingNodeIds: [NODE_ID, siblingId],
            currentIndex: 0,
            destinationScope: 'entry',
        })
        assert.deepEqual(byId.get(nodeId(wrappedId))?.structure.movement, {
            status: 'unavailable',
            code: 'component-direct-parent-unavailable',
            reason: '组件位于自定义源码包装中，不能通过快捷命令安全重排。',
        })
    })

    it('公共选区检查统一返回混合值、继承值与依赖来源', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'project:style.css':
                    '.article { color: #123456; } .article strong { color: #cc0000; }',
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong>甲</strong>乙</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.inspectTextRanges(analysis, [
            {
                target: {
                    kind: 'text-range',
                    component: handle,
                    range: utf16Range(0, 2),
                    expected: '甲乙',
                },
                properties: ['color', 'font-weight', 'width'],
                context: CONTEXT,
            },
        ])

        assert.equal(result.ranges.length, 1)
        assert.deepEqual(result.ranges[0].properties.color.valueState, {
            kind: 'mixed',
            values: ['#cc0000', '#123456'],
        })
        assert.deepEqual(result.ranges[0].properties['font-weight'].valueState, {
            kind: 'mixed',
            values: ['700', null],
        })
        assert.equal(result.ranges[0].properties.color.segments.length, 2)
        assert.ok(result.ranges[0].properties.color.dependencies.sources.length >= 1)
        assert.deepEqual(result.ranges[0].link.valueState, {kind: 'uniform', value: null})
        assert.equal(result.failures[0]?.code, 'property-capability-unavailable')
        assert.equal(result.failures[0]?.property, 'width')
    })

    it('源码、元数据或策略变化都会产生新分析版本，旧句柄不能跨版本使用', () => {
        const kernel = createDocumentKernel()
        const first = kernel.analyze({
            sourceSnapshot: sourceSnapshot(),
            metadata: {id: ENTRY_ID, title: '第一版', summary: '', tags: []},
            assetHash: 'assets:none',
            componentRegistryVersion: 'components:1',
            policyVersion: 'policy:1',
        })
        const oldHandle = kernel.queryComponents(first)[0].handle
        const second = kernel.analyze({
            sourceSnapshot: sourceSnapshot({'entry:style.css': 'p { color: red; }'}),
            metadata: {id: ENTRY_ID, title: '第二版', summary: '', tags: []},
            assetHash: 'assets:none',
            componentRegistryVersion: 'components:1',
            policyVersion: 'policy:2',
        })

        assert.notEqual(first.stamp.id, second.stamp.id)
        const result = kernel.inspectComponents(second, [
            {handle: oldHandle, properties: ['color'], context: CONTEXT},
        ])
        assert.equal(result.components.length, 0)
        assert.equal(result.failures[0]?.code, 'stale-component-handle')
    })

    it('缺少逻辑源码时返回阻断诊断而不是构造不完整组件模型', () => {
        const complete = sourceSnapshot()
        const incomplete = parseSourceSnapshot({
            ...complete,
            id: 'snapshot:missing',
            documents: complete.documents.filter(
                document => !(document.key.scope === 'entry' && document.key.file === 'style.css'),
            ),
        })
        const {kernel, analysis} = analyze(incomplete)

        assert.equal(
            analysis.diagnostics.some(item => item.code === 'kernel_source_missing'),
            true,
        )
        assert.deepEqual(kernel.queryComponents(analysis), [])
        assert.equal(kernel.bindComponents(analysis, [NODE_ID]).failures.length, 1)
    })

    it('无效属性名按单项失败，不影响同批次其他属性', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis)[0].handle
        const result = kernel.inspectComponents(analysis, [
            {handle, properties: ['color', 'bad property'], context: CONTEXT},
        ])

        assert.equal(result.components[0].properties.color.propertyFamily, 'color')
        assert.equal(result.failures[0]?.code, 'invalid-property-name')
    })

    it('拒绝把另一个内核的分析对象当作本内核快照', () => {
        const first = analyze()
        const secondKernel = createDocumentKernel()
        assert.throws(() => secondKernel.queryComponents(first.analysis), /不属于/u)
    })

    it('不信任检查调用携带的运行时上下文', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis)[0].handle

        assert.throws(
            () =>
                kernel.inspectComponents(analysis, [
                    {
                        handle,
                        properties: ['color'],
                        context: {...CONTEXT, viewport: 'print'} as unknown as ReadContext,
                    },
                ]),
            /viewport/u,
        )
    })

    it('把同批次固定属性修改原子规划到候选并逐步重绑定组件', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:inline-batch'),
            interactionId: interactionId('interaction:inline-batch'),
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'width',
                    action: {kind: 'set-value', value: '37%'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'border-radius',
                    action: {kind: 'set-value', value: '8px'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        assert.equal(result.prepared.patches.length, 2)
        assert.notEqual(result.prepared.candidateAnalysis.stamp.id, analysis.stamp.id)
        const entryHtml = result.prepared.candidateSnapshot.documents.find(
            document => document.key.scope === 'entry' && document.key.file === 'article.html',
        )?.content
        assert.match(entryHtml ?? '', /style="width: 37%; border-radius: 8px;"/u)
        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
        assert.equal(rebound.handles.length, 1)
        assert.notEqual(rebound.handles[0].analysisStamp, handle.analysisStamp)
    })

    it('组件未声明布局能力时只拒绝对应属性意图', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:bad-gap'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'gap',
                    action: {kind: 'set-value', value: '12px'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'rejected')
        if (result.status === 'rejected') {
            assert.equal(result.diagnostics[0]?.code, 'property-capability-unavailable')
        }
    })

    it('未授权作用域与跨作用域行内写入均明确拒绝', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const base = {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:scope'),
            interactionId: null,
            intents: [
                {
                    kind: 'edit-property' as const,
                    target: {kind: 'component-root' as const, component: handle},
                    property: 'width',
                    action: {kind: 'set-value' as const, value: '50%'},
                    readContext: CONTEXT,
                    destination: {scope: 'project' as const, channel: {kind: 'inline' as const}},
                },
            ],
        }
        const denied = kernel.prepareEdit(analysis, {...base, authorizedScopes: ['entry']})
        assert.equal(denied.status, 'rejected')
        if (denied.status === 'rejected') {
            assert.equal(denied.diagnostics[0]?.code, 'write-scope-denied')
        }
        const mismatched = kernel.prepareEdit(analysis, {
            ...base,
            authorizedScopes: ['project'],
        })
        assert.equal(mismatched.status, 'rejected')
        if (mismatched.status === 'rejected') {
            assert.equal(mismatched.diagnostics[0]?.code, 'write-destination-unavailable')
        }
    })

    it('通过词条规则覆盖项目模板节点而不反写共享项目 HTML', () => {
        const snapshot = sourceSnapshot({
            'project:article.html': `<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head><title data-fc-bind="title"></title></head><body><main data-fc-node-id="${PROJECT_NODE_ID}" data-fc-node-kind="container" data-fc-slot="entry-root"><div data-fc-slot="body"></div></main></body></html>`,
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {sourceScope: 'project'})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:entry-override'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'background-color',
                    action: {kind: 'set-value', value: '#ffeecc'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'base-rule'}},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const beforeProject = snapshot.documents.find(
            item => item.key.scope === 'project' && item.key.file === 'article.html',
        )?.content
        const afterProject = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'project' && item.key.file === 'article.html',
        )?.content
        const entryCss = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'style.css',
        )?.content
        assert.equal(afterProject, beforeProject)
        assert.match(entryCss ?? '', new RegExp(PROJECT_NODE_ID, 'u'))
        assert.match(entryCss ?? '', /background-color: #ffeecc/u)
    })

    it('设备条件写入只改变目标断点并可从候选分析准确回读', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:desktop-font'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'font-size',
                    action: {kind: 'set-value', value: '24px'},
                    readContext: CONTEXT,
                    destination: {
                        scope: 'entry',
                        channel: {kind: 'conditional-rule', context: 'desktop'},
                    },
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const inspected = kernel.inspectComponents(result.prepared.candidateAnalysis, [
            {handle: rebound, properties: ['font-size'], context: MOBILE_CONTEXT},
            {handle: rebound, properties: ['font-size'], context: CONTEXT},
        ])
        assert.equal(
            inspected.components[0].properties['font-size'].effectiveValue?.rawValue,
            '18px',
        )
        assert.equal(
            inspected.components[1].properties['font-size'].effectiveValue?.rawValue,
            '24px',
        )
    })

    it('同一批次允许先建立条件基线再清除行内固定值，并只验收最终候选', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="font-size: 18px; color: red">正文</p></template></template>`,
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const root = {kind: 'component-root' as const, component: handle}
        const base = {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:migrate-inline-baseline'),
            interactionId: null,
            authorizedScopes: ['entry'] as const,
        }
        const result = kernel.prepareEdit(analysis, {
            ...base,
            intents: [
                {
                    kind: 'edit-property',
                    target: root,
                    property: 'font-size',
                    action: {kind: 'set-value', value: '18px'},
                    readContext: MOBILE_CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'base-rule'}},
                },
                {
                    kind: 'edit-property',
                    target: root,
                    property: 'font-size',
                    action: {kind: 'set-value', value: '18px'},
                    readContext: CONTEXT,
                    destination: {
                        scope: 'entry',
                        channel: {kind: 'conditional-rule', context: 'desktop'},
                    },
                },
                {
                    kind: 'edit-property',
                    target: root,
                    property: 'font-size',
                    action: {kind: 'clear-override'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
                {
                    kind: 'edit-property',
                    target: root,
                    property: 'font-size',
                    action: {kind: 'set-value', value: '24px'},
                    readContext: CONTEXT,
                    destination: {
                        scope: 'entry',
                        channel: {kind: 'conditional-rule', context: 'desktop'},
                    },
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.doesNotMatch(html ?? '', /font-size/u)
        assert.match(html ?? '', /color: red/u)
        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const inspected = kernel.inspectComponents(result.prepared.candidateAnalysis, [
            {handle: rebound, properties: ['font-size'], context: MOBILE_CONTEXT},
            {handle: rebound, properties: ['font-size'], context: CONTEXT},
        ])
        assert.equal(
            inspected.components[0].properties['font-size'].effectiveValue?.rawValue,
            '18px',
        )
        assert.equal(
            inspected.components[1].properties['font-size'].effectiveValue?.rawValue,
            '24px',
        )
    })

    it('普通静态声明被受控值替换时不要求无意义确认', () => {
        const {kernel, analysis} = analyze(sourceSnapshot({'entry:style.css': 'p { color: red; }'}))
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:ordinary-color'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'set-value', value: 'blue'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status === 'ready') assert.deepEqual(result.prepared.impacts, [])
    })

    it('仅在新修改遮住条件效果时要求一次具体确认', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:style.css': 'p { color: red; }\np:hover { color: green; }',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:mask-hover'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'set-value', value: 'blue'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'needs-decision')
        if (result.status !== 'needs-decision') return
        assert.deepEqual(
            result.decisions.map(item => item.code),
            ['replace-context-specific-author-value'],
        )
        assert.match(result.decisions[0]?.message ?? '', /悬停/u)

        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const subsequent = kernel.prepareEdit(result.prepared.candidateAnalysis, {
            baseAnalysis: result.prepared.candidateAnalysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:change-confirmed-color'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: rebound},
                    property: 'color',
                    action: {kind: 'set-value', value: 'navy'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })
        assert.equal(subsequent.status, 'ready')
    })

    it('新声明遮住无法解释的同属性条件时返回绑定计划的影响', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({'entry:style.css': 'p:visited { color: purple; }'}),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:mask-unknown'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'set-value', value: 'blue'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'needs-decision')
        if (result.status !== 'needs-decision') return
        assert.equal(result.decisions[0]?.code, 'mask-indeterminate-author-condition')
        assert.equal(result.prepared.planId.length > 0, true)
        assert.deepEqual(result.prepared.impacts, result.decisions)
    })

    it('候选值被更高优先级声明吞掉时整批拒绝而不返回半成品', () => {
        const snapshot = sourceSnapshot({
            'entry:style.css': 'p { color: red !important; }',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:overridden-batch'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'width',
                    action: {kind: 'set-value', value: '37%'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'set-value', value: 'blue'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'rejected')
        if (result.status === 'rejected') {
            assert.equal(result.diagnostics[0]?.code, 'edit-postcondition-overridden')
        }
        assert.equal(analysis.sourceSnapshot, snapshot)
        assert.doesNotMatch(
            analysis.sourceSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content ?? '',
            /style=/u,
        )
    })

    it('清除本级行内覆盖后恢复较低来源而不是误报未设置', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph" style="color: blue; width: 75%">正文</p></template></template>`,
                'entry:style.css': 'p { color: red; }',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:clear-color'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'clear-override'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const inspected = kernel.inspectComponents(result.prepared.candidateAnalysis, [
            {handle: rebound, properties: ['color'], context: CONTEXT},
        ])
        assert.equal(inspected.components[0].properties.color.effectiveValue?.rawValue, 'red')
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(html ?? '', /style=" width: 75%"/u)
        assert.doesNotMatch(html ?? '', /color:/u)
    })

    it('公共准备入口把伪造的额外权限字段转为结构化拒绝', () => {
        const {kernel, analysis} = analyze()
        const handle = kernel.queryComponents(analysis)[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:forged'),
            interactionId: null,
            authorizedScopes: ['entry'],
            elevated: true,
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'color',
                    action: {kind: 'set-value', value: 'red'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        } as never)

        assert.equal(result.status, 'rejected')
        if (result.status === 'rejected') {
            assert.equal(result.diagnostics[0]?.code, 'invalid-edit-batch')
            assert.match(result.diagnostics[0]?.message ?? '', /未知字段 elevated/u)
        }
    })

    it('局部格式只包装命中文本叶子并逐字保留未选中的 strong 结构', () => {
        const snapshot = sourceSnapshot({
            'project:style.css': '.article strong { color: #c00; }',
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong>甲</strong>乙&amp;😀</p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:italic-yi'),
            interactionId: interactionId('interaction:italic-yi'),
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    property: 'font-style',
                    action: {kind: 'set-value', value: 'italic'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            html ?? '',
            /<strong>甲<\/strong><span data-fc-inline-format="font-style" style="font-style: italic;">乙<\/span>&amp;😀/u,
        )
        assert.equal(
            result.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'project' && item.key.file === 'style.css',
            )?.content,
            '.article strong { color: #c00; }',
        )
        assert.equal(result.prepared.patches[0]?.structuralChange, 'inline-wrapper')

        const rebound = kernel.bindComponents(result.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const repeated = kernel.prepareEdit(result.prepared.candidateAnalysis, {
            baseAnalysis: result.prepared.candidateAnalysis.stamp.id,
            idempotencyKey: idempotencyKey('edit:italic-yi-repeat'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {
                        kind: 'text-range',
                        component: rebound,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    property: 'font-style',
                    action: {kind: 'set-value', value: 'italic'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })
        assert.equal(repeated.status, 'unchanged')
    })

    it('文本格式通过实体源码映射且拒绝切开 emoji 代理对', () => {
        const snapshot = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲&amp;😀</p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis)[0].handle
        const format = (range: ReturnType<typeof utf16Range>, expected: string, key: string) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'edit-property' as const,
                        target: {kind: 'text-range' as const, component: handle, range, expected},
                        property: 'font-weight',
                        action: {kind: 'set-value' as const, value: '700'},
                        readContext: CONTEXT,
                        destination: {scope: 'entry' as const, channel: {kind: 'inline' as const}},
                    },
                ],
            })

        const entity = format(utf16Range(1, 2), '&', 'edit:entity')
        assert.equal(entity.status, 'ready')
        if (entity.status === 'ready') {
            const html = entity.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content
            assert.match(
                html ?? '',
                /<span data-fc-inline-format="font-weight" style="font-weight: 700;">&amp;<\/span>😀/u,
            )
        }

        const splitEmoji = format(utf16Range(2, 3), '\ud83d', 'edit:split-emoji')
        assert.equal(splitEmoji.status, 'rejected')
        if (splitEmoji.status === 'rejected') {
            assert.equal(splitEmoji.diagnostics[0]?.code, 'text-precondition-failed')
        }
    })

    it('同一选区调整复用包装，显式关闭保留覆盖而清除工具包装回到原文', () => {
        const originalHtml = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><em>甲乙</em></p></template></template>`
        const snapshot = sourceSnapshot({
            'entry:article.html': originalHtml,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const original = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const edit = (
            current: typeof analysis,
            handle: typeof original,
            action: {kind: 'set-value'; value: string} | {kind: 'clear-override'},
            key: string,
        ) =>
            kernel.prepareEdit(current, {
                baseAnalysis: current.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'edit-property',
                        target: {
                            kind: 'text-range',
                            component: handle,
                            range: utf16Range(1, 2),
                            expected: '乙',
                        },
                        property: 'font-style',
                        action,
                        readContext: CONTEXT,
                        destination: {scope: 'entry', channel: {kind: 'inline'}},
                    },
                ],
            })

        const explicitOff = edit(analysis, original, {kind: 'set-value', value: 'normal'}, 'off')
        assert.equal(explicitOff.status, 'ready')
        if (explicitOff.status !== 'ready') return
        const offHtml = explicitOff.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            offHtml ?? '',
            /<em>甲<span data-fc-inline-format="font-style" style="font-style: normal;">乙<\/span><\/em>/u,
        )

        const offHandle = kernel.bindComponents(explicitOff.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const adjusted = edit(
            explicitOff.prepared.candidateAnalysis,
            offHandle,
            {kind: 'set-value', value: 'oblique'},
            'adjust',
        )
        assert.equal(adjusted.status, 'ready')
        if (adjusted.status !== 'ready') return
        const adjustedHtml = adjusted.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(adjustedHtml ?? '', /style="font-style: oblique;"/u)
        assert.equal(adjustedHtml?.match(/data-fc-inline-format/gu)?.length, 1)

        const adjustedHandle = kernel.bindComponents(adjusted.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const cleared = edit(
            adjusted.prepared.candidateAnalysis,
            adjustedHandle,
            {kind: 'clear-override'},
            'clear',
        )
        assert.equal(cleared.status, 'ready')
        if (cleared.status !== 'ready') return
        const clearedHtml = cleared.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.equal(clearedHtml, originalHtml)
    })

    it('清除目标声明时保留工具包装里的其他作者声明', () => {
        const snapshot = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲<span data-fc-inline-format="font-style" style="font-style: oblique; color: red;">乙</span></p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const cleared = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('clear-one-of-two-inline-properties'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    property: 'font-style',
                    action: {kind: 'clear-override'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })
        assert.equal(cleared.status, 'ready')
        if (cleared.status !== 'ready') return
        const clearedHtml = cleared.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            clearedHtml ?? '',
            /<span data-fc-inline-format="font-style" style="\s*color: red;">乙<\/span>/u,
        )
        assert.doesNotMatch(clearedHtml ?? '', /font-style:/u)
    })

    it('文本选区回读项目样式、祖先继承与 strong 语义而不制造冗余包装', () => {
        const snapshot = sourceSnapshot({
            'project:style.css': '.article { color: #123456; } .article strong { color: #cc0000; }',
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong>甲</strong>乙</p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const sameValue = (
            range: ReturnType<typeof utf16Range>,
            expected: string,
            property: string,
            value: string,
            key: string,
        ) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'edit-property' as const,
                        target: {kind: 'text-range' as const, component: handle, range, expected},
                        property,
                        action: {kind: 'set-value' as const, value},
                        readContext: CONTEXT,
                        destination: {scope: 'entry' as const, channel: {kind: 'inline' as const}},
                    },
                ],
            })

        const strongColor = sameValue(utf16Range(0, 1), '甲', 'color', '#cc0000', 'same:1')
        const inheritedColor = sameValue(utf16Range(1, 2), '乙', 'color', '#123456', 'same:2')
        const semanticWeight = sameValue(utf16Range(0, 1), '甲', 'font-weight', '700', 'same:3')
        for (const result of [strongColor, inheritedColor, semanticWeight]) {
            assert.equal(result.status, 'unchanged')
        }
    })

    it('天然粗体清除覆盖保持 unchanged，写入 400 后再清除可逐字恢复', () => {
        const originalHtml = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲<strong>乙</strong></p></template></template>`
        const snapshot = sourceSnapshot({
            'entry:article.html': originalHtml,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const edit = (
            current: typeof analysis,
            currentHandle: typeof handle,
            action: {kind: 'clear-override'} | {kind: 'set-value'; value: string},
            key: string,
        ) =>
            kernel.prepareEdit(current, {
                baseAnalysis: current.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'edit-property' as const,
                        target: {
                            kind: 'text-range' as const,
                            component: currentHandle,
                            range: utf16Range(1, 2),
                            expected: '乙',
                        },
                        property: 'font-weight',
                        action,
                        readContext: CONTEXT,
                        destination: {scope: 'entry' as const, channel: {kind: 'inline' as const}},
                    },
                ],
            })

        const unchanged = edit(analysis, handle, {kind: 'clear-override'}, 'strong:clear')
        assert.equal(unchanged.status, 'unchanged')

        const regular = edit(analysis, handle, {kind: 'set-value', value: '400'}, 'strong:off')
        assert.equal(regular.status, 'ready')
        if (regular.status !== 'ready') return
        const regularHtml = regular.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            regularHtml ?? '',
            /<strong><span data-fc-inline-format="font-weight" style="font-weight: 400;">乙<\/span><\/strong>/u,
        )

        const rebound = kernel.bindComponents(regular.prepared.candidateAnalysis, [NODE_ID])
            .handles[0]
        const restored = edit(
            regular.prepared.candidateAnalysis,
            rebound,
            {kind: 'clear-override'},
            'strong:on',
        )
        assert.equal(restored.status, 'ready')
        if (restored.status !== 'ready') return
        assert.equal(
            restored.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content,
            originalHtml,
        )
    })

    for (const [label, sourceBody, restoredBody, currentValue, baseValue, toggledValue] of [
        [
            '普通文字的受管 300',
            '甲<span data-fc-inline-format="font-weight" style="font-weight: 300;">乙</span>',
            '甲乙',
            '300',
            null,
            '700',
        ],
        [
            'strong 内的受管 900',
            '甲<strong><span data-fc-inline-format="font-weight" style="font-weight: 900;">乙</span></strong>',
            '甲<strong>乙</strong>',
            '900',
            '700',
            '400',
        ],
    ] as const) {
        it(`${label}按去掉覆盖后的粗细切换并逐字恢复无覆盖源码`, () => {
            const html = (body: string) =>
                `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">${body}</p></template></template>`
            const snapshot = sourceSnapshot({
                'entry:article.html': html(sourceBody),
                'entry:style.css': '',
            })
            const {kernel, analysis} = analyze(snapshot)
            const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
            const inspected = kernel.inspectTextRanges(analysis, [
                {
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    properties: ['font-weight'],
                    context: CONTEXT,
                },
            ])
            const segment = inspected.ranges[0]?.properties['font-weight']?.segments[0]
            assert.equal(segment?.value, currentValue)
            assert.equal(segment?.managedOverride, true)
            assert.equal(segment?.valueWithoutManagedOverride, baseValue)

            const edit = (
                current: typeof analysis,
                currentHandle: typeof handle,
                action: {kind: 'clear-override'} | {kind: 'set-value'; value: string},
                key: string,
            ) =>
                kernel.prepareEdit(current, {
                    baseAnalysis: current.stamp.id,
                    idempotencyKey: idempotencyKey(key),
                    interactionId: null,
                    authorizedScopes: ['entry'],
                    intents: [
                        {
                            kind: 'edit-property' as const,
                            target: {
                                kind: 'text-range' as const,
                                component: currentHandle,
                                range: utf16Range(1, 2),
                                expected: '乙',
                            },
                            property: 'font-weight',
                            action,
                            readContext: CONTEXT,
                            destination: {
                                scope: 'entry' as const,
                                channel: {kind: 'inline' as const},
                            },
                        },
                    ],
                })

            const toggled = edit(
                analysis,
                handle,
                {kind: 'set-value', value: toggledValue},
                `weight:${currentValue}:toggle`,
            )
            assert.equal(toggled.status, 'ready')
            if (toggled.status !== 'ready') return
            assert.match(
                toggled.prepared.candidateSnapshot.documents.find(
                    item => item.key.scope === 'entry' && item.key.file === 'article.html',
                )?.content ?? '',
                new RegExp(`font-weight: ${toggledValue};`, 'u'),
            )

            const rebound = kernel.bindComponents(toggled.prepared.candidateAnalysis, [NODE_ID])
                .handles[0]
            const restored = edit(
                toggled.prepared.candidateAnalysis,
                rebound,
                {kind: 'clear-override'},
                `weight:${currentValue}:restore`,
            )
            assert.equal(restored.status, 'ready')
            if (restored.status !== 'ready') return
            assert.equal(
                restored.prepared.candidateSnapshot.documents.find(
                    item => item.key.scope === 'entry' && item.key.file === 'article.html',
                )?.content,
                html(restoredBody),
            )
        })
    }

    it('清除带作者属性的受管 span 时保留标签和 class', () => {
        const snapshot = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲<span class="kept" data-fc-inline-format="font-weight" style="font-weight: 400;">乙</span></p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const cleared = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('managed-span:keep-author-attrs'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    property: 'font-weight',
                    action: {kind: 'clear-override'},
                    readContext: CONTEXT,
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                },
            ],
        })

        assert.equal(cleared.status, 'ready')
        if (cleared.status !== 'ready') return
        const html = cleared.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            html ?? '',
            /<span class="kept" data-fc-inline-format="font-weight">乙<\/span>/u,
        )
        assert.doesNotMatch(html ?? '', /style=/u)
    })

    it('文本替换保留范围外行内结构、实体并把换行写为 br', () => {
        const snapshot = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong class="kept">甲</strong>乙&amp;😀</p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis, {kinds: ['paragraph']})[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('text:replace'),
            interactionId: interactionId('text:typing'),
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'replace-text',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 3),
                        expected: '乙&',
                    },
                    coordinateSpace: 'current-candidate',
                    text: '<新\n',
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(html ?? '', /<strong class="kept">甲<\/strong>&lt;新<br>😀/u)
        assert.doesNotMatch(html ?? '', /&amp;/u)
        assert.equal(result.prepared.patches[0]?.structuralChange, 'inline-wrapper')
    })

    it('批次内文本坐标按当前候选顺序解释且任一前置条件失败时整批拒绝', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲乙😀</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const intent = (from: number, to: number, expected: string, text: string) => ({
            kind: 'replace-text' as const,
            target: {
                kind: 'text-range' as const,
                component: handle,
                range: utf16Range(from, to),
                expected,
            },
            coordinateSpace: 'current-candidate' as const,
            text,
        })
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('text:sequential'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [intent(0, 0, '', '前'), intent(2, 3, '乙', '后')],
        })
        assert.equal(result.status, 'ready')
        if (result.status === 'ready') {
            const html = result.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content
            assert.match(html ?? '', />前甲后😀<\/p>/u)
        }

        const rejected = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('text:atomic-reject'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [intent(0, 0, '', '前'), intent(2, 3, '错', '后')],
        })
        assert.equal(rejected.status, 'rejected')
        if (rejected.status === 'rejected') {
            assert.equal(rejected.diagnostics[0]?.code, 'text-precondition-failed')
        }
        assert.doesNotMatch(analysis.sourceSnapshot.documents[2].content, /前/u)
    })

    it('文本替换拒绝切开 emoji 且重复写入相同文字不产生补丁', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">甲😀</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const replace = (
            range: ReturnType<typeof utf16Range>,
            expected: string,
            text: string,
            key: string,
        ) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'replace-text' as const,
                        target: {kind: 'text-range' as const, component: handle, range, expected},
                        coordinateSpace: 'current-candidate' as const,
                        text,
                    },
                ],
            })
        const split = replace(utf16Range(1, 2), '\ud83d', '坏', 'text:split')
        assert.equal(split.status, 'rejected')
        const unchanged = replace(utf16Range(0, 1), '甲', '甲', 'text:same')
        assert.equal(unchanged.status, 'unchanged')
    })

    it('添加链接只包装选中文本并保留相邻 strong 结构', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong>甲</strong>乙</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('link:add'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'set-link',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 2),
                        expected: '乙',
                    },
                    coordinateSpace: 'current-candidate',
                    href: 'https://example.com/a?x=1&y=2',
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            html ?? '',
            /<strong>甲<\/strong><a data-fc-inline-link href="https:\/\/example\.com\/a\?x=1&amp;y=2">乙<\/a>/u,
        )
    })

    it('完整链接可精确改目标和移除 href，部分链接改写则原子拒绝', () => {
        const snapshot = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><a class="kept" href='https://old.example/'>甲乙</a>丙</p></template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(snapshot)
        const handle = kernel.queryComponents(analysis)[0].handle
        const edit = (
            from: number,
            to: number,
            expected: string,
            href: string | null,
            key: string,
        ) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'set-link' as const,
                        target: {
                            kind: 'text-range' as const,
                            component: handle,
                            range: utf16Range(from, to),
                            expected,
                        },
                        coordinateSpace: 'current-candidate' as const,
                        href,
                    },
                ],
            })

        const changed = edit(0, 2, '甲乙', 'https://new.example/?x=1&y=2', 'link:change')
        assert.equal(changed.status, 'ready')
        if (changed.status === 'ready') {
            const html = changed.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content
            assert.match(
                html ?? '',
                /<a class="kept" href='https:\/\/new\.example\/\?x=1&amp;y=2'>甲乙<\/a>丙/u,
            )
        }

        const removed = edit(0, 2, '甲乙', null, 'link:remove')
        assert.equal(removed.status, 'ready')
        if (removed.status === 'ready') {
            const html = removed.prepared.candidateSnapshot.documents.find(
                item => item.key.scope === 'entry' && item.key.file === 'article.html',
            )?.content
            assert.match(html ?? '', /<a class="kept" >甲乙<\/a>丙/u)
            assert.doesNotMatch(html ?? '', /href=/u)
        }

        const partial = edit(0, 1, '甲', 'https://other.example/', 'link:partial')
        assert.equal(partial.status, 'rejected')
        if (partial.status === 'rejected') {
            assert.equal(
                partial.diagnostics[0]?.code,
                'partial-link-rewrite-requires-structure-plan',
            )
        }
        const unsafe = edit(0, 2, '甲乙', 'javascript:alert(1)', 'link:unsafe')
        assert.equal(unsafe.status, 'rejected')
        if (unsafe.status === 'rejected') {
            assert.equal(unsafe.diagnostics[0]?.code, 'forbidden_href_scheme')
        }
    })

    it('公共选区检查区分统一链接、混合链接与纯文本', () => {
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><a class="kept" href="https://example.com/">甲乙</a>丙</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const inspect = (from: number, to: number, expected: string) =>
            kernel.inspectTextRanges(analysis, [
                {
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(from, to),
                        expected,
                    },
                    properties: [],
                    context: CONTEXT,
                },
            ]).ranges[0].link

        assert.deepEqual(inspect(0, 2, '甲乙').valueState, {
            kind: 'uniform',
            value: 'https://example.com/',
        })
        assert.deepEqual(inspect(1, 3, '乙丙').valueState, {
            kind: 'mixed',
            values: ['https://example.com/', null],
        })
        assert.deepEqual(inspect(2, 3, '丙').valueState, {kind: 'uniform', value: null})
        assert.equal(inspect(0, 2, '甲乙').segments[0].linkOrigin?.source?.scope, 'entry')
    })

    it('分裂段落时由宿主提供新身份并逐字保留两侧行内结构', () => {
        const newNodeId = '44444444-4444-4444-8444-444444444444'
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong class="kept">甲&amp;乙</strong><a href="https://example.com/">丙丁</a></p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('paragraph:split'),
            interactionId: interactionId('interaction:paragraph:split'),
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'split-text-block',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(2, 2),
                        expected: '',
                    },
                    coordinateSpace: 'current-candidate',
                    newNodeId: nodeId(newNodeId),
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(html ?? '', /<strong class="kept">甲&amp;<\/strong><\/p>/u)
        assert.match(
            html ?? '',
            new RegExp(
                `<p data-fc-node-id="${newNodeId}" data-fc-node-kind="paragraph"><strong class="kept">乙<\\/strong><a href="https:\\/\\/example\\.com\\/">丙丁<\\/a><\\/p>`,
                'u',
            ),
        )
        assert.equal(result.prepared.patches[0].structuralChange, 'component-tree')
        assert.equal(kernel.queryComponents(result.prepared.candidateAnalysis).length, 2)
    })

    it('标题分裂创建普通段落，并拒绝非折叠选区与重复身份', () => {
        const headingId = '55555555-5555-4555-8555-555555555555'
        const newNodeId = '66666666-6666-4666-8666-666666666666'
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><h2 data-fc-node-id="${headingId}" data-fc-node-kind="heading">标题正文</h2><p data-fc-node-id="${newNodeId}" data-fc-node-kind="paragraph">已有</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis, {kinds: ['heading']})[0].handle
        const prepare = (range: ReturnType<typeof utf16Range>, expected: string, id: string) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(`heading:${id}`),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'split-text-block' as const,
                        target: {kind: 'text-range' as const, component: handle, range, expected},
                        coordinateSpace: 'current-candidate' as const,
                        newNodeId: nodeId(id),
                    },
                ],
            })

        const selected = prepare(utf16Range(0, 1), '标', NODE_ID)
        assert.equal(selected.status, 'rejected')
        if (selected.status === 'rejected') {
            assert.equal(selected.diagnostics[0]?.code, 'text-block-split-selection-not-collapsed')
        }
        const duplicate = prepare(utf16Range(2, 2), '', newNodeId)
        assert.equal(duplicate.status, 'rejected')
        if (duplicate.status === 'rejected') {
            assert.equal(duplicate.diagnostics[0]?.code, 'duplicate-node-id')
        }
        const createdId = '77777777-7777-4777-8777-777777777777'
        const created = prepare(utf16Range(2, 2), '', createdId)
        assert.equal(created.status, 'ready')
        if (created.status !== 'ready') return
        const html = created.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(
            html ?? '',
            new RegExp(
                `<\\/h2>\\n<p data-fc-node-id="${createdId}" data-fc-node-kind="paragraph">正文<\\/p>`,
                'u',
            ),
        )
    })

    it('同批次先删除选区再分裂，后续坐标只按当前候选解释', () => {
        const newNodeId = nodeId('88888888-8888-4888-8888-888888888888')
        const {kernel, analysis} = analyze(
            sourceSnapshot({
                'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body"><p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph"><strong>甲乙</strong>丙丁</p></template></template>`,
                'entry:style.css': '',
            }),
        )
        const handle = kernel.queryComponents(analysis)[0].handle
        const result = kernel.prepareEdit(analysis, {
            baseAnalysis: analysis.stamp.id,
            idempotencyKey: idempotencyKey('paragraph:replace-then-split'),
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'replace-text',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 3),
                        expected: '乙丙',
                    },
                    coordinateSpace: 'current-candidate',
                    text: '',
                },
                {
                    kind: 'split-text-block',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: utf16Range(1, 1),
                        expected: '',
                    },
                    coordinateSpace: 'current-candidate',
                    newNodeId,
                },
            ],
        })

        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        const paragraphs = kernel.queryComponents(result.prepared.candidateAnalysis, {
            kinds: ['paragraph'],
        })
        assert.equal(paragraphs.length, 2)
        const html = result.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.match(html ?? '', /<strong>甲<\/strong><\/p>/u)
        assert.match(html ?? '', new RegExp(`${newNodeId}[^>]*>丁<\\/p>`, 'u'))
        assert.equal(result.prepared.patches.length, 3)
        assert.notEqual(result.prepared.patches[1].baseline, result.prepared.patches[2].baseline)
    })

    it('源码 edit 允许组内中间文本无效，但只接纳最终可分析候选', () => {
        const source = sourceSnapshot()
        const {kernel, analysis} = analyze(source)
        const css = source.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'style.css',
        )?.content
        assert.ok(css)
        const openingQuote = css.indexOf('"')
        const closingQuote = css.indexOf('"', openingQuote + 1)
        const edit = (from: number) => ({
            source: {scope: 'entry' as const, file: 'style.css' as const},
            range: utf8Range(from, from + 1),
            expected: '"',
            insert: "'",
        })
        const prepare = (edits: readonly ReturnType<typeof edit>[], key: string) =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'apply-source-edits' as const,
                        componentStructure: 'preserve-managed-components' as const,
                        edits,
                    },
                ],
            })

        const invalid = prepare([edit(openingQuote)], 'source-edit:invalid-intermediate')
        assert.equal(invalid.status, 'rejected')
        if (invalid.status === 'rejected') {
            assert.equal(invalid.diagnostics[0]?.code, 'css_syntax_error')
        }

        const atomic = prepare(
            [edit(openingQuote), edit(closingQuote)],
            'source-edit:atomic-valid-candidate',
        )
        assert.equal(atomic.status, 'ready')
        if (atomic.status !== 'ready') return
        const nextCss = atomic.prepared.candidateSnapshot.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'style.css',
        )?.content
        assert.match(nextCss ?? '', new RegExp(`data-fc-node-id='${NODE_ID}'`, 'u'))
        assert.equal(atomic.prepared.patches.length, 2)
        assert.equal(
            atomic.prepared.patches.every(patch => patch.structuralChange === 'none'),
            true,
        )
        assert.equal(kernel.queryComponents(atomic.prepared.candidateAnalysis).length, 1)
    })

    it('源码 escape hatch 保留内部 HTML，但拒绝未声明的组件身份、改型与顺序变化', () => {
        const siblingId = '55555555-5555-4555-8555-555555555555'
        const changedId = '66666666-6666-4666-8666-666666666666'
        const headingId = '77777777-7777-4777-8777-777777777777'
        const first = `<p data-fc-node-id="${NODE_ID}" data-fc-node-kind="paragraph">正文</p>`
        const second = `<p data-fc-node-id="${siblingId}" data-fc-node-kind="paragraph">附注</p>`
        const heading = `<h2 data-fc-node-id="${headingId}" data-fc-node-kind="heading">标题</h2>`
        const source = sourceSnapshot({
            'entry:article.html': `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="body">${first}${second}${heading}</template></template>`,
            'entry:style.css': '',
        })
        const {kernel, analysis} = analyze(source)
        const html = source.documents.find(
            item => item.key.scope === 'entry' && item.key.file === 'article.html',
        )?.content
        assert.ok(html)
        const edit = (expected: string, insert: string, occurrence = 0) => {
            let from = -1
            let cursor = 0
            for (let index = 0; index <= occurrence; index += 1) {
                from = html.indexOf(expected, cursor)
                cursor = from + expected.length
            }
            assert.notEqual(from, -1)
            const fromBytes = new TextEncoder().encode(html.slice(0, from)).length
            const toBytes = fromBytes + new TextEncoder().encode(expected).length
            return {
                source: {scope: 'entry' as const, file: 'article.html' as const},
                range: utf8Range(fromBytes, toBytes),
                expected,
                insert,
            }
        }
        const prepare = (
            edits: readonly ReturnType<typeof edit>[],
            key: string,
        ): ReturnType<typeof kernel.prepareEdit> =>
            kernel.prepareEdit(analysis, {
                baseAnalysis: analysis.stamp.id,
                idempotencyKey: idempotencyKey(key),
                interactionId: null,
                authorizedScopes: ['entry'],
                intents: [
                    {
                        kind: 'apply-source-edits',
                        componentStructure: 'preserve-managed-components',
                        edits,
                    },
                ],
            })

        const internalMarkup = prepare(
            [edit('正文', '<strong>正文</strong>')],
            'source-edit:internal-markup',
        )
        assert.equal(internalMarkup.status, 'ready')

        const identityChange = prepare([edit(NODE_ID, changedId)], 'source-edit:identity-change')
        assert.equal(identityChange.status, 'rejected')
        if (identityChange.status === 'rejected') {
            assert.equal(
                identityChange.diagnostics[0]?.code,
                'source-edit-component-structure-mismatch',
            )
            assert.match(identityChange.diagnostics[0]?.message ?? '', /新增.+删除或改写身份/u)
        }

        const kindChange = prepare(
            [
                edit('<p data-fc-node-id', '<h2 data-fc-node-id'),
                edit('data-fc-node-kind="paragraph"', 'data-fc-node-kind="heading"'),
                edit('</p>', '</h2>'),
            ],
            'source-edit:kind-change',
        )
        assert.equal(kindChange.status, 'rejected')
        if (kindChange.status === 'rejected') {
            assert.equal(
                kindChange.diagnostics[0]?.code,
                'source-edit-component-structure-mismatch',
            )
            assert.match(kindChange.diagnostics[0]?.message ?? '', /改型/u)
        }

        const tagChange = prepare(
            [edit('<h2 data-fc-node-id', '<h6 data-fc-node-id'), edit('</h2>', '</h6>')],
            'source-edit:managed-tag-change',
        )
        assert.equal(tagChange.status, 'rejected')
        if (tagChange.status === 'rejected') {
            assert.equal(tagChange.diagnostics[0]?.code, 'source-edit-component-structure-mismatch')
            assert.match(tagChange.diagnostics[0]?.message ?? '', /改变语义标签/u)
        }

        const reorder = prepare(
            [edit(`${first}${second}`, `${second}${first}`)],
            'source-edit:reorder',
        )
        assert.equal(reorder.status, 'rejected')
        if (reorder.status === 'rejected') {
            assert.equal(reorder.diagnostics[0]?.code, 'source-edit-component-structure-mismatch')
            assert.match(reorder.diagnostics[0]?.message ?? '', /根组件顺序/u)
        }
    })
})
