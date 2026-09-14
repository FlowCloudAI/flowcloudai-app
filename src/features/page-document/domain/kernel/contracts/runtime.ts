// 本模块对 AI、HTTP 与宿主边界传入的编辑请求执行运行时校验；解析后只返回冻结的内核契约。

import {parseReadContext, type EditTarget, type WriteDestination} from './context.ts'
import {
    TABLE_MAX_COLUMN_COUNT,
    TABLE_MAX_ROW_COUNT,
    TABLE_MIN_COLUMN_COUNT,
    TABLE_MIN_ROW_COUNT,
} from '../../contract.ts'
import type {
    AssetAltIntent,
    AssetCaptionExpectation,
    AssetCaptionIntent,
    AssetReferenceExpectation,
    AssetReferenceIntent,
    AdoptOpaqueElementIntent,
    ApplySourceEditsIntent,
    ChangeGridTrackStructureIntent,
    ComponentVisibilityIntent,
    ComponentTagIntent,
    EditBatch,
    EditIntent,
    LinkEditIntent,
    InsertComponentIntent,
    MoveComponentIntent,
    PropertyEditAction,
    PropertyEditIntent,
    RemoveComponentIntent,
    ResizeTableIntent,
    SetGridAutoPlacementIntent,
    SplitTextBlockIntent,
    ThemeTokenEditIntent,
    TextReplacementIntent,
} from './edit.ts'
import {
    analysisStampId,
    componentHandleId,
    idempotencyKey,
    interactionId,
    isDocumentNodeKind,
    nodeId,
    type ComponentHandle,
} from './identity.ts'
import {
    parseSourceKey,
    parseSourceOrigin,
    parseUtf16SourceRange,
    parseUtf8SourceRange,
    type SourceScope,
} from './source.ts'
import {
    DOCUMENT_MUTABLE_NODE_TAGS,
    MANAGED_NODE_STYLE_CONTEXTS,
    type DocumentMutableNodeTag,
    type ManagedNodeStyleContext,
} from './primitives.ts'

const MAX_EDIT_INTENTS = 512
const MAX_SOURCE_EDITS_PER_INTENT = 256
const PROPERTY_PATTERN = /^(?:--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/u

export function parseEditBatch(value: unknown): EditBatch {
    const record = exactRecord(value, [
        'baseAnalysis',
        'idempotencyKey',
        'interactionId',
        'authorizedScopes',
        'intents',
    ])
    if (!Array.isArray(record.authorizedScopes)) {
        throw new TypeError('EditBatch.authorizedScopes 必须是数组。')
    }
    const scopes = record.authorizedScopes.map(parseSourceScope)
    if (new Set(scopes).size !== scopes.length) {
        throw new TypeError('EditBatch.authorizedScopes 不能重复。')
    }
    if (!Array.isArray(record.intents) || record.intents.length > MAX_EDIT_INTENTS) {
        throw new TypeError(`EditBatch.intents 必须是不超过 ${MAX_EDIT_INTENTS} 项的数组。`)
    }
    return Object.freeze({
        baseAnalysis: analysisStampId(record.baseAnalysis),
        idempotencyKey: idempotencyKey(record.idempotencyKey),
        interactionId: record.interactionId === null ? null : interactionId(record.interactionId),
        authorizedScopes: Object.freeze(scopes),
        intents: Object.freeze(record.intents.map(parseEditIntent)),
    })
}

function parseEditIntent(value: unknown): EditIntent {
    if (!isRecord(value)) throw new TypeError('EditIntent 必须是对象。')
    if (value.kind === 'edit-property') return parsePropertyEditIntent(value)
    if (value.kind === 'replace-text') return parseTextReplacementIntent(value)
    if (value.kind === 'set-link') return parseLinkEditIntent(value)
    if (value.kind === 'split-text-block') return parseSplitTextBlockIntent(value)
    if (value.kind === 'set-component-visibility') return parseComponentVisibilityIntent(value)
    if (value.kind === 'set-component-tag') return parseComponentTagIntent(value)
    if (value.kind === 'set-asset-alt') return parseAssetAltIntent(value)
    if (value.kind === 'set-asset-caption') return parseAssetCaptionIntent(value)
    if (value.kind === 'set-asset-reference') return parseAssetReferenceIntent(value)
    if (value.kind === 'resize-table') return parseResizeTableIntent(value)
    if (value.kind === 'remove-component') return parseRemoveComponentIntent(value)
    if (value.kind === 'move-component') return parseMoveComponentIntent(value)
    if (value.kind === 'insert-component') return parseInsertComponentIntent(value)
    if (value.kind === 'adopt-opaque-element') return parseAdoptOpaqueElementIntent(value)
    if (value.kind === 'apply-source-edits') return parseApplySourceEditsIntent(value)
    if (value.kind === 'edit-theme-token') return parseThemeTokenEditIntent(value)
    if (value.kind === 'set-grid-auto-placement') return parseSetGridAutoPlacementIntent(value)
    if (value.kind === 'change-grid-track-structure') {
        return parseChangeGridTrackStructureIntent(value)
    }
    throw new TypeError('EditIntent.kind 不受支持。')
}

function parseApplySourceEditsIntent(value: unknown): ApplySourceEditsIntent {
    const record = exactRecord(value, ['kind', 'edits', 'componentStructure'])
    if (
        !Array.isArray(record.edits) ||
        record.edits.length === 0 ||
        record.edits.length > MAX_SOURCE_EDITS_PER_INTENT
    ) {
        throw new TypeError(
            `apply-source-edits.edits 必须包含 1–${MAX_SOURCE_EDITS_PER_INTENT} 项。`,
        )
    }
    if (record.componentStructure !== 'preserve-managed-components') {
        throw new TypeError(
            'apply-source-edits.componentStructure 必须是 preserve-managed-components。',
        )
    }
    return Object.freeze({
        kind: 'apply-source-edits' as const,
        componentStructure: 'preserve-managed-components' as const,
        edits: Object.freeze(
            record.edits.map(value => {
                const edit = exactRecord(value, ['source', 'range', 'expected', 'insert'])
                if (typeof edit.expected !== 'string' || typeof edit.insert !== 'string') {
                    throw new TypeError('源码 edit 的 expected 与 insert 必须是字符串。')
                }
                return Object.freeze({
                    source: parseSourceKey(edit.source),
                    range: parseUtf8SourceRange(edit.range),
                    expected: edit.expected,
                    insert: edit.insert,
                })
            }),
        ),
    })
}

function parseThemeTokenEditIntent(value: unknown): ThemeTokenEditIntent {
    const record = exactRecord(value, ['kind', 'target', 'property', 'action'])
    const target = exactRecord(record.target, ['kind', 'scope'])
    if (target.kind !== 'theme-root') {
        throw new TypeError('edit-theme-token.target.kind 必须是 theme-root。')
    }
    if (
        typeof record.property !== 'string' ||
        !/^--fc-[A-Za-z0-9][A-Za-z0-9-]*$/u.test(record.property)
    ) {
        throw new TypeError('edit-theme-token.property 必须是 --fc-* 自定义属性。')
    }
    return Object.freeze({
        kind: 'edit-theme-token',
        target: Object.freeze({kind: 'theme-root', scope: parseSourceScope(target.scope)}),
        property: record.property.toLowerCase(),
        action: parsePropertyEditAction(record.action),
    })
}

function parseAdoptOpaqueElementIntent(value: unknown): AdoptOpaqueElementIntent {
    const record = exactRecord(value, [
        'kind',
        'source',
        'range',
        'expected',
        'newNodeId',
        'componentKind',
    ])
    const source = parseSourceKey(record.source)
    if (source.file !== 'article.html') {
        throw new TypeError('adopt-opaque-element.source 必须指向 article.html。')
    }
    if (typeof record.expected !== 'string') {
        throw new TypeError('adopt-opaque-element.expected 必须是字符串。')
    }
    if (!isDocumentNodeKind(record.componentKind)) {
        throw new TypeError('adopt-opaque-element.componentKind 不受支持。')
    }
    return Object.freeze({
        kind: 'adopt-opaque-element',
        source,
        range: parseUtf16SourceRange(record.range),
        expected: record.expected,
        newNodeId: nodeId(record.newNodeId),
        componentKind: record.componentKind,
    })
}

function parseChangeGridTrackStructureIntent(value: unknown): ChangeGridTrackStructureIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'context',
        'axis',
        'action',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('change-grid-track-structure.target 必须是组件根。')
    }
    if (!['mobile', 'desktop'].includes(record.context as string)) {
        throw new TypeError('change-grid-track-structure.context 不受支持。')
    }
    if (record.axis !== 'columns' && record.axis !== 'rows') {
        throw new TypeError('change-grid-track-structure.axis 不受支持。')
    }
    if (!isRecord(record.action)) {
        throw new TypeError('change-grid-track-structure.action 必须是对象。')
    }
    const action = parseGridTrackStructureAction(record.action)
    if (
        action.kind === 'collapse-mobile-single-column' &&
        (record.context !== 'mobile' || record.axis !== 'columns')
    ) {
        throw new TypeError('通用单列操作必须使用 mobile 列轴。')
    }
    return Object.freeze({
        kind: 'change-grid-track-structure',
        target,
        context: record.context as ChangeGridTrackStructureIntent['context'],
        axis: record.axis,
        action,
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseGridTrackStructureAction(
    value: Record<string, unknown>,
): ChangeGridTrackStructureIntent['action'] {
    if (value.kind === 'collapse-mobile-single-column') {
        exactRecord(value, ['kind'])
        return Object.freeze({kind: 'collapse-mobile-single-column'})
    }
    if (value.kind === 'insert') {
        const record = exactRecord(value, ['kind', 'trackIndex', 'value'])
        assertGridTrackIndex(record.trackIndex)
        if (typeof record.value !== 'string' || record.value.length > 256) {
            throw new TypeError('插入轨道值必须是不超过 256 字符的字符串。')
        }
        return Object.freeze({
            kind: 'insert',
            trackIndex: record.trackIndex as number,
            value: record.value,
        })
    }
    if (value.kind !== 'remove') {
        throw new TypeError('change-grid-track-structure.action.kind 不受支持。')
    }
    const record = exactRecord(value, ['kind', 'trackIndex', 'relocation'])
    assertGridTrackIndex(record.trackIndex)
    if (
        record.relocation !== null &&
        !['auto', 'previous', 'next'].includes(record.relocation as string)
    ) {
        throw new TypeError('删除轨道的子项安置策略不受支持。')
    }
    const relocation = record.relocation as 'auto' | 'previous' | 'next' | null
    return Object.freeze({
        kind: 'remove',
        trackIndex: record.trackIndex as number,
        relocation,
    })
}

function assertGridTrackIndex(value: unknown): void {
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= 12) {
        throw new TypeError('轨道索引必须是 0–11 之间的整数。')
    }
}

function parseSetGridAutoPlacementIntent(value: unknown): SetGridAutoPlacementIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'expectedParentNodeId',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('set-grid-auto-placement.target 必须是组件根。')
    }
    return Object.freeze({
        kind: 'set-grid-auto-placement',
        target,
        expectedParentNodeId: nodeId(record.expectedParentNodeId),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseInsertComponentIntent(value: unknown): InsertComponentIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'after',
        'componentKind',
        'newNodeId',
        'newChildNodeIds',
        'assetId',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('insert-component.target 必须是父组件根。')
    }
    if (!isDocumentNodeKind(record.componentKind)) {
        throw new TypeError('insert-component.componentKind 不受支持。')
    }
    if (!Array.isArray(record.newChildNodeIds)) {
        throw new TypeError('insert-component.newChildNodeIds 必须是 UUID 数组。')
    }
    const newNodeId = nodeId(record.newNodeId)
    const newChildNodeIds = record.newChildNodeIds.map(nodeId)
    if (new Set([newNodeId, ...newChildNodeIds]).size !== newChildNodeIds.length + 1) {
        throw new TypeError('insert-component 的新组件身份不能重复。')
    }
    return Object.freeze({
        kind: 'insert-component',
        target,
        after: record.after === null ? null : parseComponentHandle(record.after),
        componentKind: record.componentKind,
        newNodeId,
        newChildNodeIds: Object.freeze(newChildNodeIds),
        assetId: record.assetId === null ? null : nodeId(record.assetId),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseMoveComponentIntent(value: unknown): MoveComponentIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'expectedParentNodeId',
        'expectedPreviousSiblingNodeId',
        'parent',
        'after',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('move-component.target 必须是组件根。')
    }
    return Object.freeze({
        kind: 'move-component',
        target,
        expectedParentNodeId: nodeId(record.expectedParentNodeId),
        expectedPreviousSiblingNodeId:
            record.expectedPreviousSiblingNodeId === null
                ? null
                : nodeId(record.expectedPreviousSiblingNodeId),
        parent: parseComponentHandle(record.parent),
        after: record.after === null ? null : parseComponentHandle(record.after),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseRemoveComponentIntent(value: unknown): RemoveComponentIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'expectedParentNodeId',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('remove-component.target 必须是组件根。')
    }
    return Object.freeze({
        kind: 'remove-component',
        target,
        expectedParentNodeId:
            record.expectedParentNodeId === null ? null : nodeId(record.expectedParentNodeId),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseResizeTableIntent(value: unknown): ResizeTableIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'expectedRowCount',
        'expectedColumnCount',
        'rowCount',
        'columnCount',
        'newCellNodeIds',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('resize-table.target 必须是组件根。')
    }
    assertBoundedInteger(
        record.expectedRowCount,
        TABLE_MIN_ROW_COUNT,
        TABLE_MAX_ROW_COUNT,
        'expectedRowCount',
    )
    assertBoundedInteger(
        record.expectedColumnCount,
        TABLE_MIN_COLUMN_COUNT,
        TABLE_MAX_COLUMN_COUNT,
        'expectedColumnCount',
    )
    assertBoundedInteger(record.rowCount, TABLE_MIN_ROW_COUNT, TABLE_MAX_ROW_COUNT, 'rowCount')
    assertBoundedInteger(
        record.columnCount,
        TABLE_MIN_COLUMN_COUNT,
        TABLE_MAX_COLUMN_COUNT,
        'columnCount',
    )
    if (!Array.isArray(record.newCellNodeIds)) {
        throw new TypeError('resize-table.newCellNodeIds 必须是 UUID 数组。')
    }
    const newCellNodeIds = record.newCellNodeIds.map(nodeId)
    if (new Set(newCellNodeIds).size !== newCellNodeIds.length) {
        throw new TypeError('resize-table.newCellNodeIds 不能重复。')
    }
    return Object.freeze({
        kind: 'resize-table',
        target,
        expectedRowCount: record.expectedRowCount as number,
        expectedColumnCount: record.expectedColumnCount as number,
        rowCount: record.rowCount as number,
        columnCount: record.columnCount as number,
        newCellNodeIds: Object.freeze(newCellNodeIds),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function assertBoundedInteger(
    value: unknown,
    minimum: number,
    maximum: number,
    field: string,
): void {
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new TypeError(`resize-table.${field} 必须是 ${minimum}–${maximum} 之间的整数。`)
    }
}

function parseAssetReferenceIntent(value: unknown): AssetReferenceIntent {
    const record = exactRecord(value, ['kind', 'target', 'expected', 'assetId', 'destinationScope'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('set-asset-reference.target 必须是组件根。')
    }
    return Object.freeze({
        kind: 'set-asset-reference',
        target,
        expected: parseAssetReferenceExpectation(record.expected),
        assetId: nodeId(record.assetId),
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseAssetReferenceExpectation(value: unknown): AssetReferenceExpectation {
    const record = exactRecord(value, ['src', 'assetId'])
    if (
        (record.src !== null && typeof record.src !== 'string') ||
        (record.assetId !== null && typeof record.assetId !== 'string')
    ) {
        throw new TypeError('资产引用前置状态必须是字符串或 null。')
    }
    return Object.freeze({
        src: record.src as string | null,
        assetId: record.assetId as string | null,
    })
}

function parseAssetAltIntent(value: unknown): AssetAltIntent {
    const record = exactRecord(value, ['kind', 'target', 'expectedAlt', 'alt', 'destinationScope'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') throw new TypeError('set-asset-alt.target 必须是组件根。')
    if (
        (record.expectedAlt !== null && typeof record.expectedAlt !== 'string') ||
        typeof record.alt !== 'string'
    ) {
        throw new TypeError('图片替代文本及其前置值必须是字符串或 null。')
    }
    return Object.freeze({
        kind: 'set-asset-alt',
        target,
        expectedAlt: record.expectedAlt as string | null,
        alt: record.alt,
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseAssetCaptionIntent(value: unknown): AssetCaptionIntent {
    const record = exactRecord(value, ['kind', 'target', 'expected', 'caption', 'destinationScope'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('set-asset-caption.target 必须是组件根。')
    }
    if (record.caption !== null && typeof record.caption !== 'string') {
        throw new TypeError('图片图注必须是字符串或 null。')
    }
    return Object.freeze({
        kind: 'set-asset-caption',
        target,
        expected: parseAssetCaptionExpectation(record.expected),
        caption: record.caption as string | null,
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseAssetCaptionExpectation(value: unknown): AssetCaptionExpectation {
    if (!isRecord(value)) throw new TypeError('图片图注前置状态必须是对象。')
    if (value.kind === 'absent') {
        exactRecord(value, ['kind'])
        return Object.freeze({kind: 'absent'})
    }
    if (value.kind !== 'plain' && value.kind !== 'structured') {
        throw new TypeError('图片图注前置状态不受支持。')
    }
    const record = exactRecord(value, ['kind', 'text'])
    if (typeof record.text !== 'string') throw new TypeError('图片图注前置文本必须是字符串。')
    return Object.freeze({kind: value.kind, text: record.text})
}

function parseComponentTagIntent(value: unknown): ComponentTagIntent {
    const record = exactRecord(value, ['kind', 'target', 'expectedTag', 'tag', 'destinationScope'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('set-component-tag.target 必须是组件根。')
    }
    if (!isMutableNodeTag(record.expectedTag) || !isMutableNodeTag(record.tag)) {
        throw new TypeError('组件标签不在允许转换的语义标签范围内。')
    }
    return Object.freeze({
        kind: 'set-component-tag',
        target,
        expectedTag: record.expectedTag,
        tag: record.tag,
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function isMutableNodeTag(value: unknown): value is DocumentMutableNodeTag {
    return DOCUMENT_MUTABLE_NODE_TAGS.includes(value as DocumentMutableNodeTag)
}

function parseComponentVisibilityIntent(value: unknown): ComponentVisibilityIntent {
    const record = exactRecord(value, [
        'kind',
        'target',
        'expectedHidden',
        'hidden',
        'destinationScope',
    ])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'component-root') {
        throw new TypeError('set-component-visibility.target 必须是组件根。')
    }
    if (typeof record.expectedHidden !== 'boolean' || typeof record.hidden !== 'boolean') {
        throw new TypeError('组件可见性前置状态与目标状态必须是布尔值。')
    }
    return Object.freeze({
        kind: 'set-component-visibility',
        target,
        expectedHidden: record.expectedHidden,
        hidden: record.hidden,
        destinationScope: parseSourceScope(record.destinationScope),
    })
}

function parseSplitTextBlockIntent(value: unknown): SplitTextBlockIntent {
    const record = exactRecord(value, ['kind', 'target', 'coordinateSpace', 'newNodeId'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'text-range') {
        throw new TypeError('split-text-block.target 必须是文本选区。')
    }
    if (record.coordinateSpace !== 'current-candidate') {
        throw new TypeError('split-text-block.coordinateSpace 必须是 current-candidate。')
    }
    return Object.freeze({
        kind: 'split-text-block',
        target,
        coordinateSpace: 'current-candidate',
        newNodeId: nodeId(record.newNodeId),
    })
}

export function parseComponentHandle(value: unknown): ComponentHandle {
    const record = exactRecord(value, [
        'handleId',
        'nodeId',
        'instanceId',
        'kind',
        'origin',
        'analysisStamp',
    ])
    if (typeof record.instanceId !== 'string' || !isValidInstanceId(record.instanceId)) {
        throw new TypeError('ComponentHandle.instanceId 必须是 1–256 位非控制字符。')
    }
    if (!isDocumentNodeKind(record.kind)) {
        throw new TypeError('ComponentHandle.kind 不受支持。')
    }
    return Object.freeze({
        handleId: componentHandleId(record.handleId),
        nodeId: nodeId(record.nodeId),
        instanceId: record.instanceId,
        kind: record.kind,
        origin: parseSourceOrigin(record.origin),
        analysisStamp: analysisStampId(record.analysisStamp),
    })
}

function parsePropertyEditIntent(value: unknown): PropertyEditIntent {
    const record = exactRecord(
        value,
        ['kind', 'target', 'property', 'action', 'readContext', 'destination'],
        ['takeover'],
    )
    if (record.kind !== 'edit-property') throw new TypeError('EditIntent.kind 不受支持。')
    if (typeof record.property !== 'string' || !PROPERTY_PATTERN.test(record.property)) {
        throw new TypeError('PropertyEditIntent.property 不是合法 CSS 属性名。')
    }
    if (record.takeover !== undefined && record.takeover !== 'preserve-inline-effect') {
        throw new TypeError('PropertyEditIntent.takeover 不受支持。')
    }
    return Object.freeze({
        kind: 'edit-property',
        target: parseEditTarget(record.target),
        property: record.property,
        action: parsePropertyEditAction(record.action),
        readContext: parseReadContext(record.readContext),
        destination: parseWriteDestination(record.destination),
        takeover: record.takeover as PropertyEditIntent['takeover'],
    })
}

function parseTextReplacementIntent(value: unknown): TextReplacementIntent {
    const record = exactRecord(value, ['kind', 'target', 'coordinateSpace', 'text'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'text-range') {
        throw new TypeError('replace-text.target 必须是文本选区。')
    }
    if (record.coordinateSpace !== 'current-candidate') {
        throw new TypeError('replace-text.coordinateSpace 必须是 current-candidate。')
    }
    if (typeof record.text !== 'string') {
        throw new TypeError('replace-text.text 必须是字符串。')
    }
    return Object.freeze({
        kind: 'replace-text',
        target,
        coordinateSpace: 'current-candidate',
        text: record.text,
    })
}

function parseLinkEditIntent(value: unknown): LinkEditIntent {
    const record = exactRecord(value, ['kind', 'target', 'coordinateSpace', 'href'])
    const target = parseEditTarget(record.target)
    if (target.kind !== 'text-range') throw new TypeError('set-link.target 必须是文本选区。')
    if (record.coordinateSpace !== 'current-candidate') {
        throw new TypeError('set-link.coordinateSpace 必须是 current-candidate。')
    }
    if (record.href !== null && typeof record.href !== 'string') {
        throw new TypeError('set-link.href 必须是字符串或 null。')
    }
    return Object.freeze({
        kind: 'set-link',
        target,
        coordinateSpace: 'current-candidate',
        href: record.href as string | null,
    })
}

export function parseEditTarget(value: unknown): EditTarget {
    if (!isRecord(value)) throw new TypeError('EditTarget 必须是对象。')
    if (value.kind === 'component-root') {
        const record = exactRecord(value, ['kind', 'component'])
        return Object.freeze({
            kind: 'component-root',
            component: parseComponentHandle(record.component),
        })
    }
    if (value.kind === 'semantic-part') {
        const record = exactRecord(value, ['kind', 'component', 'part'])
        if (typeof record.part !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(record.part)) {
            throw new TypeError('EditTarget.part 不是合法语义部位标识。')
        }
        return Object.freeze({
            kind: 'semantic-part',
            component: parseComponentHandle(record.component),
            part: record.part,
        })
    }
    if (value.kind === 'text-range') {
        const record = exactRecord(value, ['kind', 'component', 'range', 'expected'])
        if (typeof record.expected !== 'string') {
            throw new TypeError('EditTarget.expected 必须是字符串。')
        }
        return Object.freeze({
            kind: 'text-range',
            component: parseComponentHandle(record.component),
            range: parseUtf16SourceRange(record.range),
            expected: record.expected,
        })
    }
    throw new TypeError('EditTarget.kind 不受支持。')
}

function parsePropertyEditAction(value: unknown): PropertyEditAction {
    if (!isRecord(value)) throw new TypeError('PropertyEditAction 必须是对象。')
    if (value.kind === 'clear-override') {
        exactRecord(value, ['kind'])
        return Object.freeze({kind: 'clear-override'})
    }
    if (value.kind === 'set-value') {
        const record = exactRecord(value, ['kind', 'value'])
        if (typeof record.value !== 'string') {
            throw new TypeError('set-value.value 必须是字符串。')
        }
        return Object.freeze({kind: 'set-value', value: record.value})
    }
    throw new TypeError('PropertyEditAction.kind 不受支持。')
}

function parseWriteDestination(value: unknown): WriteDestination {
    const record = exactRecord(value, ['scope', 'channel'])
    const scope = parseSourceScope(record.scope)
    if (!isRecord(record.channel)) throw new TypeError('WriteDestination.channel 必须是对象。')
    if (record.channel.kind === 'inline' || record.channel.kind === 'base-rule') {
        exactRecord(record.channel, ['kind'])
        return Object.freeze({scope, channel: Object.freeze({kind: record.channel.kind})})
    }
    if (record.channel.kind === 'conditional-rule') {
        const channel = exactRecord(record.channel, ['kind', 'context'])
        if (!MANAGED_NODE_STYLE_CONTEXTS.includes(channel.context as ManagedNodeStyleContext)) {
            throw new TypeError('WriteDestination 条件上下文不受支持。')
        }
        return Object.freeze({
            scope,
            channel: Object.freeze({
                kind: 'conditional-rule',
                context: channel.context as ManagedNodeStyleContext,
            }),
        })
    }
    throw new TypeError('WriteDestination.channel.kind 不受支持。')
}

function parseSourceScope(value: unknown): SourceScope {
    if (value !== 'project' && value !== 'entry') {
        throw new TypeError('源码作用域必须是 project 或 entry。')
    }
    return value
}

function isValidInstanceId(value: string): boolean {
    if (value.length < 1 || value.length > 256) return false
    return [...value].every(character => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint >= 0x20 && codePoint !== 0x7f
    })
}

function exactRecord(
    value: unknown,
    keys: readonly string[],
    optionalKeys: readonly string[] = [],
): Record<string, unknown> {
    if (!isRecord(value)) throw new TypeError('契约值必须是对象。')
    const allowed = new Set([...keys, ...optionalKeys])
    const unknown = Object.keys(value).find(key => !allowed.has(key))
    const missing = keys.find(key => !(key in value))
    if (unknown) throw new TypeError(`契约包含未知字段 ${unknown}。`)
    if (missing) throw new TypeError(`契约缺少字段 ${missing}。`)
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
