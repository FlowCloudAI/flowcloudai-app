// 本模块定义语义编辑批次、源码补丁意图、准备结果与应用回执；确认授权只绑定不可变计划身份。

import type {DocumentDiagnostic} from '../../contract.ts'
import type {DocumentAnalysisSnapshot} from './analysis.ts'
import type {EditTarget, ReadContext, WriteDestination} from './context.ts'
import type {
    AnalysisStampId,
    ComponentHandle,
    EditPlanId,
    IdempotencyKey,
    InteractionId,
    NodeId,
    SnapshotId,
} from './identity.ts'
import type {
    SourceKey,
    SourceSnapshot,
    SourceScope,
    Utf16SourceRange,
    Utf8SourceRange,
} from './source.ts'
import type {DocumentMutableNodeTag, DocumentNodeKind} from './primitives.ts'

export type PropertyEditAction =
    {readonly kind: 'set-value'; readonly value: string} | {readonly kind: 'clear-override'}

export interface PropertyEditIntent {
    readonly kind: 'edit-property'
    readonly target: EditTarget
    readonly property: string
    readonly action: PropertyEditAction
    readonly readContext: ReadContext
    readonly destination: WriteDestination
    /** 建立或清理规则前，由计划器保全其他上下文并移除会压住该规则的固定行内作者值。 */
    readonly takeover?: 'preserve-inline-effect'
}

export interface TextReplacementIntent {
    readonly kind: 'replace-text'
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    /** 批次内按顺序解释；每项 expected 都针对执行到该项时的候选文本。 */
    readonly coordinateSpace: 'current-candidate'
    readonly text: string
}

export interface LinkEditIntent {
    readonly kind: 'set-link'
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    readonly coordinateSpace: 'current-candidate'
    readonly href: string | null
}

export interface SplitTextBlockIntent {
    readonly kind: 'split-text-block'
    readonly target: Extract<EditTarget, {readonly kind: 'text-range'}>
    readonly coordinateSpace: 'current-candidate'
    /** 由宿主预先分配；AI 适配器只能引用批次临时名称。 */
    readonly newNodeId: NodeId
}

export interface ComponentVisibilityIntent {
    readonly kind: 'set-component-visibility'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedHidden: boolean
    readonly hidden: boolean
    readonly destinationScope: SourceScope
}

export interface ComponentTagIntent {
    readonly kind: 'set-component-tag'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedTag: DocumentMutableNodeTag
    readonly tag: DocumentMutableNodeTag
    readonly destinationScope: SourceScope
}

export interface AssetAltIntent {
    readonly kind: 'set-asset-alt'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedAlt: string | null
    readonly alt: string
    readonly destinationScope: SourceScope
}

export type AssetCaptionExpectation =
    {readonly kind: 'absent'} | {readonly kind: 'plain' | 'structured'; readonly text: string}

export interface AssetCaptionIntent {
    readonly kind: 'set-asset-caption'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expected: AssetCaptionExpectation
    readonly caption: string | null
    readonly destinationScope: SourceScope
}

export interface AssetReferenceExpectation {
    readonly src: string | null
    readonly assetId: string | null
}

export interface AssetReferenceIntent {
    readonly kind: 'set-asset-reference'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expected: AssetReferenceExpectation
    readonly assetId: NodeId
    readonly destinationScope: SourceScope
}

export interface ResizeTableIntent {
    readonly kind: 'resize-table'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedRowCount: number
    readonly expectedColumnCount: number
    readonly rowCount: number
    readonly columnCount: number
    readonly newCellNodeIds: readonly NodeId[]
    readonly destinationScope: SourceScope
}

export interface RemoveComponentIntent {
    readonly kind: 'remove-component'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedParentNodeId: NodeId | null
    readonly destinationScope: SourceScope
}

export interface MoveComponentIntent {
    readonly kind: 'move-component'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedParentNodeId: NodeId
    readonly expectedPreviousSiblingNodeId: NodeId | null
    readonly parent: ComponentHandle
    readonly after: ComponentHandle | null
    readonly destinationScope: SourceScope
}

export interface InsertComponentIntent {
    readonly kind: 'insert-component'
    /** 插入目标是父组件；新组件尚未存在，因此不能伪造 ComponentHandle。 */
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly after: ComponentHandle | null
    readonly componentKind: DocumentNodeKind
    readonly newNodeId: NodeId
    readonly newChildNodeIds: readonly NodeId[]
    readonly assetId: NodeId | null
    readonly destinationScope: SourceScope
}

/** 将作者 HTML 中一个尚未托管的完整元素纳入组件身份体系；目标在接管前没有 ComponentHandle。 */
export interface AdoptOpaqueElementIntent {
    readonly kind: 'adopt-opaque-element'
    readonly source: SourceKey
    readonly range: Utf16SourceRange
    readonly expected: string
    readonly newNodeId: NodeId
    readonly componentKind: DocumentNodeKind
}

export interface SourceEditIntentItem {
    readonly source: SourceKey
    /** AI/API 边界使用 UTF-8 字节坐标；内核在起始快照上统一换算后原子应用。 */
    readonly range: Utf8SourceRange
    readonly expected: string
    readonly insert: string
}

/**
 * 受控属性与结构意图无法表达时的源码逃生口。整组 edit 共用请求起始坐标，
 * 只对最终候选做语法、结构与策略分析，不要求组内中间文本可解析。
 */
export interface ApplySourceEditsIntent {
    readonly kind: 'apply-source-edits'
    readonly edits: readonly SourceEditIntentItem[]
    /**
     * 源码逃生口首版只允许保留现有托管组件图；组件增删、移动和改型必须使用对应语义意图。
     * 这不限制普通内部 HTML 包装、文本与 CSS 调整，也不影响代码模式直接编辑完整草稿。
     */
    readonly componentStructure: 'preserve-managed-components'
}

export interface ThemeTokenEditIntent {
    readonly kind: 'edit-theme-token'
    readonly target: Readonly<{readonly kind: 'theme-root'; readonly scope: SourceScope}>
    readonly property: string
    readonly action: PropertyEditAction
}

export interface SetGridAutoPlacementIntent {
    readonly kind: 'set-grid-auto-placement'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly expectedParentNodeId: NodeId
    readonly destinationScope: SourceScope
}

export type GridTrackStructureContext = 'mobile' | 'desktop'
export type GridTrackStructureAxis = 'columns' | 'rows'
export type GridTrackRelocationStrategy = 'auto' | 'previous' | 'next'

export type GridTrackStructureAction =
    | {readonly kind: 'collapse-mobile-single-column'}
    | {
          readonly kind: 'insert'
          readonly trackIndex: number
          readonly value: string
      }
    | {
          readonly kind: 'remove'
          readonly trackIndex: number
          readonly relocation: GridTrackRelocationStrategy | null
      }

export interface ChangeGridTrackStructureIntent {
    readonly kind: 'change-grid-track-structure'
    readonly target: Extract<EditTarget, {readonly kind: 'component-root'}>
    readonly context: GridTrackStructureContext
    readonly axis: GridTrackStructureAxis
    readonly action: GridTrackStructureAction
    readonly destinationScope: SourceScope
}

export type EditIntent =
    | PropertyEditIntent
    | TextReplacementIntent
    | LinkEditIntent
    | SplitTextBlockIntent
    | ComponentVisibilityIntent
    | ComponentTagIntent
    | AssetAltIntent
    | AssetCaptionIntent
    | AssetReferenceIntent
    | ResizeTableIntent
    | RemoveComponentIntent
    | MoveComponentIntent
    | InsertComponentIntent
    | AdoptOpaqueElementIntent
    | ApplySourceEditsIntent
    | ThemeTokenEditIntent
    | SetGridAutoPlacementIntent
    | ChangeGridTrackStructureIntent

export interface EditBatch {
    readonly baseAnalysis: AnalysisStampId
    readonly idempotencyKey: IdempotencyKey
    readonly interactionId: InteractionId | null
    readonly authorizedScopes: readonly SourceScope[]
    readonly intents: readonly EditIntent[]
}

export interface SourcePatchIntent {
    readonly source: SourceKey
    readonly range: Utf16SourceRange
    readonly expected: string
    readonly insert: string
    readonly baseline: SnapshotId
    readonly structuralChange: 'none' | 'inline-wrapper' | 'component-tree'
}

export interface EditImpact {
    readonly code: string
    readonly message: string
    readonly requiresDecision: boolean
}

export interface PreparedEdit {
    readonly planId: EditPlanId
    readonly idempotencyKey: IdempotencyKey
    readonly baseAnalysis: AnalysisStampId
    readonly patches: readonly SourcePatchIntent[]
    readonly candidateSnapshot: SourceSnapshot
    readonly candidateAnalysis: DocumentAnalysisSnapshot
    readonly impacts: readonly EditImpact[]
}

export type PrepareEditResult =
    | {readonly status: 'ready'; readonly prepared: PreparedEdit}
    | {
          readonly status: 'needs-decision'
          readonly prepared: PreparedEdit
          readonly decisions: readonly EditImpact[]
      }
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

export type EditReceipt =
    | {
          readonly status: 'applied'
          readonly planId: EditPlanId
          readonly snapshot: SourceSnapshot
      }
    | {
          readonly status: 'unchanged'
          readonly planId: EditPlanId | null
          readonly snapshot: SourceSnapshot
      }
    | {
          readonly status: 'rejected' | 'stale'
          readonly planId: EditPlanId | null
          readonly diagnostics: readonly DocumentDiagnostic[]
      }
