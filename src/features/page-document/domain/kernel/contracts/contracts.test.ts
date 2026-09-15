// 本模块验证内核身份、源码键、坐标与快照的运行时边界，避免仅靠 TypeScript 假定外部输入可信。

import {describe, it} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {
    ENTRY_DESKTOP_MEDIA_QUERY,
    MANAGED_NODE_STYLE_CONTEXTS,
    analysisStampId,
    componentHandleId,
    idempotencyKey,
    interactionId,
    nodeId,
    parseReadContext,
    parseComponentHandle,
    parseEditBatch,
    parseSourceKey,
    parseSourceSnapshot,
    previewVersion,
    snapshotId,
    sourceKeyString,
    utf16Range,
    utf16RangeFromUtf8ByteRange,
    utf8Range,
} from './index.ts'

describe('document kernel contracts', () => {
    it('用 v3 证据冻结两档视口与保留的交互上下文', () => {
        const fixture = JSON.parse(
            readFileSync(
                new URL(
                    '../../../../../../tests/fixtures/page-document/v3/managed-style-contexts.json',
                    import.meta.url,
                ),
                'utf8',
            ),
        ) as {
            contractVersion: number
            managedStyleContexts: readonly string[]
            responsiveViewports: readonly string[]
            desktopMedia: string
            rejectedLegacyContexts: readonly string[]
        }

        assert.equal(fixture.contractVersion, 3)
        assert.deepEqual(fixture.managedStyleContexts, MANAGED_NODE_STYLE_CONTEXTS)
        assert.deepEqual(fixture.responsiveViewports, ['mobile', 'desktop'])
        assert.equal(fixture.desktopMedia, ENTRY_DESKTOP_MEDIA_QUERY)
        assert.deepEqual(fixture.rejectedLegacyContexts, ['tablet', 'wide'])
    })

    it('keeps identity kinds distinct while validating external values', () => {
        assert.equal(
            nodeId('11111111-1111-4111-8111-111111111111'),
            '11111111-1111-4111-8111-111111111111',
        )
        assert.equal(componentHandleId('handle:1'), 'handle:1')
        assert.equal(snapshotId('snapshot:1'), 'snapshot:1')
        assert.equal(analysisStampId('analysis:1'), 'analysis:1')
        assert.equal(previewVersion('preview:1'), 'preview:1')
        assert.equal(interactionId('interaction:1'), 'interaction:1')
        assert.equal(idempotencyKey('request:1'), 'request:1')
        assert.throws(() => nodeId('paragraph-1'), /UUID/u)
        assert.throws(() => snapshotId(''), /不透明标识/u)
    })

    it('keeps source scope in the source identity', () => {
        const project = parseSourceKey({scope: 'project', file: 'style.css'})
        const entry = parseSourceKey({scope: 'entry', file: 'style.css'})
        assert.equal(sourceKeyString(project), 'project:style.css')
        assert.equal(sourceKeyString(entry), 'entry:style.css')
        assert.notDeepEqual(project, entry)
        assert.throws(
            () => parseSourceKey({scope: 'entry', file: 'project-style.css'}),
            /逻辑文件/u,
        )
    })

    it('rejects mixed coordinate units and invalid ranges at runtime', () => {
        assert.deepEqual(utf16Range(1, 3), {unit: 'utf16-code-unit', from: 1, to: 3})
        assert.deepEqual(utf8Range(1, 4), {unit: 'utf8-byte', from: 1, to: 4})
        assert.throws(() => utf16Range(3, 2), /有序/u)
        assert.throws(() => utf8Range(0.5, 2), /安全整数/u)
        assert.deepEqual(utf16RangeFromUtf8ByteRange('甲😀乙', utf8Range(3, 7)), {
            unit: 'utf16-code-unit',
            from: 1,
            to: 3,
        })
        assert.equal(utf16RangeFromUtf8ByteRange('甲', utf8Range(1, 2)), null)
    })

    it('把同一起始快照上的多作用域源码 edit 冻结为单一原子意图', () => {
        const batch = parseEditBatch({
            baseAnalysis: 'analysis:source-edits',
            idempotencyKey: 'request:source-edits',
            interactionId: null,
            authorizedScopes: ['project', 'entry'],
            intents: [
                {
                    kind: 'apply-source-edits',
                    componentStructure: 'preserve-managed-components',
                    edits: [
                        {
                            source: {scope: 'entry', file: 'article.html'},
                            range: {unit: 'utf8-byte', from: 3, to: 6},
                            expected: '甲',
                            insert: '乙',
                        },
                        {
                            source: {scope: 'project', file: 'style.css'},
                            range: {unit: 'utf8-byte', from: 0, to: 0},
                            expected: '',
                            insert: '/* theme */',
                        },
                    ],
                },
            ],
        })

        assert.equal(batch.intents[0]?.kind, 'apply-source-edits')
        assert.equal(
            batch.intents[0]?.kind === 'apply-source-edits' && batch.intents[0].componentStructure,
            'preserve-managed-components',
        )
        assert.equal(Object.isFrozen(batch.intents[0]), true)
        assert.equal(
            batch.intents[0]?.kind === 'apply-source-edits' &&
                Object.isFrozen(batch.intents[0].edits),
            true,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    baseAnalysis: 'analysis:source-edits',
                    idempotencyKey: 'request:source-edits:missing-structure',
                    interactionId: null,
                    authorizedScopes: ['entry'],
                    intents: [
                        {
                            kind: 'apply-source-edits',
                            edits: [
                                {
                                    source: {scope: 'entry', file: 'style.css'},
                                    range: {unit: 'utf8-byte', from: 0, to: 0},
                                    expected: '',
                                    insert: '/* note */',
                                },
                            ],
                        },
                    ],
                }),
            /componentStructure/u,
        )
    })

    it('validates immutable snapshots and rejects duplicate scoped files', () => {
        const value = parseSourceSnapshot({
            id: 'snapshot:1',
            templateVersion: 3,
            documents: [
                {
                    key: {scope: 'project', file: 'article.html'},
                    content: '<!doctype html>',
                    contentHash: 'hash:project-html',
                    persistentRevision: 7,
                },
                {
                    key: {scope: 'entry', file: 'article.html'},
                    content: '<template></template>',
                    contentHash: 'hash:entry-html',
                    persistentRevision: 11,
                },
            ],
        })
        assert.equal(value.documents.length, 2)
        assert.equal(Object.isFrozen(value), true)
        assert.equal(Object.isFrozen(value.documents), true)

        assert.throws(
            () =>
                parseSourceSnapshot({
                    id: 'snapshot:duplicate',
                    templateVersion: 3,
                    documents: [
                        {
                            key: {scope: 'entry', file: 'style.css'},
                            content: '',
                            contentHash: 'one',
                            persistentRevision: 1,
                        },
                        {
                            key: {scope: 'entry', file: 'style.css'},
                            content: '',
                            contentHash: 'two',
                            persistentRevision: 1,
                        },
                    ],
                }),
            /重复源码/u,
        )
    })

    it('validates and freezes read contexts at runtime', () => {
        const context = parseReadContext({
            viewport: 'desktop',
            interactions: {hover: true, focusWithin: false},
            direction: 'rtl',
            writingMode: 'vertical-rl',
        })

        assert.equal(context.viewport, 'desktop')
        assert.equal(Object.isFrozen(context), true)
        assert.equal(Object.isFrozen(context.interactions), true)
        assert.throws(
            () =>
                parseReadContext({
                    ...context,
                    interactions: {hover: 'yes', focusWithin: false},
                }),
            /布尔交互状态/u,
        )
        assert.throws(() => parseReadContext({...context, viewport: 'print'}), /viewport/u)
        assert.throws(() => parseReadContext({...context, viewport: 'tablet'}), /viewport/u)
        assert.throws(() => parseReadContext({...context, viewport: 'wide'}), /viewport/u)
    })

    it('运行时校验完整编辑批次并冻结外部输入', () => {
        const handle = {
            handleId: 'component:0:11111111-1111-4111-8111-111111111111',
            nodeId: '11111111-1111-4111-8111-111111111111',
            instanceId: 'entry:1:11111111-1111-4111-8111-111111111111',
            kind: 'paragraph',
            origin: {
                kind: 'author',
                source: {scope: 'entry', file: 'article.html'},
                range: {unit: 'utf16-code-unit', from: 10, to: 20},
            },
            analysisStamp: 'analysis:1',
        }
        const parsed = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:1',
            interactionId: 'interaction:1',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'edit-property',
                    target: {kind: 'component-root', component: handle},
                    property: 'font-size',
                    action: {kind: 'set-value', value: '18px'},
                    readContext: {
                        viewport: 'desktop',
                        interactions: {hover: false, focusWithin: false},
                        direction: 'ltr',
                        writingMode: 'horizontal-tb',
                    },
                    destination: {scope: 'entry', channel: {kind: 'inline'}},
                    takeover: 'preserve-inline-effect',
                },
            ],
        })

        const propertyIntent = parsed.intents[0]
        assert.equal(propertyIntent.kind, 'edit-property')
        if (propertyIntent.kind !== 'edit-property') throw new Error('测试意图类型错误。')
        assert.equal(propertyIntent.target.component.nodeId, handle.nodeId)
        assert.equal(propertyIntent.takeover, 'preserve-inline-effect')
        assert.equal(Object.isFrozen(parsed), true)
        assert.equal(Object.isFrozen(parsed.intents), true)
        assert.equal(Object.isFrozen(propertyIntent.target.component.origin), true)
        assert.deepEqual(parseComponentHandle(handle), propertyIntent.target.component)

        const themeToken = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:theme-token',
            interactionId: null,
            authorizedScopes: ['project'],
            intents: [
                {
                    kind: 'edit-theme-token',
                    target: {kind: 'theme-root', scope: 'project'},
                    property: '--fc-entry-text',
                    action: {kind: 'set-value', value: '#222222'},
                },
            ],
        })
        assert.equal(themeToken.intents[0].kind, 'edit-theme-token')
        assert.throws(
            () =>
                parseEditBatch({
                    ...themeToken,
                    intents: [
                        {
                            ...themeToken.intents[0],
                            property: 'color',
                        },
                    ],
                }),
            /--fc/u,
        )

        const replacement = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:2',
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'replace-text',
                    target: {
                        kind: 'text-range',
                        component: handle,
                        range: {unit: 'utf16-code-unit', from: 0, to: 1},
                        expected: '甲',
                    },
                    coordinateSpace: 'current-candidate',
                    text: '乙',
                },
            ],
        })
        assert.equal(replacement.intents[0].kind, 'replace-text')
        assert.throws(
            () =>
                parseEditBatch({
                    ...replacement,
                    intents: [{...replacement.intents[0], coordinateSpace: 'batch-base'}],
                }),
            /current-candidate/u,
        )

        const visibility = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:3',
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'set-component-visibility',
                    target: {kind: 'component-root', component: handle},
                    expectedHidden: false,
                    hidden: true,
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(visibility.intents[0].kind, 'set-component-visibility')
        assert.throws(
            () =>
                parseEditBatch({
                    ...visibility,
                    intents: [{...visibility.intents[0], hidden: 'yes'}],
                }),
            /布尔值/u,
        )

        const semanticTag = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:4',
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'set-component-tag',
                    target: {kind: 'component-root', component: handle},
                    expectedTag: 'h2',
                    tag: 'h3',
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(semanticTag.intents[0].kind, 'set-component-tag')
        assert.throws(
            () =>
                parseEditBatch({
                    ...semanticTag,
                    intents: [{...semanticTag.intents[0], tag: 'div'}],
                }),
            /语义标签范围/u,
        )

        const assetContent = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:5',
            interactionId: null,
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'set-asset-alt',
                    target: {kind: 'component-root', component: handle},
                    expectedAlt: null,
                    alt: '图片说明',
                    destinationScope: 'entry',
                },
                {
                    kind: 'set-asset-caption',
                    target: {kind: 'component-root', component: handle},
                    expected: {kind: 'structured', text: '旧图注'},
                    caption: '新图注',
                    destinationScope: 'entry',
                },
                {
                    kind: 'set-asset-reference',
                    target: {kind: 'component-root', component: handle},
                    expected: {
                        src: 'fcasset://33333333-3333-4333-8333-333333333333',
                        assetId: '33333333-3333-4333-8333-333333333333',
                    },
                    assetId: '44444444-4444-4444-8444-444444444444',
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(assetContent.intents[0].kind, 'set-asset-alt')
        assert.equal(assetContent.intents[1].kind, 'set-asset-caption')
        assert.equal(assetContent.intents[2].kind, 'set-asset-reference')
        assert.throws(
            () =>
                parseEditBatch({
                    ...assetContent,
                    intents: [
                        {
                            ...assetContent.intents[1],
                            expected: {kind: 'custom', text: '旧图注'},
                        },
                    ],
                }),
            /前置状态/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    ...assetContent,
                    intents: [
                        {
                            ...assetContent.intents[2],
                            assetId: 'not-an-asset-id',
                        },
                    ],
                }),
            /UUID/u,
        )

        const tableResize = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:6',
            interactionId: 'interaction:table',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'resize-table',
                    target: {
                        kind: 'component-root',
                        component: {...handle, kind: 'table'},
                    },
                    expectedRowCount: 2,
                    expectedColumnCount: 2,
                    rowCount: 2,
                    columnCount: 3,
                    newCellNodeIds: [
                        '55555555-5555-4555-8555-555555555551',
                        '55555555-5555-4555-8555-555555555552',
                    ],
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(tableResize.intents[0].kind, 'resize-table')
        assert.equal(Object.isFrozen(tableResize.intents[0]), true)
        assert.throws(
            () =>
                parseEditBatch({
                    ...tableResize,
                    intents: [
                        {
                            ...tableResize.intents[0],
                            newCellNodeIds: [
                                '55555555-5555-4555-8555-555555555551',
                                '55555555-5555-4555-8555-555555555551',
                            ],
                        },
                    ],
                }),
            /不能重复/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    ...tableResize,
                    intents: [{...tableResize.intents[0], rowCount: 1}],
                }),
            /2–20/u,
        )

        const removal = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:7',
            interactionId: 'interaction:remove',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'remove-component',
                    target: {kind: 'component-root', component: handle},
                    expectedParentNodeId: '66666666-6666-4666-8666-666666666666',
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(removal.intents[0].kind, 'remove-component')
        assert.equal(Object.isFrozen(removal.intents[0]), true)
        assert.throws(
            () =>
                parseEditBatch({
                    ...removal,
                    intents: [{...removal.intents[0], expectedParentNodeId: 'not-a-node-id'}],
                }),
            /UUID/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    ...removal,
                    intents: [
                        {
                            ...removal.intents[0],
                            target: {
                                kind: 'text-range',
                                component: handle,
                                range: {unit: 'utf16-code-unit', from: 0, to: 1},
                                expected: '甲',
                            },
                        },
                    ],
                }),
            /组件根/u,
        )

        const parentHandle = {
            ...handle,
            handleId: 'component:1:66666666-6666-4666-8666-666666666666',
            nodeId: '66666666-6666-4666-8666-666666666666',
            kind: 'container',
        }
        const move = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:8',
            interactionId: 'interaction:move',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'move-component',
                    target: {kind: 'component-root', component: handle},
                    expectedParentNodeId: parentHandle.nodeId,
                    expectedPreviousSiblingNodeId: null,
                    parent: parentHandle,
                    after: null,
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(move.intents[0].kind, 'move-component')
        assert.equal(Object.isFrozen(move.intents[0]), true)
        assert.throws(
            () =>
                parseEditBatch({
                    ...move,
                    intents: [
                        {
                            ...move.intents[0],
                            expectedPreviousSiblingNodeId: 'invalid-node-id',
                        },
                    ],
                }),
            /UUID/u,
        )

        const insertion = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:9',
            interactionId: 'interaction:insert',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'insert-component',
                    target: {kind: 'component-root', component: parentHandle},
                    after: handle,
                    componentKind: 'list',
                    newNodeId: '77777777-7777-4777-8777-777777777777',
                    newChildNodeIds: ['88888888-8888-4888-8888-888888888888'],
                    assetId: null,
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(insertion.intents[0].kind, 'insert-component')
        assert.equal(Object.isFrozen(insertion.intents[0]), true)
        assert.throws(
            () =>
                parseEditBatch({
                    ...insertion,
                    intents: [
                        {
                            ...insertion.intents[0],
                            newChildNodeIds: ['77777777-7777-4777-8777-777777777777'],
                        },
                    ],
                }),
            /身份不能重复/u,
        )

        const automaticPlacement = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:10',
            interactionId: 'interaction:grid-auto',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'set-grid-auto-placement',
                    target: {kind: 'component-root', component: handle},
                    expectedParentNodeId: parentHandle.nodeId,
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(automaticPlacement.intents[0].kind, 'set-grid-auto-placement')
        assert.throws(
            () =>
                parseEditBatch({
                    ...automaticPlacement,
                    intents: [
                        {
                            ...automaticPlacement.intents[0],
                            expectedParentNodeId: 'invalid-parent',
                        },
                    ],
                }),
            /UUID/u,
        )

        const trackStructure = parseEditBatch({
            baseAnalysis: 'analysis:1',
            idempotencyKey: 'request:11',
            interactionId: 'interaction:grid-track',
            authorizedScopes: ['entry'],
            intents: [
                {
                    kind: 'change-grid-track-structure',
                    target: {kind: 'component-root', component: parentHandle},
                    context: 'desktop',
                    axis: 'columns',
                    action: {kind: 'remove', trackIndex: 1, relocation: 'auto'},
                    destinationScope: 'entry',
                },
            ],
        })
        assert.equal(trackStructure.intents[0].kind, 'change-grid-track-structure')
        assert.throws(
            () =>
                parseEditBatch({
                    ...trackStructure,
                    intents: [
                        {
                            ...trackStructure.intents[0],
                            action: {kind: 'remove', trackIndex: 12, relocation: 'auto'},
                        },
                    ],
                }),
            /0–11/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    ...trackStructure,
                    intents: [
                        {
                            ...trackStructure.intents[0],
                            action: {kind: 'remove', trackIndex: 1, relocation: 'somewhere'},
                        },
                    ],
                }),
            /安置策略/u,
        )

        const mobileSingleColumn = parseEditBatch({
            ...trackStructure,
            intents: [
                {
                    ...trackStructure.intents[0],
                    context: 'mobile',
                    axis: 'columns',
                    action: {kind: 'collapse-mobile-single-column'},
                },
            ],
        })
        assert.equal(mobileSingleColumn.intents[0].kind, 'change-grid-track-structure')
        assert.throws(
            () =>
                parseEditBatch({
                    ...mobileSingleColumn,
                    intents: [
                        {
                            ...mobileSingleColumn.intents[0],
                            context: 'desktop',
                        },
                    ],
                }),
            /mobile 列轴/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    ...mobileSingleColumn,
                    intents: [
                        {
                            ...mobileSingleColumn.intents[0],
                            axis: 'rows',
                        },
                    ],
                }),
            /mobile 列轴/u,
        )
    })

    it('拒绝伪造句柄、坐标单位、重复授权和额外字段', () => {
        const base = {
            handleId: 'component:0:node',
            nodeId: '11111111-1111-4111-8111-111111111111',
            instanceId: 'entry:node',
            kind: 'paragraph',
            origin: {kind: 'author', source: {scope: 'entry', file: 'article.html'}, range: null},
            analysisStamp: 'analysis:1',
        }
        assert.throws(() => parseComponentHandle({...base, nodeId: 'paragraph-1'}), /UUID/u)
        assert.throws(() => parseComponentHandle({...base, elevated: true}), /未知字段/u)
        assert.throws(
            () =>
                parseEditBatch({
                    baseAnalysis: 'analysis:1',
                    idempotencyKey: 'request:1',
                    interactionId: null,
                    authorizedScopes: ['entry', 'entry'],
                    intents: [],
                }),
            /不能重复/u,
        )
        assert.throws(
            () =>
                parseEditBatch({
                    baseAnalysis: 'analysis:1',
                    idempotencyKey: 'request:1',
                    interactionId: null,
                    authorizedScopes: ['entry'],
                    intents: [
                        {
                            kind: 'edit-property',
                            target: {
                                kind: 'text-range',
                                component: base,
                                range: {unit: 'utf8-byte', from: 0, to: 1},
                                expected: '甲',
                            },
                            property: 'color',
                            action: {kind: 'clear-override'},
                            readContext: {
                                viewport: 'mobile',
                                interactions: {hover: false, focusWithin: false},
                                direction: 'ltr',
                                writingMode: 'horizontal-tb',
                            },
                            destination: {scope: 'entry', channel: {kind: 'base-rule'}},
                        },
                    ],
                }),
            /utf16-code-unit/u,
        )
    })
})
