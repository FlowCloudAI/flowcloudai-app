// 本模块为节点、组件绑定、快照与交互身份提供互不混用的运行时校验品牌类型。

import {DOCUMENT_NODE_KINDS, type DocumentNodeKind} from './primitives.ts'
import type {SourceOrigin} from './source.ts'

declare const IDENTITY_BRAND: unique symbol

type BrandedString<Name extends string> = string & {
    readonly [IDENTITY_BRAND]: Name
}

export type NodeId = BrandedString<'NodeId'>
export type ComponentHandleId = BrandedString<'ComponentHandleId'>
export type SnapshotId = BrandedString<'SnapshotId'>
export type AnalysisStampId = BrandedString<'AnalysisStampId'>
export type PreviewVersion = BrandedString<'PreviewVersion'>
export type InteractionId = BrandedString<'InteractionId'>
export type EditPlanId = BrandedString<'EditPlanId'>
export type IdempotencyKey = BrandedString<'IdempotencyKey'>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function requireOpaqueId<Name extends string>(value: unknown, label: string): BrandedString<Name> {
    if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
        throw new TypeError(`${label} 必须是 1–128 位的非空不透明标识。`)
    }
    return value as BrandedString<Name>
}

export function nodeId(value: unknown): NodeId {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new TypeError('NodeId 必须是 UUID。')
    }
    return value.toLowerCase() as NodeId
}

export function componentHandleId(value: unknown): ComponentHandleId {
    return requireOpaqueId<'ComponentHandleId'>(value, 'ComponentHandleId')
}

export function snapshotId(value: unknown): SnapshotId {
    return requireOpaqueId<'SnapshotId'>(value, 'SnapshotId')
}

export function analysisStampId(value: unknown): AnalysisStampId {
    return requireOpaqueId<'AnalysisStampId'>(value, 'AnalysisStampId')
}

export function previewVersion(value: unknown): PreviewVersion {
    return requireOpaqueId<'PreviewVersion'>(value, 'PreviewVersion')
}

export function interactionId(value: unknown): InteractionId {
    return requireOpaqueId<'InteractionId'>(value, 'InteractionId')
}

export function editPlanId(value: unknown): EditPlanId {
    return requireOpaqueId<'EditPlanId'>(value, 'EditPlanId')
}

export function idempotencyKey(value: unknown): IdempotencyKey {
    return requireOpaqueId<'IdempotencyKey'>(value, 'IdempotencyKey')
}

export interface ComponentHandle {
    readonly handleId: ComponentHandleId
    readonly nodeId: NodeId
    /** 同一模板节点在不同词条预览中的实例身份，不等同于源码 NodeId。 */
    readonly instanceId: string
    readonly kind: DocumentNodeKind
    readonly origin: SourceOrigin
    readonly analysisStamp: AnalysisStampId
}

export function isDocumentNodeKind(value: unknown): value is DocumentNodeKind {
    return DOCUMENT_NODE_KINDS.includes(value as DocumentNodeKind)
}
