// 这些测试固定唯一内存模型在源码、可视操作、历史、保存与外部冲突之间的状态一致性。
import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import type {EntrySourceSnapshot} from '../domain/contract.ts'
import {
    idempotencyKey,
    interactionId,
    utf16Range,
    type EditIntent,
    type ReadContext,
    type WriteDestination,
} from '../domain/kernel/index.ts'
import {
    acceptDraftValidation,
    acceptDocumentSaveBundle,
    acceptEntryDraftSave,
    applyAiDraftSources,
    applyDocumentDraftToSnapshot,
    applyVisualDraftSources,
    canUseVisualDraft,
    createDocumentDraft,
    discardEntryDraft,
    editDocumentDraftSource,
    isDocumentDraftDirty,
    markDraftBundleSaving,
    markDraftValidating,
    redoEntryDraft,
    redoProjectDraft,
    scopeValidationSignature,
    sourceDraftView,
    syncDocumentDraft,
    undoEntryDraft,
    undoProjectDraft,
    type DocumentDraftModel,
    type DocumentHistoryOptions,
} from './documentDraftModel.ts'
import {
    createDocumentKernelDraftRuntime,
    requireKernelComponentHandle,
    type KernelComponentBindings,
} from './documentKernelDraftRuntime.ts'

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const ROOT_ID = '22222222-2222-4222-8222-222222222222'
const PARAGRAPH_ID = '33333333-3333-4333-8333-333333333333'
const HOST_ALLOCATED_ID = '44444444-4444-4444-8444-444444444444'
const UNALLOCATED_ID = '55555555-5555-4555-8555-555555555555'
let testRequestSequence = 0

function snapshot(revision = 7, projectRevision = 2): EntrySourceSnapshot {
    const articleHtml = `<template data-fc-entry-patch data-fc-document-version="1" data-fc-entry-id="${ENTRY_ID}" data-fc-base-template-version="1"><template data-fc-fill="entry-body"><div data-fc-node-id="${ROOT_ID}" data-fc-node-kind="container"><p data-fc-node-id="${PARAGRAPH_ID}" data-fc-node-kind="paragraph">原文</p></div></template></template>`
    return {
        project: {
            projectRevision,
            templateVersion: 1,
            hashes: {article: 'a'.repeat(64), style: 'b'.repeat(64)},
            defaultArticleHtml:
                '<!doctype html><html data-fc-document-version="1" data-fc-template-version="1"><head></head><body><main data-fc-slot="entry-root"><div data-fc-slot="entry-body"></div></main></body></html>',
            defaultStyleCss:
                '@layer fc-renderer, fc-project, fc-entry, fc-node; @layer fc-project { :root { --fc-entry-gap: 12px; } }',
            diagnostics: [],
            sourceStatus: 'ready',
        },
        entry: {id: ENTRY_ID, title: '测试', summary: '', tags: []},
        documentVersion: 1,
        baseTemplateVersion: 1,
        revision,
        hashes: {article: 'c'.repeat(64), style: 'd'.repeat(64)},
        articleHtml,
        styleCss: `@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] {} } @layer fc-node {}`,
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

type TestKernelOperation =
    | {
          readonly op: 'replaceNodeText'
          readonly nodeId: string
          readonly expected: string
          readonly text: string
      }
    | {
          readonly op: 'setNodeStyles'
          readonly nodeId: string
          readonly styles: Readonly<Record<string, string | null>>
      }
    | {
          readonly op: 'setNodeResponsiveStyles'
          readonly nodeId: string
          readonly mobileStyles: Readonly<Record<string, string | null>>
          readonly desktopStyles: Readonly<Record<string, string | null>>
      }
    | {
          readonly op: 'setNodeConditionalStyles'
          readonly nodeId: string
          readonly context: 'desktop'
          readonly styles: Readonly<Record<string, string | null>>
      }
    | {
          readonly op: 'formatTextRanges'
          readonly nodeId: string
          readonly ranges: readonly {
              readonly from: number
              readonly to: number
              readonly expected: string
              readonly styles: Readonly<Record<string, string | null>>
          }[]
      }

const BASE_READ_CONTEXT: ReadContext = Object.freeze({
    viewport: 'mobile',
    interactions: Object.freeze({hover: false, focusWithin: false}),
    direction: 'unknown',
    writingMode: 'unknown',
})

function styleDestination(context: 'mobile' | 'desktop'): WriteDestination {
    return Object.freeze({
        scope: 'entry',
        channel:
            context === 'mobile'
                ? Object.freeze({kind: 'base-rule' as const})
                : Object.freeze({kind: 'conditional-rule' as const, context}),
    })
}

function inlineDestination(): WriteDestination {
    return Object.freeze({scope: 'entry', channel: Object.freeze({kind: 'inline' as const})})
}

function styleIntents(
    handles: KernelComponentBindings,
    nodeId: string,
    styles: Readonly<Record<string, string | null>>,
    target: 'component' | {readonly from: number; readonly to: number; readonly expected: string},
    destination: WriteDestination,
): readonly EditIntent[] {
    const component = requireKernelComponentHandle(handles, nodeId)
    const viewport: ReadContext['viewport'] =
        destination.channel.kind === 'conditional-rule' &&
        ['mobile', 'desktop'].includes(destination.channel.context)
            ? (destination.channel.context as ReadContext['viewport'])
            : 'mobile'
    const readContext = Object.freeze({
        ...BASE_READ_CONTEXT,
        viewport,
    })
    return Object.entries(styles).map(([property, value]) =>
        Object.freeze({
            kind: 'edit-property' as const,
            target:
                target === 'component'
                    ? Object.freeze({kind: 'component-root' as const, component})
                    : Object.freeze({
                          kind: 'text-range' as const,
                          component,
                          range: utf16Range(target.from, target.to),
                          expected: target.expected,
                      }),
            property,
            action:
                value === null
                    ? Object.freeze({kind: 'clear-override' as const})
                    : Object.freeze({kind: 'set-value' as const, value}),
            readContext,
            destination,
        }),
    )
}

function operationIntents(
    handles: KernelComponentBindings,
    operation: TestKernelOperation,
): readonly EditIntent[] {
    if (operation.op === 'replaceNodeText') {
        return [
            Object.freeze({
                kind: 'replace-text' as const,
                target: Object.freeze({
                    kind: 'text-range' as const,
                    component: requireKernelComponentHandle(handles, operation.nodeId),
                    range: utf16Range(0, operation.expected.length),
                    expected: operation.expected,
                }),
                coordinateSpace: 'current-candidate' as const,
                text: operation.text,
            }),
        ]
    }
    if (operation.op === 'setNodeStyles') {
        return styleIntents(
            handles,
            operation.nodeId,
            operation.styles,
            'component',
            inlineDestination(),
        )
    }
    if (operation.op === 'setNodeResponsiveStyles') {
        return [
            ...styleIntents(
                handles,
                operation.nodeId,
                operation.mobileStyles,
                'component',
                styleDestination('mobile'),
            ),
            ...styleIntents(
                handles,
                operation.nodeId,
                operation.desktopStyles,
                'component',
                styleDestination('desktop'),
            ),
        ]
    }
    if (operation.op === 'setNodeConditionalStyles') {
        return styleIntents(
            handles,
            operation.nodeId,
            operation.styles,
            'component',
            styleDestination(operation.context),
        )
    }
    return operation.ranges.flatMap(range =>
        styleIntents(handles, operation.nodeId, range.styles, range, inlineDestination()),
    )
}

/** 用真实 DocumentKernel 生成候选，草稿接纳、历史和撤销不再经过旧操作引擎。 */
function applyEntryCandidateForTest(
    model: DocumentDraftModel,
    operations: readonly TestKernelOperation[],
    label: string,
    options: DocumentHistoryOptions = {},
) {
    const runtime = createDocumentKernelDraftRuntime()
    const nodeIds = [...new Set(operations.map(operation => operation.nodeId))]
    testRequestSequence += 1
    const requestId = `draft-model-test:${testRequestSequence}`
    const update = runtime.apply(
        model,
        {
            ...snapshot(model.entry.baseRevision, model.project.baseRevision),
            project: {
                ...snapshot().project,
                projectRevision: model.project.baseRevision,
                defaultArticleHtml: model.project.sources['article.html'],
                defaultStyleCss: model.project.sources['style.css'],
            },
        },
        {
            nodeIds,
            idempotencyKey: idempotencyKey(requestId),
            interactionId: interactionId(`draft-model-test:${options.historyGroupId ?? requestId}`),
            authorizedScopes: ['entry'],
            createIntents: handles =>
                operations.flatMap(operation => operationIntents(handles, operation)),
        },
        label,
        options,
    )
    return update
}

function readEffectiveStyleForTest(
    model: DocumentDraftModel,
    nodeId: string,
    property: string,
    viewport: 'mobile' | 'desktop',
): string | null {
    const result = createDocumentKernelDraftRuntime().inspectComponent(model, snapshot(), {
        nodeId,
        properties: [property],
        context: Object.freeze({...BASE_READ_CONTEXT, viewport}),
    })
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') return null
    const value = result.inspection.properties[property]?.effectiveValue
    return value?.resolvedValue ?? value?.rawValue ?? null
}

describe('document draft model', () => {
    it('AI 候选新增节点时由宿主分配身份并沿真实草稿入口接纳', () => {
        const initial = createDocumentDraft(snapshot())
        const candidate = {
            ...initial.entry.sources,
            'article.html': initial.entry.sources['article.html'].replace(
                '</div></template></template>',
                '<p data-fc-node-kind="paragraph">AI 新段落</p></div></template></template>',
            ),
        }
        const update = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: candidate,
                projectSources: initial.project.sources,
                diagnostics: [],
            },
            'AI：新增段落',
            {allocateNodeId: () => HOST_ALLOCATED_ID},
        )
        assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
        assert.match(
            update.model.entry.sources['article.html'],
            new RegExp(
                `<p data-fc-node-kind="paragraph" data-fc-node-id="${HOST_ALLOCATED_ID}">AI 新段落</p>`,
                'u',
            ),
        )
    })

    it('AI 候选携带未由宿主分配的新身份时沿真实草稿入口拒绝', () => {
        const initial = createDocumentDraft(snapshot())
        const candidate = {
            ...initial.entry.sources,
            'article.html': initial.entry.sources['article.html'].replace(
                '</div></template></template>',
                `<p data-fc-node-id="${UNALLOCATED_ID}" data-fc-node-kind="paragraph">AI 新段落</p></div></template></template>`,
            ),
        }
        const update = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: candidate,
                projectSources: initial.project.sources,
                diagnostics: [],
            },
            'AI：拒绝未登记身份',
            {allocateNodeId: () => HOST_ALLOCATED_ID},
        )
        assert.equal(update.applied, false)
        assert.equal(update.diagnostics[0]?.code, 'ai-candidate-node-id-not-host-allocated')
        assert.equal(update.model, initial)
    })

    it('AI 候选保留未改动节点身份时沿真实草稿入口接纳', () => {
        const initial = createDocumentDraft(snapshot())
        const candidate = {
            ...initial.entry.sources,
            'article.html': initial.entry.sources['article.html'].replace('原文', 'AI 改写正文'),
        }
        const update = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: candidate,
                projectSources: initial.project.sources,
                diagnostics: [],
            },
            'AI：保留段落身份',
            {allocateNodeId: () => HOST_ALLOCATED_ID},
        )
        assert.equal(update.applied, true, JSON.stringify(update.diagnostics))
        assert.match(update.model.entry.sources['article.html'], new RegExp(PARAGRAPH_ID, 'u'))
    })

    it('AI 候选沿真实草稿入口拒绝复用既有节点身份的不同种类', () => {
        const initial = createDocumentDraft(snapshot())
        const candidate = {
            ...initial.entry.sources,
            'article.html': initial.entry.sources['article.html'].replace(
                'data-fc-node-kind="paragraph"',
                'data-fc-node-kind="heading"',
            ),
        }
        const update = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: candidate,
                projectSources: initial.project.sources,
                diagnostics: [],
            },
            'AI：改写节点种类',
        )
        assert.equal(update.applied, false)
        assert.equal(update.diagnostics[0]?.code, 'ai-candidate-node-kind-mismatch')
        assert.equal(update.model, initial)
    })

    it('AI 分段 CSS 与人工布局、字符编辑交替五轮，撤销重做始终回到各自真值', () => {
        let model = createDocumentDraft(snapshot())
        const selector = `[data-fc-node-id="${ROOT_ID}"][data-fc-node-kind="container"]`
        for (let round = 0; round < 5; round += 1) {
            const expectedEntrySources = model.entry.sources
            const expectedProjectSources = model.project.sources
            const aiEntrySources = {
                ...expectedEntrySources,
                'article.html': expectedEntrySources['article.html'].replace(
                    '原文',
                    '<span style="FONT-SIZE: 2em;">原</span><a href="https://example.com">文</a>',
                ),
                'style.css': `${expectedEntrySources['style.css']}\n@layer fc-node { ${selector} { display: grid; gap: ${round + 1}rem; } }
@layer fc-node { @media (min-width: 48rem) { ${selector} { gap: ${round + 2}rem; } } }`,
            }
            const ai = applyAiDraftSources(
                model,
                {
                    expectedEntrySources,
                    expectedProjectSources,
                    entrySources: aiEntrySources,
                    projectSources: expectedProjectSources,
                    diagnostics: [],
                },
                'AI 修改',
            )
            assert.equal(ai.applied, true)
            model = ai.model
            const beforeVisual = model.entry.sources
            const edited = applyEntryCandidateForTest(
                model,
                [
                    {
                        op: 'setNodeResponsiveStyles',
                        nodeId: ROOT_ID,
                        mobileStyles: {gap: '12px'},
                        desktopStyles: {gap: '20px'},
                    },
                    {
                        op: 'formatTextRanges',
                        nodeId: PARAGRAPH_ID,
                        ranges: [{from: 0, to: 1, expected: '原', styles: {'font-weight': '700'}}],
                    },
                ],
                '可视重编辑',
            )
            assert.equal(
                edited.applied,
                true,
                JSON.stringify({round, diagnostics: edited.diagnostics}),
            )
            assert.deepEqual(edited.diagnostics, [])
            model = edited.model
            assert.equal(readEffectiveStyleForTest(model, ROOT_ID, 'gap', 'mobile'), '12px')
            assert.equal(readEffectiveStyleForTest(model, ROOT_ID, 'gap', 'desktop'), '20px')
            assert.match(model.entry.sources['article.html'], /font-size: 2em;/iu)
            assert.match(model.entry.sources['article.html'], /font-weight: 700;/u)
            assert.match(
                model.entry.sources['article.html'],
                /<a href="https:\/\/example.com">文<\/a>/u,
            )
            const afterVisual = model.entry.sources
            model = undoEntryDraft(model).model
            assert.deepEqual(model.entry.sources, beforeVisual)
            model = redoEntryDraft(model).model
            assert.deepEqual(model.entry.sources, afterVisual)
        }
    })

    it('历史只保存内核交付的源码快照，并从最近一次源码编辑起点撤销', () => {
        let model = createDocumentDraft(snapshot())
        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '第一版',
                },
            ],
            '改正文',
        ).model
        assert.equal(model.entry.undo.length, 1)
        assert.deepEqual(Object.keys(model.entry.undo[0]).sort(), [
            'diagnostics',
            'label',
            'sources',
        ])

        model = editDocumentDraftSource(
            model,
            'entry',
            'style.css',
            `${model.entry.sources['style.css']}\n@layer fc-entry { [data-fc-entry-id="${ENTRY_ID}"] { opacity: .8; } }`,
        )
        assert.equal(model.entry.undo.length, 0)
        assert.match(model.entry.historyBaseSources['article.html'], /第一版/u)
        assert.match(model.entry.historyBaseSources['style.css'], /opacity: \.8/u)

        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'setNodeStyles',
                    nodeId: PARAGRAPH_ID,
                    styles: {color: '#334455'},
                },
            ],
            '改颜色',
        ).model
        model = undoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /第一版/u)
        assert.doesNotMatch(model.entry.sources['article.html'], /color: #334455/u)
        assert.match(model.entry.sources['style.css'], /opacity: \.8/u)
        model = redoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /color: #334455/u)
    })

    it('同一次连续交互合并为一步历史，撤销和重做只跨越交互边界', () => {
        const initial = createDocumentDraft(snapshot())
        const first = applyEntryCandidateForTest(
            initial,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '第一候选',
                },
            ],
            '连续修改正文',
            {historyGroupId: 'numeric-1'},
        ).model
        const final = applyEntryCandidateForTest(
            first,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '第一候选',
                    text: '最终候选',
                },
            ],
            '连续修改正文',
            {historyGroupId: 'numeric-1'},
        ).model

        assert.equal(final.entry.undo.length, 1)
        assert.match(final.entry.sources['article.html'], /最终候选/u)
        const undone = undoEntryDraft(final).model
        assert.deepEqual(undone.entry.sources, initial.entry.sources)
        const redone = redoEntryDraft(undone).model
        assert.deepEqual(redone.entry.sources, final.entry.sources)
    })

    it('历史超过上限时推进撤销基线而不跳过最早保留的修改', () => {
        const initial = createDocumentDraft(snapshot())
        let model = initial
        for (let index = 1; index <= 51; index += 1) {
            const nextSources = {
                ...model.entry.sources,
                'article.html': model.entry.sources['article.html'].replace(
                    index === 1 ? '原文' : `第 ${index - 1} 次`,
                    `第 ${index} 次`,
                ),
            }
            model = applyVisualDraftSources(
                model,
                {
                    expectedEntrySources: model.entry.sources,
                    expectedProjectSources: model.project.sources,
                    entrySources: nextSources,
                    projectSources: model.project.sources,
                    diagnostics: [],
                },
                `第 ${index} 次修改`,
            ).model
        }

        assert.equal(model.entry.undo.length, 50)
        assert.match(model.entry.historyBaseSources['article.html'], /第 1 次/u)
        for (let index = 0; index < 50; index += 1) model = undoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /第 1 次/u)
        assert.doesNotMatch(model.entry.sources['article.html'], /原文/u)

        model = redoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /第 2 次/u)
    })

    it('单侧历史淘汰关联事务时同步推进另一侧基线', () => {
        const initial = createDocumentDraft(snapshot())
        let model = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...initial.entry.sources,
                    'article.html': initial.entry.sources['article.html'].replace(
                        '原文',
                        'AI 修改',
                    ),
                },
                projectSources: {
                    ...initial.project.sources,
                    'style.css': initial.project.sources['style.css'].replace('12px', '16px'),
                },
                diagnostics: [],
            },
            'AI：调整正文与项目间距',
        ).model

        for (let index = 1; index <= 50; index += 1) {
            model = applyVisualDraftSources(
                model,
                {
                    expectedEntrySources: model.entry.sources,
                    expectedProjectSources: model.project.sources,
                    entrySources: {
                        ...model.entry.sources,
                        'style.css': `${model.entry.sources['style.css']}\n.step-${index} {}`,
                    },
                    projectSources: model.project.sources,
                    diagnostics: [],
                },
                `第 ${index} 次词条修改`,
            ).model
        }

        assert.equal(model.entry.undo.length, 50)
        assert.equal(model.project.undo.length, 0)
        assert.match(model.entry.historyBaseSources['article.html'], /AI 修改/u)
        assert.match(model.project.historyBaseSources['style.css'], /16px/u)
        for (let index = 0; index < 50; index += 1) model = undoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /AI 修改/u)
        assert.match(model.project.sources['style.css'], /16px/u)
        const projectUndo = undoProjectDraft(model)
        assert.equal(projectUndo.applied, false)
        assert.equal(
            projectUndo.diagnostics.some(item => item.code === 'linked_history_order_conflict'),
            false,
        )
    })

    it('撤销到直接源码起点时恢复该版源码的校验诊断', () => {
        let model = createDocumentDraft(snapshot())
        model = editDocumentDraftSource(
            model,
            'entry',
            'article.html',
            model.entry.sources['article.html'].replace('原文', '源码版'),
        )
        const sourceDiagnostics = [
            {
                severity: 'warning' as const,
                category: 'capability' as const,
                code: 'source-warning',
                message: '源码保留了自定义结构。',
            },
        ]
        model = acceptDraftValidation(model, 'entry', true, sourceDiagnostics)
        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '源码版',
                    text: '内核版',
                },
            ],
            '内核修改',
        ).model

        const undone = undoEntryDraft(model).model
        assert.match(undone.entry.sources['article.html'], /源码版/u)
        assert.deepEqual(undone.entry.diagnostics, sourceDiagnostics)
        const redone = redoEntryDraft(undone).model
        assert.match(redone.entry.sources['article.html'], /内核版/u)
        assert.deepEqual(redone.entry.diagnostics, [])
    })

    it('连续交互回到起点时不留下空撤销步骤', () => {
        const initial = createDocumentDraft(snapshot())
        const changed = applyEntryCandidateForTest(
            initial,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '临时候选',
                },
            ],
            '连续修改正文',
            {historyGroupId: 'numeric-escape'},
        ).model
        const cancelled = applyEntryCandidateForTest(
            changed,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '临时候选',
                    text: '原文',
                },
            ],
            '连续修改正文',
            {historyGroupId: 'numeric-escape'},
        ).model

        assert.deepEqual(cancelled.entry.sources, initial.entry.sources)
        assert.equal(cancelled.entry.undo.length, 0)
        assert.equal(isDocumentDraftDirty(cancelled), false)
    })

    it('源码重写路径也按交互身份合并，新的交互保持独立历史', () => {
        let model = createDocumentDraft(snapshot())
        const initialSources = model.entry.sources
        for (const [value, group] of [
            ['.5', 'opacity-1'],
            ['.6', 'opacity-1'],
            ['.7', 'opacity-2'],
        ] as const) {
            const nextSources = {
                ...model.entry.sources,
                'style.css': model.entry.sources['style.css'].replace(
                    /(?:\n\.preview \{ opacity: [^}]+ \})?$/u,
                    `\n.preview { opacity: ${value}; }`,
                ),
            }
            model = applyVisualDraftSources(
                model,
                {
                    expectedEntrySources: model.entry.sources,
                    expectedProjectSources: model.project.sources,
                    entrySources: nextSources,
                    projectSources: model.project.sources,
                    diagnostics: [],
                },
                '修改透明度',
                {historyGroupId: group},
            ).model
        }

        assert.equal(model.entry.undo.length, 2)
        assert.match(model.entry.sources['style.css'], /opacity: \.7/u)
        const once = undoEntryDraft(model).model
        assert.match(once.entry.sources['style.css'], /opacity: \.6/u)
        const twice = undoEntryDraft(once).model
        assert.deepEqual(twice.entry.sources, initialSources)
    })

    it('源码与可视操作读写同一候选，合法未保存源码可直接进入可视模式', () => {
        let model = createDocumentDraft(snapshot())
        model = editDocumentDraftSource(
            model,
            'entry',
            'article.html',
            model.entry.sources['article.html'].replace('原文', '源码版'),
        )
        assert.equal(canUseVisualDraft(model), false)
        model = acceptDraftValidation(model, 'entry', true, [])
        assert.equal(canUseVisualDraft(model), true)

        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '源码版',
                    text: '可视版',
                },
            ],
            '可视继续编辑',
        ).model
        const sourceView = sourceDraftView(model, 'entry', 'article.html')
        const projected = applyDocumentDraftToSnapshot(snapshot(), model)
        assert.match(sourceView.sources['article.html'], /可视版/u)
        assert.equal(projected.articleHtml, sourceView.sources['article.html'])
        assert.equal(isDocumentDraftDirty(model), true)
    })

    it('项目与词条草稿可同时保留，不再因切换源码作用域而互斥', () => {
        let model = createDocumentDraft(snapshot())
        model = editDocumentDraftSource(
            model,
            'entry',
            'style.css',
            `${model.entry.sources['style.css']}\n.entry {}`,
        )
        model = editDocumentDraftSource(
            model,
            'project',
            'style.css',
            `${model.project.sources['style.css']}\n.project {}`,
        )

        assert.match(sourceDraftView(model, 'entry', 'style.css').sources['style.css'], /\.entry/u)
        assert.match(
            sourceDraftView(model, 'project', 'style.css').sources['style.css'],
            /\.project/u,
        )
        assert.equal(model.entry.baseRevision, 7)
        assert.equal(model.project.baseRevision, 2)
    })

    it('无效源码恢复为保存基线时同步恢复校验状态和可视入口', () => {
        let model = createDocumentDraft(snapshot())
        const base = model.entry.sources['article.html']
        model = editDocumentDraftSource(model, 'entry', 'article.html', '<template')
        model = acceptDraftValidation(model, 'entry', false, [
            {
                severity: 'error',
                category: 'capability',
                code: 'html_eof',
                message: 'HTML 未闭合。',
            },
        ])
        assert.equal(canUseVisualDraft(model), false)

        model = editDocumentDraftSource(model, 'entry', 'article.html', base)
        assert.equal(model.entry.validationPhase, 'valid')
        assert.deepEqual(model.entry.diagnostics, [])
        assert.equal(canUseVisualDraft(model), true)
    })

    it('无效源码可以继续编辑为另一份合法草稿而不丢失用户输入', () => {
        let model = createDocumentDraft(snapshot())
        const repaired = model.entry.sources['article.html'].replace('原文', '修复后的正文')
        model = editDocumentDraftSource(model, 'entry', 'article.html', '<template')
        model = acceptDraftValidation(model, 'entry', false, [
            {
                severity: 'error',
                category: 'capability',
                code: 'html_eof',
                message: 'HTML 未闭合。',
            },
        ])

        model = editDocumentDraftSource(model, 'entry', 'article.html', repaired)
        assert.equal(model.entry.validationPhase, 'pending')
        assert.equal(canUseVisualDraft(model), false)
        assert.match(model.entry.sources['article.html'], /修复后的正文/u)

        model = acceptDraftValidation(model, 'entry', true, [])
        assert.equal(model.entry.validationPhase, 'valid')
        assert.equal(canUseVisualDraft(model), true)
        assert.match(model.entry.sources['article.html'], /修复后的正文/u)
        assert.equal(model.entry.undo.length, 0)
    })

    it('无源码变化的内核候选不制造待校验状态或历史记录', () => {
        const initial = createDocumentDraft(snapshot())
        const update = applyEntryCandidateForTest(
            initial,
            [
                {
                    op: 'setNodeStyles',
                    nodeId: PARAGRAPH_ID,
                    styles: {color: null},
                },
            ],
            '重复保存现有外观',
        )

        assert.equal(update.applied, true)
        assert.equal(update.model, initial)
        assert.equal(update.model.entry.validationPhase, 'valid')
        assert.equal(update.model.entry.undo.length, 0)
        assert.equal(update.model.changeVersion, 0)
        assert.equal(canUseVisualDraft(update.model), true)
    })

    it('内核生成的受控布局候选保持已验证状态，只有直接源码输入进入异步校验', () => {
        const initial = createDocumentDraft(snapshot())
        const update = applyEntryCandidateForTest(
            initial,
            [
                {
                    op: 'setNodeConditionalStyles',
                    nodeId: ROOT_ID,
                    context: 'desktop',
                    styles: {
                        display: 'grid',
                        'grid-template-columns': 'minmax(0, 2fr) minmax(0, 1fr)',
                    },
                },
            ],
            '切换桌面布局',
        )

        assert.equal(update.applied, true)
        assert.equal(update.model.entry.validationPhase, 'valid')
        assert.equal(scopeValidationSignature(update.model, 'entry'), null)
        assert.equal(canUseVisualDraft(update.model), true)

        const sourceEdited = editDocumentDraftSource(
            update.model,
            'entry',
            'style.css',
            `${update.model.entry.sources['style.css']}\n/* coding */`,
        )
        assert.equal(sourceEdited.entry.validationPhase, 'pending')
        const validationSignature = scopeValidationSignature(sourceEdited, 'entry')
        assert.notEqual(validationSignature, null)
        assert.equal(
            scopeValidationSignature(markDraftValidating(sourceEdited, 'entry'), 'entry'),
            validationSignature,
        )
        assert.equal(canUseVisualDraft(sourceEdited), false)
    })

    it('撤销回保存基线时直接恢复基线校验结果', () => {
        let model = createDocumentDraft(snapshot())
        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '临时修改',
                },
            ],
            '临时修改正文',
        ).model
        model = acceptDraftValidation(model, 'entry', true, [])
        model = undoEntryDraft(model).model

        assert.equal(isDocumentDraftDirty(model), false)
        assert.equal(model.entry.validationPhase, 'valid')
        assert.equal(canUseVisualDraft(model), true)
    })

    it('外部 revision 只刷新干净作用域，脏作用域保留统一草稿并进入冲突', () => {
        const initial = createDocumentDraft(snapshot())
        const clean = syncDocumentDraft(initial, snapshot(8, 3))
        assert.equal(clean.entry.baseRevision, 8)
        assert.equal(clean.project.baseRevision, 3)

        const dirty = editDocumentDraftSource(
            initial,
            'entry',
            'article.html',
            initial.entry.sources['article.html'].replace('原文', '本地草稿'),
        )
        const conflicted = syncDocumentDraft(dirty, snapshot(8, 3))
        assert.equal(conflicted.entry.baseRevision, 7)
        assert.equal(conflicted.entry.conflict?.revision, 8)
        assert.match(conflicted.entry.sources['article.html'], /本地草稿/u)
        assert.equal(conflicted.project.baseRevision, 3)
    })

    it('保存成功以服务端响应为新基线并同时清空 dirty 与源码历史', () => {
        let model = createDocumentDraft(snapshot())
        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '已保存',
                },
            ],
            '改正文',
        ).model
        model = acceptEntryDraftSave(model, 8, model.entry.sources)

        assert.equal(model.entry.baseRevision, 8)
        assert.equal(model.entry.undo.length, 0)
        assert.equal(model.entry.redo.length, 0)
        assert.equal(isDocumentDraftDirty(model), false)
    })

    it('SaveBundle 同时接纳双作用域 revision、模板版本与保存基线', () => {
        let model = createDocumentDraft(snapshot())
        model = editDocumentDraftSource(
            model,
            'entry',
            'style.css',
            `${model.entry.sources['style.css']}\n.entry { color: red; }`,
        )
        model = editDocumentDraftSource(
            model,
            'project',
            'style.css',
            `${model.project.sources['style.css']}\n.project { color: blue; }`,
        )
        model = markDraftBundleSaving(model)
        assert.equal(model.entry.phase, 'saving')
        assert.equal(model.project.phase, 'saving')

        model = acceptDocumentSaveBundle(model, {
            projectRevision: 3,
            entryRevision: 8,
            templateVersion: 2,
            project: {
                dryRun: false,
                revision: 3,
                sources: model.project.sources,
                diagnostics: [],
                changedFiles: ['style.css'],
            },
            entry: {
                dryRun: false,
                revision: 8,
                sources: model.entry.sources,
                diagnostics: [],
                changedFiles: ['style.css'],
            },
        })
        assert.equal(model.project.baseRevision, 3)
        assert.equal(model.entry.baseRevision, 8)
        assert.equal(model.project.baseTemplateVersion, 2)
        assert.equal(model.entry.baseTemplateVersion, 2)
        assert.equal(model.project.undo.length, 0)
        assert.equal(model.entry.undo.length, 0)
        assert.equal(isDocumentDraftDirty(model), false)
    })

    it('AI 整份候选作为一个源码历史批次接入并可撤销重做', () => {
        let model = createDocumentDraft(snapshot())
        model = applyEntryCandidateForTest(
            model,
            [
                {
                    op: 'replaceNodeText',
                    nodeId: PARAGRAPH_ID,
                    expected: '原文',
                    text: '可视修改',
                },
            ],
            '可视修改',
        ).model
        const expectedEntrySources = model.entry.sources
        const expectedProjectSources = model.project.sources
        const aiEntrySources = {
            ...expectedEntrySources,
            'article.html': expectedEntrySources['article.html'].replace('可视修改', 'AI 修改'),
        }
        const aiProjectSources = {
            ...expectedProjectSources,
            'style.css': expectedProjectSources['style.css'].replace('12px', '16px'),
        }
        const update = applyAiDraftSources(
            model,
            {
                expectedEntrySources,
                expectedProjectSources,
                entrySources: aiEntrySources,
                projectSources: aiProjectSources,
                diagnostics: [],
            },
            'AI：调整正文与项目间距',
        )
        assert.equal(update.applied, true)
        model = update.model
        assert.match(model.entry.sources['article.html'], /AI 修改/u)
        assert.match(model.project.sources['style.css'], /16px/u)
        assert.deepEqual(Object.keys(model.entry.undo.at(-1) ?? {}).sort(), [
            'diagnostics',
            'label',
            'sources',
            'transactionId',
        ])
        assert.equal(
            model.entry.undo.at(-1)?.transactionId,
            model.project.undo.at(-1)?.transactionId,
        )

        model = undoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /可视修改/u)
        assert.doesNotMatch(model.entry.sources['article.html'], /AI 修改/u)
        assert.doesNotMatch(model.project.sources['style.css'], /16px/u)
        model = redoEntryDraft(model).model
        assert.match(model.entry.sources['article.html'], /AI 修改/u)
        assert.match(model.project.sources['style.css'], /16px/u)

        model = undoProjectDraft(model).model
        assert.match(model.entry.sources['article.html'], /可视修改/u)
        assert.doesNotMatch(model.project.sources['style.css'], /16px/u)
    })

    it('直接源码编辑会在两侧同时切断已有的关联历史', () => {
        const initial = createDocumentDraft(snapshot())
        const linked = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...initial.entry.sources,
                    'article.html': initial.entry.sources['article.html'].replace(
                        '原文',
                        'AI 修改',
                    ),
                },
                projectSources: {
                    ...initial.project.sources,
                    'style.css': initial.project.sources['style.css'].replace('12px', '16px'),
                },
                diagnostics: [],
            },
            'AI：调整正文与项目间距',
        ).model

        const edited = editDocumentDraftSource(
            linked,
            'entry',
            'article.html',
            linked.entry.sources['article.html'].replace('AI 修改', '人工源码修改'),
        )

        assert.equal(edited.entry.undo.length, 0)
        assert.equal(edited.project.undo.length, 0)
        assert.match(edited.project.sources['style.css'], /16px/u)
        const undo = undoProjectDraft(edited)
        assert.equal(undo.applied, false)
        assert.equal(
            undo.diagnostics.some(item => item.code === 'linked_history_order_conflict'),
            false,
        )
    })

    it('放弃单侧修改会保留另一侧当前源码并同时切断关联历史', () => {
        const initialSnapshot = snapshot()
        const initial = createDocumentDraft(initialSnapshot)
        const linked = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...initial.entry.sources,
                    'article.html': initial.entry.sources['article.html'].replace(
                        '原文',
                        'AI 修改',
                    ),
                },
                projectSources: {
                    ...initial.project.sources,
                    'style.css': initial.project.sources['style.css'].replace('12px', '16px'),
                },
                diagnostics: [],
            },
            'AI：调整正文与项目间距',
        ).model

        const discarded = discardEntryDraft(linked, initialSnapshot)

        assert.match(discarded.entry.sources['article.html'], /原文/u)
        assert.match(discarded.project.sources['style.css'], /16px/u)
        assert.equal(discarded.entry.undo.length, 0)
        assert.equal(discarded.project.undo.length, 0)
        assert.equal(undoProjectDraft(discarded).applied, false)
    })

    it('共同撤销后出现单侧新分支时会同时废弃两侧关联重做', () => {
        const initial = createDocumentDraft(snapshot())
        const linked = applyAiDraftSources(
            initial,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...initial.entry.sources,
                    'article.html': initial.entry.sources['article.html'].replace(
                        '原文',
                        'AI 修改',
                    ),
                },
                projectSources: {
                    ...initial.project.sources,
                    'style.css': initial.project.sources['style.css'].replace('12px', '16px'),
                },
                diagnostics: [],
            },
            'AI：调整正文与项目间距',
        ).model
        const undone = undoEntryDraft(linked).model

        const branched = applyVisualDraftSources(
            undone,
            {
                expectedEntrySources: undone.entry.sources,
                expectedProjectSources: undone.project.sources,
                entrySources: {
                    ...undone.entry.sources,
                    'article.html': undone.entry.sources['article.html'].replace(
                        '原文',
                        '人工修改',
                    ),
                },
                projectSources: undone.project.sources,
                diagnostics: [],
            },
            '人工修改正文',
        ).model

        assert.equal(branched.entry.redo.length, 0)
        assert.equal(branched.project.redo.length, 0)
        const redo = redoProjectDraft(branched)
        assert.equal(redo.applied, false)
        assert.equal(
            redo.diagnostics.some(item => item.code === 'linked_history_order_conflict'),
            false,
        )
        assert.match(branched.entry.sources['article.html'], /人工修改/u)
        assert.doesNotMatch(branched.project.sources['style.css'], /16px/u)
    })

    it('AI 响应不能覆盖请求期间出现的较新内存草稿', () => {
        const initial = createDocumentDraft(snapshot())
        const expectedEntrySources = initial.entry.sources
        const newer = editDocumentDraftSource(
            initial,
            'entry',
            'article.html',
            initial.entry.sources['article.html'].replace('原文', '用户较新输入'),
        )
        const update = applyAiDraftSources(
            newer,
            {
                expectedEntrySources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...expectedEntrySources,
                    'article.html': expectedEntrySources['article.html'].replace(
                        '原文',
                        'AI 旧响应',
                    ),
                },
                projectSources: initial.project.sources,
                diagnostics: [],
            },
            'AI：旧响应',
        )

        assert.equal(update.applied, false)
        assert.equal(update.diagnostics[0]?.code, 'ai_draft_changed')
        assert.match(update.model.entry.sources['article.html'], /用户较新输入/u)
    })

    it('AI 待确认候选只接受精确计划授权，授权后仍进入同一草稿历史', () => {
        const initial = createDocumentDraft(snapshot())
        const candidate = {
            ...initial.entry.sources,
            'article.html': initial.entry.sources['article.html'].replace('原文', '确认后正文'),
        }
        const decision = {
            planId: 'ai-plan:remove-paragraph',
            impacts: [
                {
                    code: 'component-content-removed',
                    message: '将删除段落及其正文。',
                    requiresDecision: true,
                },
            ],
        } as const
        const batch = {
            expectedEntrySources: initial.entry.sources,
            expectedProjectSources: initial.project.sources,
            entrySources: candidate,
            projectSources: initial.project.sources,
            diagnostics: [],
            decision,
        }

        const unconfirmed = applyAiDraftSources(initial, batch, 'AI：删除段落')
        assert.equal(unconfirmed.applied, false)
        assert.equal(unconfirmed.diagnostics[0]?.code, 'ai_edit_decision_required')
        assert.equal(unconfirmed.model, initial)

        const wrongPlan = applyAiDraftSources(
            initial,
            {...batch, decision: {...decision, confirmedPlanId: 'ai-plan:other'}},
            'AI：删除段落',
        )
        assert.equal(wrongPlan.applied, false)
        assert.equal(wrongPlan.diagnostics[0]?.code, 'ai_edit_decision_required')

        const confirmed = applyAiDraftSources(
            initial,
            {...batch, decision: {...decision, confirmedPlanId: decision.planId}},
            'AI：删除段落',
        )
        assert.equal(confirmed.applied, true)
        assert.match(confirmed.model.entry.sources['article.html'], /确认后正文/u)
        assert.equal(confirmed.model.entry.undo.length, 1)
    })

    it('AI 确认期间草稿变化会使已授权计划过期', () => {
        const initial = createDocumentDraft(snapshot())
        const newer = editDocumentDraftSource(
            initial,
            'entry',
            'article.html',
            initial.entry.sources['article.html'].replace('原文', '确认期间的新输入'),
        )
        const update = applyAiDraftSources(
            newer,
            {
                expectedEntrySources: initial.entry.sources,
                expectedProjectSources: initial.project.sources,
                entrySources: {
                    ...initial.entry.sources,
                    'article.html': initial.entry.sources['article.html'].replace(
                        '原文',
                        '过期待确认结果',
                    ),
                },
                projectSources: initial.project.sources,
                diagnostics: [],
                decision: {
                    planId: 'ai-plan:stale',
                    confirmedPlanId: 'ai-plan:stale',
                    impacts: [
                        {
                            code: 'component-content-removed',
                            message: '将删除正文。',
                            requiresDecision: true,
                        },
                    ],
                },
            },
            'AI：删除正文',
        )

        assert.equal(update.applied, false)
        assert.equal(update.diagnostics[0]?.code, 'ai_draft_changed')
        assert.match(update.model.entry.sources['article.html'], /确认期间的新输入/u)
    })

    it('AI 把脏草稿恢复到保存基线时不留下孤立的待校验状态', () => {
        const initial = createDocumentDraft(snapshot())
        let dirty = editDocumentDraftSource(
            initial,
            'entry',
            'article.html',
            initial.entry.sources['article.html'].replace('原文', '临时正文'),
        )
        dirty = acceptDraftValidation(dirty, 'entry', true, [])

        const update = applyAiDraftSources(
            dirty,
            {
                expectedEntrySources: dirty.entry.sources,
                expectedProjectSources: dirty.project.sources,
                entrySources: initial.entry.sources,
                projectSources: dirty.project.sources,
                diagnostics: [],
            },
            'AI：恢复保存基线',
        )

        assert.equal(update.applied, true)
        assert.equal(isDocumentDraftDirty(update.model), false)
        assert.equal(update.model.entry.validationPhase, 'valid')
        assert.equal(canUseVisualDraft(update.model), true)
    })
})
