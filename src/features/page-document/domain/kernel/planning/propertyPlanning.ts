// 本模块将固定属性编辑意图规划为版本化源码补丁；每步都重绑定组件并分析最终候选，不复用过期坐标。

import type {DocumentDiagnostic} from '../../contract.ts'
import {
    componentDefinition,
    componentHasCapability,
    propertyCapabilityForComponent,
    type ComponentIndex,
    type ComponentSemanticPartId,
} from '../components/index.ts'
import type {DocumentAnalysisSnapshot} from '../contracts/analysis.ts'
import {
    selectPublicComponentDefinition,
    type PublicComponentDefinitionContract,
} from '../contracts/publicComponent.ts'
import type {EditTarget} from '../contracts/context.ts'
import type {
    AssetAltIntent,
    AssetCaptionIntent,
    AssetReferenceIntent,
    AdoptOpaqueElementIntent,
    ApplySourceEditsIntent,
    ComponentVisibilityIntent,
    ComponentTagIntent,
    EditBatch,
    EditIntent,
    EditImpact,
    InsertComponentIntent,
    InsertPublicComponentIntent,
    EditPublicComponentInstanceIntent,
    LinkEditIntent,
    MoveComponentIntent,
    PropertyEditIntent,
    RemoveComponentIntent,
    ResizeTableIntent,
    SetGridAutoPlacementIntent,
    SourcePatchIntent,
    SplitTextBlockIntent,
    ThemeTokenEditIntent,
    TextReplacementIntent,
} from '../contracts/edit.ts'
import type {ComponentHandle, NodeId} from '../contracts/identity.ts'
import {
    preserveNodeIdentity,
    planTextBlockSplit as planTextBlockSplitIdentity,
} from '../contracts/nodeIdentityPolicy.ts'
import {
    sourceKeyString,
    utf16RangeFromUtf8ByteRange,
    type SourceDocument,
    type SourceScope,
    type SourceSnapshot,
} from '../contracts/source.ts'
import {
    createAssetAltPatch,
    createAssetCaptionPatch,
    readAssetCaptionState,
} from '../patching/assetContentPatches.ts'
import {
    createAssetReferencePatches,
    readAssetReferenceExpectation,
} from '../patching/assetReferencePatches.ts'
import {
    createInlineStylePropertiesPatch,
    createInlineStylePropertyPatch,
} from '../patching/inlineStylePatches.ts'
import {createComponentVisibilityPatch} from '../patching/componentVisibilityPatches.ts'
import {createComponentTagPatches} from '../patching/componentTagPatches.ts'
import {createComponentRemovalPatch} from '../patching/componentRemovalPatches.ts'
import {createComponentMovePatches} from '../patching/componentMovePatches.ts'
import {createComponentInsertionPatches} from '../patching/componentInsertionPatches.ts'
import {createPublicComponentInsertionPatch} from '../patching/publicComponentInsertionPatches.ts'
import {createPublicComponentInstancePatches} from '../patching/publicComponentInstancePatches.ts'
import {createOpaqueElementAdoptionPatch} from '../patching/opaqueElementAdoptionPatches.ts'
import {createThemeTokenPatches} from '../patching/themeTokenPatches.ts'
import {createTextRangeLinkPatches, textRangeHasHref} from '../patching/linkPatches.ts'
import {createManagedRulePropertyPatches} from '../patching/managedRulePatches.ts'
import {createManagedNodeRuleRemovalPatches} from '../patching/managedNodeRuleRemovalPatches.ts'
import {applySourcePatches} from '../patching/sourcePatches.ts'
import {componentTextEquals, createTextReplacementPatches} from '../patching/textContentPatches.ts'
import {
    createTextRangeStylePatches,
    textRangeHasNoManagedOverride,
    textRangeHasStyle,
} from '../patching/textRangePatches.ts'
import {createTextBlockSplitPatches} from '../patching/textStructurePatches.ts'
import {createTableStructurePatches} from '../patching/tableStructurePatches.ts'
import {readManagedTableStructure} from '../syntax/index.ts'
import {
    isDirectlyEditableProperty,
    type PropertyAnalyzer,
    type ThemeTokenAnalyzer,
} from '../styles/index.ts'
import {analyzePropertyEditImpacts} from './propertyImpacts.ts'
import {verifyPropertyEditPostcondition} from './propertyPostconditions.ts'
import {expandPropertyTakeovers} from './propertyTakeover.ts'
import {expandGridTrackStructureIntents} from './gridTrackStructurePlanning.ts'
import {
    compareManagedComponentStructure,
    describeManagedComponentStructureMismatch,
} from './sourceEditStructure.ts'
import {
    validateGridLayoutPostconditions,
    validateGridParentPostconditions,
} from './gridLayoutPostconditions.ts'
import {
    checkComponentMovePolicy,
    checkComponentInsertionPolicy,
    checkComponentRemovalPolicy,
    checkComponentVisibilityPolicy,
    inspectComponentMovementPolicy,
} from '../policy/index.ts'

export interface PlanningAnalysisRuntime {
    readonly snapshot: DocumentAnalysisSnapshot
    readonly entryId: string
    readonly components: ComponentIndex | null
    readonly properties: PropertyAnalyzer | null
    readonly themeTokens: ThemeTokenAnalyzer | null
    readonly componentDefinitions: readonly PublicComponentDefinitionContract[]
}

export interface PropertyPlanningEnvironment {
    readonly initial: PlanningAnalysisRuntime
    analyzeCandidate(sourceSnapshot: SourceSnapshot): PlanningAnalysisRuntime
}

export type PropertyPlanningResult =
    | {
          readonly status: 'ready' | 'unchanged'
          readonly patches: readonly SourcePatchIntent[]
          readonly impacts: readonly EditImpact[]
          readonly candidate: PlanningAnalysisRuntime
      }
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

const MAX_BATCH_INTENTS = 512
const PROPERTY_PATTERN = /^(?:--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/u

type PlannedVerification =
    | {
          readonly kind: 'source-edits'
          readonly componentStructure: ApplySourceEditsIntent['componentStructure']
      }
    | {readonly kind: 'component-property'}
    | {readonly kind: 'component-visibility'; readonly hidden: boolean}
    | {readonly kind: 'component-tag'; readonly tag: ComponentTagIntent['tag']}
    | {readonly kind: 'asset-alt'; readonly alt: string}
    | {readonly kind: 'asset-caption'; readonly caption: string | null}
    | {readonly kind: 'asset-reference'; readonly assetId: string}
    | {
          readonly kind: 'table-size'
          readonly rowCount: number
          readonly columnCount: number
          readonly newCellNodeIds: readonly string[]
          readonly removedNodeIds: readonly string[]
      }
    | {
          readonly kind: 'component-removed'
          readonly removedNodeIds: readonly NodeId[]
          readonly parentNodeId: NodeId
          readonly degradedReferenceCount: number
      }
    | {
          readonly kind: 'component-moved'
          readonly parentNodeId: NodeId
          readonly previousSiblingNodeId: NodeId | null
      }
    | {
          readonly kind: 'component-inserted'
          readonly componentKind: InsertComponentIntent['componentKind']
          readonly newNodeId: NodeId
          readonly newChildNodeIds: readonly NodeId[]
          readonly parentNodeId: NodeId
          readonly previousSiblingNodeId: NodeId | null
      }
    | {
          readonly kind: 'public-component-inserted'
          readonly componentId: NodeId
          readonly revision: number | 'latest'
          readonly instanceId: NodeId
          readonly newNodeId: NodeId
          readonly parentNodeId: NodeId
          readonly previousSiblingNodeId: NodeId | null
      }
    | {
          readonly kind: 'public-component-instance-edited'
          readonly properties: Readonly<Record<string, string | null>>
          readonly styleVariables: Readonly<Record<string, string | null>>
      }
    | {
          readonly kind: 'component-adopted'
          readonly newNodeId: NodeId
          readonly componentKind: AdoptOpaqueElementIntent['componentKind']
          readonly source: AdoptOpaqueElementIntent['source']
      }
    | {
          readonly kind: 'theme-token'
          readonly scope: ThemeTokenEditIntent['target']['scope']
          readonly property: string
          readonly value: string | null
      }
    | {readonly kind: 'grid-auto-placement'; readonly parentNodeId: NodeId}
    | {readonly kind: 'text-format'}
    | {readonly kind: 'text-content'; readonly expectedText: string}
    | {readonly kind: 'text-link'; readonly href: string | null}
    | {
          readonly kind: 'text-block-split'
          readonly leftText: string
          readonly rightText: string
          readonly newNodeId: SplitTextBlockIntent['newNodeId']
          readonly newKind: 'paragraph' | 'list-item'
      }

type PlannedSingleEdit =
    | {
          readonly status: 'ready'
          readonly patches: readonly Parameters<typeof applySourcePatches>[1][number][]
          readonly structuralChange: SourcePatchIntent['structuralChange']
          readonly verification: PlannedVerification
          readonly impacts: readonly EditImpact[]
      }
    | {readonly status: 'unchanged'}
    | {readonly status: 'rejected'; readonly diagnostics: readonly DocumentDiagnostic[]}

export function planPropertyEditBatch(
    environment: PropertyPlanningEnvironment,
    batch: EditBatch,
): PropertyPlanningResult {
    if (batch.baseAnalysis !== environment.initial.snapshot.stamp.id) {
        return rejected('stale-analysis', '编辑批次基于过期的文档分析版本。')
    }
    if (batch.intents.length > MAX_BATCH_INTENTS) {
        return rejected('edit-batch-limit', `单个编辑批次最多包含 ${MAX_BATCH_INTENTS} 项意图。`)
    }
    const coordinateIntent = batch.intents.find(
        intent => intent.kind === 'adopt-opaque-element' || intent.kind === 'apply-source-edits',
    )
    if (coordinateIntent && (batch.intents.length !== 1 || batch.intents[0] !== coordinateIntent)) {
        return rejected(
            'source-coordinate-intent-mixed-batch',
            '源码坐标意图必须作为独立原子意图提交；其内部 edit 共用请求起始快照。',
        )
    }
    const gridExpansion = expandGridTrackStructureIntents(environment.initial, batch.intents)
    if (gridExpansion.status === 'rejected') return gridExpansion
    const expansion = expandPropertyTakeovers(environment.initial, gridExpansion.intents)
    if (expansion.status === 'rejected') return expansion
    if (expansion.intents.length > MAX_BATCH_INTENTS) {
        return rejected(
            'edit-batch-expanded-limit',
            `接管迁移后的编辑批次最多包含 ${MAX_BATCH_INTENTS} 项意图。`,
        )
    }
    const authorizedScopes = new Set(batch.authorizedScopes)
    let current = environment.initial
    const patches: SourcePatchIntent[] = []
    const impacts: EditImpact[] = []
    const finalPropertyVerifications = new Map<string, PropertyEditIntent>()
    for (const intent of expansion.intents) {
        const before = current
        const planned = planSingleEdit(current, intent, authorizedScopes)
        if (planned.status === 'rejected') return planned
        if (planned.status === 'unchanged') continue
        const applied = applySourcePatches(current.snapshot.sourceSnapshot, planned.patches)
        if (applied.status === 'rejected') {
            return rejected(
                applied.failures[0]?.code ?? 'source-patch-rejected',
                applied.failures[0]?.message ?? '源码补丁未能原子应用。',
            )
        }
        if (applied.status === 'unchanged') continue
        patches.push(
            ...planned.patches.map(patch =>
                Object.freeze({
                    ...patch,
                    baseline: current.snapshot.sourceSnapshot.id,
                    structuralChange: planned.structuralChange,
                }),
            ),
        )
        const analyzed = environment.analyzeCandidate(applied.snapshot)
        const blocking = analyzed.snapshot.diagnostics.filter(item => item.severity === 'error')
        if (blocking.length > 0 || !analyzed.components || !analyzed.properties) {
            return {
                status: 'rejected',
                diagnostics: Object.freeze(
                    blocking.length > 0
                        ? blocking
                        : [diagnostic('candidate-analysis-failed', '候选无法建立可信组件模型。')],
                ),
            }
        }
        impacts.push(...planned.impacts)
        if (intent.kind === 'apply-source-edits') {
            if (planned.verification.kind !== 'source-edits') {
                return rejected('source-edit-verification-missing', '源码修改缺少候选后置条件。')
            }
            if (!before.components) {
                return rejected(
                    'source-edit-verification-missing',
                    '源码修改前缺少可核对的托管组件结构。',
                )
            }
            const structureMismatch = compareManagedComponentStructure(
                before.components,
                analyzed.components,
            )
            if (structureMismatch) {
                return rejected(
                    'source-edit-component-structure-mismatch',
                    `源码修改声明保留托管组件结构，但候选实际${describeManagedComponentStructureMismatch(structureMismatch)}。请改用对应的组件插入、删除、移动或转换操作。`,
                )
            }
            current = analyzed
            continue
        }
        if (planned.verification.kind === 'source-edits') {
            return rejected('source-edit-verification-missing', '非源码修改返回了错误的后置条件。')
        }
        if (planned.verification.kind === 'component-adopted') {
            if (
                intent.kind !== 'adopt-opaque-element' ||
                !verifyOpaqueElementAdoptionCandidate(analyzed.components, planned.verification)
            ) {
                return rejected(
                    'component-adoption-postcondition-failed',
                    '候选没有为源码元素建立来源与类型正确的唯一组件身份。',
                )
            }
            current = analyzed
            continue
        }
        if (planned.verification.kind === 'theme-token') {
            if (
                intent.kind !== 'edit-theme-token' ||
                !verifyThemeTokenCandidate(analyzed, planned.verification)
            ) {
                return rejected(
                    'theme-token-postcondition-failed',
                    '候选没有得到请求的本级主题令牌声明。',
                )
            }
            current = analyzed
            continue
        }
        if (intent.kind === 'adopt-opaque-element') {
            return rejected(
                'component-adoption-verification-missing',
                '源码元素接管缺少候选后置条件。',
            )
        }
        if (intent.kind === 'edit-theme-token') {
            return rejected('theme-token-verification-missing', '主题令牌修改缺少候选后置条件。')
        }
        const beforeHandle = rebindHandle(before.components, intent.target.component)
        if (!beforeHandle) {
            return rejected('edit-postcondition-target-missing', '修改前无法重新绑定编辑目标。')
        }
        if (planned.verification.kind === 'component-removed') {
            if (
                intent.kind !== 'remove-component' ||
                !verifyComponentRemovalCandidate(analyzed.components, planned.verification)
            ) {
                return rejected(
                    'component-removal-postcondition-failed',
                    '候选没有完整删除目标组件子树，或连带删除了其父组件。',
                    beforeHandle,
                )
            }
            current = analyzed
            continue
        }
        const afterHandle = rebindHandle(analyzed.components, intent.target.component)
        if (!afterHandle) {
            return rejected(
                'edit-postcondition-target-missing',
                '候选分析后无法重新绑定属性编辑目标。',
            )
        }
        if (planned.verification.kind === 'component-property') {
            if (intent.kind !== 'edit-property' || !before.properties) {
                return rejected('candidate-analysis-failed', '候选缺少属性分析器。')
            }
            // 同一批次可以先建立随后才会生效的条件基线，再清除行内固定值。
            // 中间候选仍须可分析，但属性写入只对整批最终候选验收；同一目的地以最后一次意图为准。
            finalPropertyVerifications.set(propertyVerificationKey(intent), intent)
            impacts.push(
                ...analyzePropertyEditImpacts({
                    before: before.properties,
                    after: analyzed.properties,
                    beforeHandle,
                    afterHandle,
                    intent,
                }),
            )
        } else if (planned.verification.kind === 'text-format') {
            if (
                intent.kind !== 'edit-property' ||
                !verifyTextFormatCandidate(analyzed, afterHandle, intent)
            ) {
                return rejected(
                    'text-format-postcondition-failed',
                    '候选没有把请求格式应用到完整选区。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'text-content') {
            if (
                intent.kind !== 'replace-text' ||
                !verifyTextContentCandidate(
                    analyzed,
                    afterHandle,
                    planned.verification.expectedText,
                )
            ) {
                return rejected(
                    'text-content-postcondition-failed',
                    '候选文本与替换意图不一致。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'text-link') {
            if (
                intent.kind !== 'set-link' ||
                !verifyTextLinkCandidate(analyzed, afterHandle, intent, planned.verification.href)
            ) {
                return rejected(
                    'text-link-postcondition-failed',
                    '候选链接与编辑意图不一致。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'component-visibility') {
            if (
                intent.kind !== 'set-component-visibility' ||
                !verifyComponentVisibilityCandidate(
                    analyzed.components,
                    afterHandle,
                    planned.verification.hidden,
                )
            ) {
                return rejected(
                    'component-visibility-postcondition-failed',
                    '候选没有得到请求的组件可见性。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'component-moved') {
            if (
                intent.kind !== 'move-component' ||
                !verifyComponentMoveCandidate(
                    analyzed.components,
                    afterHandle,
                    planned.verification,
                )
            ) {
                return rejected(
                    'component-move-postcondition-failed',
                    '候选没有形成请求的组件顺序或父子关系。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'component-inserted') {
            if (
                intent.kind !== 'insert-component' ||
                !verifyComponentInsertionCandidate(analyzed.components, planned.verification)
            ) {
                return rejected(
                    'component-insertion-postcondition-failed',
                    '候选没有在请求位置创建身份与结构完整的新组件。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'public-component-inserted') {
            if (
                intent.kind !== 'insert-public-component' ||
                !verifyPublicComponentInsertionCandidate(analyzed.components, planned.verification)
            ) {
                return rejected(
                    'public-component-insertion-postcondition-failed',
                    '候选没有在请求位置创建完整的公共组件实例。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'public-component-instance-edited') {
            if (
                intent.kind !== 'edit-public-component-instance' ||
                !verifyPublicComponentInstanceCandidate(analyzed.components, afterHandle, planned.verification)
            ) {
                return rejected(
                    'public-component-instance-postcondition-failed',
                    '候选没有保留公共组件实例并应用公开属性。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'grid-auto-placement') {
            if (
                intent.kind !== 'set-grid-auto-placement' ||
                !verifyGridAutoPlacementCandidate(
                    analyzed,
                    afterHandle,
                    planned.verification.parentNodeId,
                )
            ) {
                return rejected(
                    'grid-auto-placement-postcondition-failed',
                    '候选没有在全部标准视口中关闭此子项的显式网格位置。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'component-tag') {
            if (
                intent.kind !== 'set-component-tag' ||
                !verifyComponentTagCandidate(
                    analyzed.components,
                    afterHandle,
                    planned.verification.tag,
                )
            ) {
                return rejected(
                    'component-tag-postcondition-failed',
                    '候选没有得到请求的组件语义标签。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'asset-alt') {
            if (
                intent.kind !== 'set-asset-alt' ||
                !verifyAssetAltCandidate(analyzed.components, afterHandle, planned.verification.alt)
            ) {
                return rejected(
                    'asset-alt-postcondition-failed',
                    '候选没有得到请求的图片替代文本。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'asset-caption') {
            if (
                intent.kind !== 'set-asset-caption' ||
                !verifyAssetCaptionCandidate(
                    analyzed.components,
                    afterHandle,
                    planned.verification.caption,
                )
            ) {
                return rejected(
                    'asset-caption-postcondition-failed',
                    '候选没有得到请求的图片图注。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'asset-reference') {
            if (
                intent.kind !== 'set-asset-reference' ||
                !verifyAssetReferenceCandidate(
                    analyzed.components,
                    afterHandle,
                    planned.verification.assetId,
                )
            ) {
                return rejected(
                    'asset-reference-postcondition-failed',
                    '候选没有得到请求的图片资产引用。',
                    afterHandle,
                )
            }
        } else if (planned.verification.kind === 'table-size') {
            if (
                intent.kind !== 'resize-table' ||
                !verifyTableSizeCandidate(analyzed.components, afterHandle, planned.verification)
            ) {
                return rejected(
                    'table-size-postcondition-failed',
                    '候选没有形成请求的矩形表格结构。',
                    afterHandle,
                )
            }
        } else if (
            intent.kind !== 'split-text-block' ||
            !verifyTextBlockSplitCandidate(analyzed, afterHandle, planned.verification)
        ) {
            return rejected(
                'text-block-split-postcondition-failed',
                '候选没有形成身份独立且文本正确的后续文本块。',
                afterHandle,
            )
        }
        current = analyzed
    }
    for (const intent of finalPropertyVerifications.values()) {
        const handle = rebindHandle(current.components, intent.target.component)
        if (!handle || !current.properties) {
            return rejected(
                'edit-postcondition-target-missing',
                '最终候选中无法重新绑定属性编辑目标。',
            )
        }
        const postcondition = verifyPropertyEditPostcondition(current.properties, handle, intent)
        if (postcondition.status === 'failed') {
            return rejected(postcondition.code, postcondition.message, handle)
        }
    }
    const gridDiagnostics = validateGridLayoutPostconditions(
        current,
        expansion.intents.filter(
            (intent): intent is PropertyEditIntent => intent.kind === 'edit-property',
        ),
    )
    if (gridDiagnostics.length > 0) {
        return {status: 'rejected', diagnostics: gridDiagnostics}
    }
    const semanticGridDiagnostics = validateGridParentPostconditions(current, [
        ...expansion.intents.flatMap(intent =>
            intent.kind === 'set-grid-auto-placement' ? [intent.expectedParentNodeId] : [],
        ),
        ...batch.intents.flatMap(intent =>
            intent.kind === 'change-grid-track-structure' ? [intent.target.component.nodeId] : [],
        ),
    ])
    if (semanticGridDiagnostics.length > 0) {
        return {status: 'rejected', diagnostics: semanticGridDiagnostics}
    }
    return Object.freeze({
        status: patches.length > 0 ? 'ready' : 'unchanged',
        patches: Object.freeze(patches),
        impacts: Object.freeze(impacts),
        candidate: current,
    })
}

function propertyVerificationKey(intent: PropertyEditIntent): string {
    const channel = intent.destination.channel
    const destination =
        channel.kind === 'conditional-rule' ? `${channel.kind}:${channel.context}` : channel.kind
    return [
        intent.target.component.nodeId,
        intent.target.kind,
        intent.target.kind === 'semantic-part' ? intent.target.part : '',
        intent.property.toLowerCase(),
        intent.destination.scope,
        destination,
    ].join('\u0000')
}

function planSingleEdit(
    current: PlanningAnalysisRuntime,
    intent: EditIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (intent.kind === 'apply-source-edits') {
        return planSourceEdits(current, intent, authorizedScopes)
    }
    if (intent.kind === 'adopt-opaque-element') {
        return planOpaqueElementAdoption(current, intent, authorizedScopes)
    }
    if (intent.kind === 'edit-theme-token') {
        return planThemeTokenEdit(current, intent, authorizedScopes)
    }
    if (intent.kind === 'edit-property') {
        return planSinglePropertyEdit(current, intent, authorizedScopes)
    }
    if (intent.kind === 'replace-text') {
        return planTextReplacement(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-link') return planTextLinkEdit(current, intent, authorizedScopes)
    if (intent.kind === 'set-component-visibility') {
        return planComponentVisibility(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-component-tag') {
        return planComponentTag(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-asset-alt') {
        return planAssetAlt(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-asset-caption') {
        return planAssetCaption(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-asset-reference') {
        return planAssetReference(current, intent, authorizedScopes)
    }
    if (intent.kind === 'resize-table') {
        return planTableResize(current, intent, authorizedScopes)
    }
    if (intent.kind === 'remove-component') {
        return planComponentRemoval(current, intent, authorizedScopes)
    }
    if (intent.kind === 'move-component') {
        return planComponentMove(current, intent, authorizedScopes)
    }
    if (intent.kind === 'insert-component') {
        return planComponentInsertion(current, intent, authorizedScopes)
    }
    if (intent.kind === 'insert-public-component') {
        return planPublicComponentInsertion(current, intent, authorizedScopes)
    }
    if (intent.kind === 'edit-public-component-instance') {
        return planPublicComponentInstanceEdit(current, intent, authorizedScopes)
    }
    if (intent.kind === 'set-grid-auto-placement') {
        return planGridAutoPlacement(current, intent, authorizedScopes)
    }
    if (intent.kind === 'change-grid-track-structure') {
        return rejected('grid-track-structure-not-expanded', '轨道结构意图未经过语义展开。')
    }
    return planTextBlockSplit(current, intent, authorizedScopes)
}

function planSourceEdits(
    current: PlanningAnalysisRuntime,
    intent: ApplySourceEditsIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const patches: Parameters<typeof applySourcePatches>[1][number][] = []
    let structuralChange: SourcePatchIntent['structuralChange'] = 'none'
    for (const edit of intent.edits) {
        if (!hasWritableScope(authorizedScopes, edit.source.scope)) {
            return rejected('write-scope-denied', `未授权写入 ${edit.source.scope} 作用域。`)
        }
        const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(edit.source))
        if (!document) return rejected('source-not-found', '源码 edit 指向的逻辑文件不存在。')
        const range = utf16RangeFromUtf8ByteRange(document.content, edit.range)
        if (!range) {
            return rejected(
                'invalid-source-range',
                '源码 edit 的 UTF-8 字节区间无效或未落在字符边界。',
            )
        }
        patches.push(
            Object.freeze({
                source: edit.source,
                range,
                expected: edit.expected,
                insert: edit.insert,
            }),
        )
        if (edit.source.file === 'article.html') structuralChange = 'component-tree'
    }
    return readyPatches(Object.freeze(patches), structuralChange, {
        kind: 'source-edits',
        componentStructure: intent.componentStructure,
    })
}

function planThemeTokenEdit(
    current: PlanningAnalysisRuntime,
    intent: ThemeTokenEditIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const scope = intent.target.scope
    if (!hasWritableScope(authorizedScopes, scope)) {
        return rejected('write-scope-denied', `未授权写入 ${scope} 作用域。`)
    }
    if (!current.themeTokens) {
        return rejected('theme-token-analysis-unavailable', '当前候选缺少主题令牌分析。')
    }
    const before = current.themeTokens.inspect(scope, intent.property)
    if (!before?.writeDestination) {
        return rejected('theme-token-write-unavailable', '当前作用域不能写入主题令牌。')
    }
    const document = findDocument(
        current.snapshot.sourceSnapshot,
        sourceKeyString(before.writeDestination),
    )
    if (!document) return rejected('source-not-found', '主题令牌样式表不在当前快照中。')
    const value = intent.action.kind === 'set-value' ? intent.action.value : null
    const changed = createThemeTokenPatches(document, current.entryId, intent.property, value)
    if (changed.status === 'rejected') return rejected(changed.code, changed.message)
    if (changed.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches(changed.patches, 'none', {
        kind: 'theme-token',
        scope,
        property: intent.property,
        value,
    })
}

function planOpaqueElementAdoption(
    current: PlanningAnalysisRuntime,
    intent: AdoptOpaqueElementIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.source.scope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.source.scope} 作用域。`)
    }
    if (intent.source.file !== 'article.html') {
        return rejected('opaque-adoption-source-invalid', '源码节点接管只能写入 article.html。')
    }
    if (!current.components) return rejected('candidate-analysis-failed', '候选缺少组件索引。')
    if (current.components.bind([intent.newNodeId]).handles.length > 0) {
        return rejected('component-identity-conflict', '新组件身份已经被当前文档使用。')
    }
    const article = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(intent.source))
    if (!article) return rejected('source-not-found', '待接管的作者 HTML 不在当前快照中。')
    const adopted = createOpaqueElementAdoptionPatch(
        article,
        intent.range,
        intent.expected,
        intent.newNodeId,
        intent.componentKind,
    )
    if (adopted.status === 'rejected') return rejected(adopted.code, adopted.message)
    return readyPatches([adopted.patch], 'component-tree', {
        kind: 'component-adopted',
        newNodeId: intent.newNodeId,
        componentKind: intent.componentKind,
        source: intent.source,
    })
}

function planGridAutoPlacement(
    current: PlanningAnalysisRuntime,
    intent: SetGridAutoPlacementIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    if (!current.components || !current.properties) {
        return rejected('candidate-analysis-failed', '候选缺少组件与属性分析。')
    }
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle) return rejected('stale-component-handle', '网格子项已经失效。')
    if (!componentHasCapability(handle.kind, 'layout.child')) {
        return rejected(
            'grid-item-layout-unavailable',
            `${handle.kind} 不支持网格子项布局。`,
            handle,
        )
    }
    const descriptor = current.components.components.find(
        component => component.handle.nodeId === handle.nodeId,
    )
    if (!descriptor || descriptor.parentNodeId !== intent.expectedParentNodeId) {
        return rejected(
            'component-parent-precondition-failed',
            '网格子项的父容器已经变化。',
            handle,
        )
    }
    const parent = current.components.components.find(
        component => component.handle.nodeId === descriptor.parentNodeId,
    )
    if (!parent || parent.handle.kind !== 'container') {
        return rejected('grid-parent-missing', '网格子项没有可验证的布局容器父级。', handle)
    }
    const target = {kind: 'component-root' as const, component: handle}
    const hasApplicableGridContext = (['mobile', 'desktop'] as const).some(
        viewport =>
            current.properties?.inspectTarget(target, 'grid-column-start', {
                viewport,
                interactions: {hover: false, focusWithin: false},
                direction: 'unknown',
                writingMode: 'unknown',
            })?.applicability.kind === 'applicable',
    )
    if (!hasApplicableGridContext) {
        return rejected(
            'grid-parent-not-applicable',
            '父容器在标准视口中没有可证明的 Grid 布局。',
            handle,
        )
    }
    const element = current.components.resolveElement(handle)
    const origin = element ? current.components.originOfNode(element)?.source : null
    if (!element || !origin || origin.file !== 'article.html') {
        return rejected('source-origin-unavailable', '网格子项没有可写的作者 HTML 来源。', handle)
    }
    if (origin.scope !== intent.destinationScope) {
        return rejected('grid-item-scope-mismatch', '不能在另一作用域中改写网格子项。', handle)
    }
    const article = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(origin))
    if (!article) return rejected('source-not-found', '网格子项作者源码不在当前快照中。')
    const changed = createInlineStylePropertiesPatch(article, element, [
        {property: 'grid-area', value: null},
        {property: 'grid-column', value: null},
        {property: 'grid-row', value: null},
        {property: 'grid-column-start', value: 'auto'},
        {property: 'grid-column-end', value: 'auto'},
        {property: 'grid-row-start', value: 'auto'},
        {property: 'grid-row-end', value: 'auto'},
    ])
    if (changed.status === 'rejected') return rejected(changed.code, changed.message, handle)
    if (changed.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches([changed.patch], 'none', {
        kind: 'grid-auto-placement',
        parentNodeId: parent.handle.nodeId,
    })
}

function planComponentInsertion(
    current: PlanningAnalysisRuntime,
    intent: InsertComponentIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    if (!current.components) return rejected('candidate-analysis-failed', '候选缺少组件索引。')
    const parentHandle = rebindHandle(current.components, intent.target.component)
    const afterHandle = intent.after ? rebindHandle(current.components, intent.after) : null
    if (!parentHandle || (intent.after && !afterHandle)) {
        return rejected('stale-component-handle', '插入父级或相邻组件已经失效。')
    }
    const requiredCapability =
        parentHandle.kind === 'list' ? 'structure.list-items' : 'structure.children'
    if (!componentHasCapability(parentHandle.kind, requiredCapability)) {
        return rejected(
            'component-insertion-unavailable',
            `${parentHandle.kind} 不支持插入子组件。`,
            parentHandle,
        )
    }
    if (!componentDefinition(intent.componentKind).creation) {
        return rejected(
            'component-creation-unsupported',
            `${intent.componentKind} 不能独立创建。`,
            parentHandle,
        )
    }
    const newIds = [intent.newNodeId, ...intent.newChildNodeIds]
    if (
        new Set(newIds).size !== newIds.length ||
        current.components.components.some(component => newIds.includes(component.handle.nodeId))
    ) {
        return rejected('component-identity-conflict', '新组件身份重复或已被当前文档使用。')
    }
    const policy = checkComponentInsertionPolicy(
        current.components,
        parentHandle,
        afterHandle,
        intent.componentKind,
        intent.destinationScope,
    )
    if (policy.status === 'rejected') return rejected(policy.code, policy.message, parentHandle)
    const destinationKey = `${intent.destinationScope}:article.html`
    if (sourceKeyString(policy.childList.source) !== destinationKey) {
        return rejected(
            'component-insertion-source-mismatch',
            '插入位置不属于请求的作者 HTML 作用域。',
            parentHandle,
        )
    }
    const article = findDocument(current.snapshot.sourceSnapshot, destinationKey)
    const stylesheet = findDocument(
        current.snapshot.sourceSnapshot,
        `${intent.destinationScope}:style.css`,
    )
    const after = afterHandle ? current.components.resolveElement(afterHandle) : null
    if (!article || !stylesheet || (afterHandle && !after)) {
        return rejected('source-not-found', '组件插入所需的作者源码不完整。', parentHandle)
    }
    const inserted = createComponentInsertionPatches(
        article,
        stylesheet,
        policy.childList.sourceContainer,
        after,
        intent.componentKind,
        intent.newNodeId,
        intent.newChildNodeIds,
        intent.assetId,
    )
    if (inserted.status === 'rejected') {
        return rejected(inserted.code, inserted.message, parentHandle)
    }
    return readyPatches(inserted.patches, 'component-tree', {
        kind: 'component-inserted',
        componentKind: intent.componentKind,
        newNodeId: intent.newNodeId,
        newChildNodeIds: intent.newChildNodeIds,
        parentNodeId: parentHandle.nodeId,
        previousSiblingNodeId: afterHandle?.nodeId ?? null,
    })
}

function planPublicComponentInsertion(
    current: PlanningAnalysisRuntime,
    intent: InsertPublicComponentIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    if (!current.components) return rejected('candidate-analysis-failed', '候选缺少组件索引。')
    const definition = selectPublicComponentDefinition(
        current.componentDefinitions,
        intent.componentId,
        String(intent.revision),
    )
    if (!definition) {
        return rejected('component-definition-not-found', '公共组件定义或指定修订不存在。')
    }
    const parentHandle = rebindHandle(current.components, intent.target.component)
    const afterHandle = intent.after ? rebindHandle(current.components, intent.after) : null
    if (!parentHandle || (intent.after && !afterHandle)) {
        return rejected('stale-component-handle', '插入父级或相邻组件已经失效。')
    }
    if (!componentHasCapability(parentHandle.kind, 'structure.children')) {
        return rejected('component-insertion-unavailable', `${parentHandle.kind} 不支持插入公共组件。`, parentHandle)
    }
    if (intent.instanceId === intent.newNodeId) {
        return rejected('component-instance-identity-conflict', '组件页面节点与实例身份必须彼此独立。')
    }
    if (current.components.components.some(component => component.handle.nodeId === intent.newNodeId)) {
        return rejected('component-identity-conflict', '新公共组件页面节点身份已经被当前文档使用。')
    }
    const policy = checkComponentInsertionPolicy(
        current.components,
        parentHandle,
        afterHandle,
        'component',
        intent.destinationScope,
    )
    if (policy.status === 'rejected') return rejected(policy.code, policy.message, parentHandle)
    const destinationKey = `${intent.destinationScope}:article.html`
    if (sourceKeyString(policy.childList.source) !== destinationKey) {
        return rejected('component-insertion-source-mismatch', '插入位置不属于请求的作者 HTML 作用域。', parentHandle)
    }
    const article = findDocument(current.snapshot.sourceSnapshot, destinationKey)
    const after = afterHandle ? current.components.resolveElement(afterHandle) : null
    if (!article || (afterHandle && !after)) {
        return rejected('source-not-found', '公共组件插入所需的作者源码不完整。', parentHandle)
    }
    const patch = createPublicComponentInsertionPatch(
        article,
        policy.childList.sourceContainer,
        after,
        intent.componentId,
        intent.revision,
        intent.instanceId,
        intent.newNodeId,
        intent.properties,
        intent.parts,
    )
    if ('status' in patch) return rejected(patch.code, patch.message, parentHandle)
    return readyPatches([patch], 'component-tree', {
        kind: 'public-component-inserted',
        componentId: intent.componentId,
        revision: intent.revision,
        instanceId: intent.instanceId,
        newNodeId: intent.newNodeId,
        parentNodeId: parentHandle.nodeId,
        previousSiblingNodeId: afterHandle?.nodeId ?? null,
    })
}

function planPublicComponentInstanceEdit(
    current: PlanningAnalysisRuntime,
    intent: EditPublicComponentInstanceIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    if (!current.components) return rejected('candidate-analysis-failed', '候选缺少组件索引。')
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || handle.kind !== 'component') {
        return rejected('public-component-instance-required', '只能修改公共组件实例的公开属性。', handle ?? undefined)
    }
    const element = current.components.resolveElement(handle)
    const source = element ? current.components.originOfNode(element)?.source : null
    if (!element || !source || source.scope !== intent.destinationScope || source.file !== 'article.html') {
        return rejected('source-origin-unavailable', '公共组件实例没有可写的词条 HTML 来源。', handle)
    }
    const componentId = element.attrs.find(item => item.name === 'data-fc-component')?.value
    const definition = selectPublicComponentDefinition(
        current.componentDefinitions,
        componentId,
        element.attrs.find(item => item.name === 'data-fc-component-revision')?.value,
    )
    if (!definition) return rejected('component-definition-not-found', '公共组件定义不存在。', handle)
    const propertyNames = new Set(definition.propertySchema.map(item => item.name))
    if (Object.keys(intent.properties).some(name => !propertyNames.has(name))) {
        return rejected('component-property-not-declared', '只能修改公共组件定义声明的属性。', handle)
    }
    const styleNames = new Set(definition.styleVariableSchema.map(item => item.name))
    if (Object.keys(intent.styleVariables).some(name => !styleNames.has(name))) {
        return rejected('component-style-variable-not-declared', '只能修改公共组件定义声明的样式变量。', handle)
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '公共组件实例作者源码不在当前快照中。', handle)
    const changed = createPublicComponentInstancePatches(document, element, intent.properties, intent.styleVariables)
    if (changed.status === 'rejected') return rejected(changed.code, changed.message, handle)
    if (changed.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches(changed.patches, 'none', {
        kind: 'public-component-instance-edited',
        properties: intent.properties,
        styleVariables: intent.styleVariables,
    })
}

function planComponentMove(
    current: PlanningAnalysisRuntime,
    intent: MoveComponentIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    if (!current.components) return rejected('candidate-analysis-failed', '候选缺少组件索引。')
    const targetHandle = rebindHandle(current.components, intent.target.component)
    const parentHandle = rebindHandle(current.components, intent.parent)
    const afterHandle = intent.after ? rebindHandle(current.components, intent.after) : null
    if (!targetHandle || !parentHandle || (intent.after && !afterHandle)) {
        return rejected('stale-component-handle', '移动目标、父级或相邻组件已经失效。')
    }
    if (!componentHasCapability(targetHandle.kind, 'structure.move')) {
        return rejected(
            'component-move-unavailable',
            `${targetHandle.kind} 不支持移动。`,
            targetHandle,
        )
    }
    const policy = checkComponentMovePolicy(
        current.components,
        targetHandle,
        parentHandle,
        afterHandle,
    )
    if (policy.status === 'rejected') return rejected(policy.code, policy.message, targetHandle)
    const previous =
        policy.current.currentIndex > 0
            ? policy.current.siblingNodeIds[policy.current.currentIndex - 1]
            : null
    if (
        policy.current.parentNodeId !== intent.expectedParentNodeId ||
        previous !== intent.expectedPreviousSiblingNodeId
    ) {
        return rejected(
            'component-position-precondition-failed',
            '组件当前位置已经变化。',
            targetHandle,
        )
    }
    const desiredPrevious = afterHandle?.nodeId ?? null
    if (parentHandle.nodeId === policy.current.parentNodeId && desiredPrevious === previous) {
        return {status: 'unchanged'}
    }

    const target = current.components.resolveElement(targetHandle)
    const after = afterHandle ? current.components.resolveElement(afterHandle) : null
    const targetOrigin = target ? current.components.originOfNode(target) : null
    const destinationKey = `${intent.destinationScope}:article.html`
    if (
        !target ||
        (afterHandle && !after) ||
        targetOrigin?.kind !== 'author' ||
        !targetOrigin.source ||
        sourceKeyString(targetOrigin.source) !== destinationKey ||
        sourceKeyString(policy.destination.source) !== destinationKey
    ) {
        return rejected(
            'component-move-source-mismatch',
            '移动目标、父级与相邻组件必须位于同一份可写作者 HTML 中。',
            targetHandle,
        )
    }
    const article = findDocument(current.snapshot.sourceSnapshot, destinationKey)
    if (!article) return rejected('source-not-found', '组件作者源码不在当前快照中。')
    const moved = createComponentMovePatches(
        article,
        target,
        policy.destination.sourceContainer,
        after,
    )
    if (moved.status === 'rejected') return rejected(moved.code, moved.message, targetHandle)
    return readyPatches(moved.patches, 'component-tree', {
        kind: 'component-moved',
        parentNodeId: parentHandle.nodeId,
        previousSiblingNodeId: desiredPrevious,
    })
}

function planComponentRemoval(
    current: PlanningAnalysisRuntime,
    intent: RemoveComponentIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'structure.remove')) {
        return rejected('component-removal-unavailable', `${handle.kind} 不支持删除。`, handle)
    }
    const policy = checkComponentRemovalPolicy(current.components, handle)
    if (policy.status === 'rejected') return rejected(policy.code, policy.message, handle)
    if (policy.parentNodeId !== intent.expectedParentNodeId) {
        return rejected('component-parent-precondition-failed', '目标组件的父级已经变化。', handle)
    }
    const element = current.components.resolveElement(handle)
    const origin = element ? current.components.originOfNode(element)?.source : null
    if (!element || !origin || origin.file !== 'article.html') {
        return rejected('source-origin-unavailable', '组件没有可写的作者 HTML 来源。', handle)
    }
    if (origin.scope !== intent.destinationScope) {
        return rejected(
            'component-removal-scope-mismatch',
            '不能在另一作用域中删除此组件。',
            handle,
        )
    }
    const article = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(origin))
    const style = findDocument(
        current.snapshot.sourceSnapshot,
        `${intent.destinationScope}:style.css`,
    )
    if (!article || !style) return rejected('source-not-found', '组件作者源码不在当前快照中。')
    const html = createComponentRemovalPatch(article, element)
    if (html.status === 'rejected') return rejected(html.code, html.message, handle)
    const cleanup = createManagedNodeRuleRemovalPatches(style, html.removedNodeIds)
    if (cleanup.status === 'rejected') return rejected(cleanup.code, cleanup.message, handle)
    const patches = [html.patch]
    if (cleanup.status === 'ready') patches.push(...cleanup.patches)
    return readyPatches(
        patches,
        'component-tree',
        {
            kind: 'component-removed',
            removedNodeIds: html.removedNodeIds,
            parentNodeId: policy.parentNodeId,
            degradedReferenceCount: html.remappedReferences.filter(reference => reference.degraded).length,
        },
        [
            Object.freeze({
                code: 'component-content-removed',
                message: `将删除此组件及其 ${Math.max(0, html.removedNodeIds.length - 1)} 个托管子组件；相关内容与独占样式可通过撤销恢复。`,
                requiresDecision: true,
            }),
        ],
    )
}

function planTableResize(
    current: PlanningAnalysisRuntime,
    intent: ResizeTableIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标表格已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'structure.table-size')) {
        return rejected('table-size-unavailable', `${handle.kind} 不支持表格行列调整。`, handle)
    }
    const element = current.components.resolveElement(handle)
    const origin = element ? current.components.originOfNode(element)?.source : null
    if (!element || !origin || origin.file !== 'article.html') {
        return rejected('source-origin-unavailable', '表格没有可写的作者 HTML 来源。')
    }
    if (origin.scope !== intent.destinationScope) {
        return rejected('table-size-scope-mismatch', '不能在另一作用域中直接修改模板表格。', handle)
    }
    const article = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(origin))
    if (!article) return rejected('source-not-found', '表格作者源码不在当前快照中。')
    const html = createTableStructurePatches(
        article,
        element,
        {rowCount: intent.expectedRowCount, columnCount: intent.expectedColumnCount},
        {rowCount: intent.rowCount, columnCount: intent.columnCount},
        intent.newCellNodeIds,
    )
    if (html.status === 'rejected') return rejected(html.code, html.message, handle)
    if (html.status === 'unchanged') return {status: 'unchanged'}

    const patches = [...html.patches]
    const style = findDocument(
        current.snapshot.sourceSnapshot,
        `${intent.destinationScope}:style.css`,
    )
    if (!style) return rejected('source-not-found', '表格样式源码不在当前快照中。')
    const cleanup = createManagedNodeRuleRemovalPatches(style, html.removedNodeIds)
    if (cleanup.status === 'rejected') return rejected(cleanup.code, cleanup.message, handle)
    if (cleanup.status === 'ready') patches.push(...cleanup.patches)
    const shrinking =
        intent.rowCount < intent.expectedRowCount || intent.columnCount < intent.expectedColumnCount
    return readyPatches(
        patches,
        'component-tree',
        {
            kind: 'table-size',
            rowCount: intent.rowCount,
            columnCount: intent.columnCount,
            newCellNodeIds: intent.newCellNodeIds,
            removedNodeIds: html.removedNodeIds,
        },
        shrinking
            ? [
                  Object.freeze({
                      code: 'table-cells-removed',
                      message: `表格将由 ${intent.expectedRowCount}×${intent.expectedColumnCount} 缩减为 ${intent.rowCount}×${intent.columnCount}；超出范围的单元格、文字与受管样式将被删除。`,
                      requiresDecision: true,
                  }),
              ]
            : [],
    )
}

function planAssetReference(
    current: PlanningAnalysisRuntime,
    intent: AssetReferenceIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const target = resolveAssetContentTarget(
        current,
        intent.target.component,
        intent.destinationScope,
        authorizedScopes,
        'asset.reference',
    )
    if ('status' in target) return target
    const images = current.components?.resolveSemanticPart(target.handle, 'asset-image')
    const image = images?.length === 1 ? images[0] : null
    if (!image) return rejected('asset-image-unavailable', '图片组件没有唯一的内部图片。')
    const patched = createAssetReferencePatches(
        target.document,
        image,
        intent.expected,
        intent.assetId,
    )
    if (patched.status === 'rejected') return rejected(patched.code, patched.message, target.handle)
    if (patched.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches(patched.patches, 'none', {
        kind: 'asset-reference',
        assetId: intent.assetId,
    })
}

function planAssetAlt(
    current: PlanningAnalysisRuntime,
    intent: AssetAltIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const target = resolveAssetContentTarget(
        current,
        intent.target.component,
        intent.destinationScope,
        authorizedScopes,
        'asset.alt',
    )
    if ('status' in target) return target
    const images = current.components?.resolveSemanticPart(target.handle, 'asset-image')
    const image = images?.length === 1 ? images[0] : null
    if (!image) return rejected('asset-image-unavailable', '图片组件没有唯一的内部图片。')
    const patched = createAssetAltPatch(target.document, image, intent.expectedAlt, intent.alt)
    if (patched.status === 'rejected') return rejected(patched.code, patched.message, target.handle)
    if (patched.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches([patched.patch], 'none', {kind: 'asset-alt', alt: intent.alt})
}

function planAssetCaption(
    current: PlanningAnalysisRuntime,
    intent: AssetCaptionIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const target = resolveAssetContentTarget(
        current,
        intent.target.component,
        intent.destinationScope,
        authorizedScopes,
        'asset.caption',
    )
    if ('status' in target) return target
    const patched = createAssetCaptionPatch(
        target.document,
        target.element,
        intent.expected,
        intent.caption,
    )
    if (patched.status === 'rejected') return rejected(patched.code, patched.message, target.handle)
    if (patched.status === 'unchanged') return {status: 'unchanged'}
    const caption = intent.caption === null ? null : normalizeAssetText(intent.caption)
    return readyPatches(
        [patched.patch],
        'component-tree',
        {kind: 'asset-caption', caption},
        patched.replacedStructuredContent
            ? [
                  Object.freeze({
                      code: 'asset-caption-structured-replacement',
                      message: '当前图注含有行内格式或自定义标记；继续后会替换为普通文字。',
                      requiresDecision: true,
                  }),
              ]
            : [],
    )
}

function resolveAssetContentTarget(
    current: PlanningAnalysisRuntime,
    originalHandle: ComponentHandle,
    destinationScope: SourceScope,
    authorizedScopes: ReadonlySet<SourceScope>,
    capability: 'asset.alt' | 'asset.caption' | 'asset.reference',
):
    | {
          readonly handle: ComponentHandle
          readonly element: NonNullable<ReturnType<ComponentIndex['resolveElement']>>
          readonly document: SourceDocument
      }
    | Extract<PropertyPlanningResult, {status: 'rejected'}> {
    if (!hasWritableScope(authorizedScopes, destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${destinationScope} 作用域。`)
    }
    const handle = rebindHandle(current.components, originalHandle)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, capability)) {
        return rejected(
            'asset-content-unavailable',
            `${handle.kind} 不支持该图片内容编辑。`,
            handle,
        )
    }
    const element = current.components.resolveElement(handle)
    const source = element ? current.components.originOfNode(element)?.source : null
    if (!element || !source || source.file !== 'article.html') {
        return rejected('source-origin-unavailable', '图片组件没有可写的作者 HTML 来源。')
    }
    if (source.scope !== destinationScope) {
        return rejected(
            'asset-content-scope-mismatch',
            '不能在另一作用域中直接修改模板图片内容。',
            handle,
        )
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    return document
        ? Object.freeze({handle, element, document})
        : rejected('source-not-found', '目标作者源码不在当前快照中。')
}

function planComponentTag(
    current: PlanningAnalysisRuntime,
    intent: ComponentTagIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'structure.tag')) {
        return rejected('component-tag-unavailable', `${handle.kind} 不支持转换语义标签。`, handle)
    }
    const allowedTags = componentDefinition(handle.kind).conversionTags
    if (!allowedTags.includes(intent.expectedTag) || !allowedTags.includes(intent.tag)) {
        return rejected(
            'component-tag-kind-mismatch',
            `${handle.kind} 不支持转换为 ${intent.tag}。`,
            handle,
        )
    }
    const element = current.components.resolveElement(handle)
    const source = element ? current.components.originOfNode(element)?.source : null
    if (!element || !source || source.file !== 'article.html') {
        return rejected('source-origin-unavailable', '目标组件没有可写的作者 HTML 来源。')
    }
    if (source.scope !== intent.destinationScope) {
        return rejected(
            'component-tag-scope-mismatch',
            '不能在另一作用域中直接转换模板组件的语义标签。',
            handle,
        )
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。')
    const patched = createComponentTagPatches(document, element, intent.expectedTag, intent.tag)
    if (patched.status === 'rejected') return rejected(patched.code, patched.message, handle)
    if (patched.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches(patched.patches, 'component-tree', {
        kind: 'component-tag',
        tag: intent.tag,
    })
}

function planComponentVisibility(
    current: PlanningAnalysisRuntime,
    intent: ComponentVisibilityIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!hasWritableScope(authorizedScopes, intent.destinationScope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destinationScope} 作用域。`)
    }
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'structure.visibility')) {
        return rejected(
            'component-visibility-unavailable',
            `${handle.kind} 不支持切换组件可见性。`,
            handle,
        )
    }
    const policy = checkComponentVisibilityPolicy(current.components, handle, intent.hidden)
    if (policy.status === 'rejected') return rejected(policy.code, policy.message, handle)
    const element = current.components.resolveElement(handle)
    const source = element ? current.components.originOfNode(element)?.source : null
    if (!element || !source || source.file !== 'article.html') {
        return rejected('source-origin-unavailable', '目标组件没有可写的作者 HTML 来源。')
    }
    if (source.scope !== intent.destinationScope) {
        return rejected(
            'visibility-scope-mismatch',
            '不能在另一作用域中直接改变模板组件的 hidden 属性。',
            handle,
        )
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。')
    const patched = createComponentVisibilityPatch(
        document,
        element,
        intent.expectedHidden,
        intent.hidden,
    )
    if (patched.status === 'rejected') return rejected(patched.code, patched.message, handle)
    if (patched.status === 'unchanged') return {status: 'unchanged'}
    return readyPatches([patched.patch], 'none', {
        kind: 'component-visibility',
        hidden: intent.hidden,
    })
}

function planSinglePropertyEdit(
    current: PlanningAnalysisRuntime,
    intent: PropertyEditIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    if (!PROPERTY_PATTERN.test(intent.property)) {
        return rejected('invalid-property-name', 'CSS 属性名无效。')
    }
    const property = intent.property.startsWith('--')
        ? intent.property
        : intent.property.toLowerCase()
    if (!isDirectlyEditableProperty(property)) {
        return rejected('unsupported-property', `属性 ${property} 尚未进入受控写入范围。`)
    }
    const originalHandle = intent.target.component
    const handle = rebindHandle(current.components, originalHandle)
    if (!handle || !current.properties || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    try {
        preserveNodeIdentity({id: handle.nodeId, kind: handle.kind}, handle.kind)
    } catch (error) {
        return rejected(
            'node-identity-preservation-failed',
            error instanceof Error ? error.message : '属性编辑不能改变节点身份。',
            handle,
        )
    }
    if (!propertyCapabilityForComponent(handle.kind, intent.target.kind, property)) {
        return rejected(
            'property-capability-unavailable',
            `${handle.kind} 的 ${intent.target.kind} 目标不支持属性 ${property}。`,
            handle,
        )
    }
    if (!hasWritableScope(authorizedScopes, intent.destination.scope)) {
        return rejected('write-scope-denied', `未授权写入 ${intent.destination.scope} 作用域。`)
    }
    if (intent.target.kind === 'text-range') {
        return planTextRangePropertyEdit(current, handle, intent, intent.target)
    }
    const target = styleTarget(intent.target, handle)
    if (!target) return rejected('unsupported-edit-target', '当前属性写入目标不受支持。')
    const inspection = current.properties.inspectTarget(target, property, intent.readContext)
    if (!inspection) return rejected('stale-component-handle', '目标组件无法重新绑定。')
    if (intent.action.kind !== 'clear-override' && inspection.applicability.kind !== 'applicable') {
        return rejected(
            'property-not-applicable',
            inspection.applicability.reason ?? `属性 ${property} 当前不适用。`,
        )
    }
    if (!inspection.writeDestinations.some(item => sameDestination(item, intent.destination))) {
        return rejected('write-destination-unavailable', '当前目标不能写入指定位置。')
    }
    const element = resolveStyleTargetElement(current.components, target)
    const value = intent.action.kind === 'set-value' ? intent.action.value : null
    if (intent.destination.channel.kind === 'inline') {
        const source = element ? current.components.originOfNode(element)?.source : null
        if (!element || !source || source.file !== 'article.html') {
            return rejected('source-origin-unavailable', '目标组件没有可写的作者 HTML 来源。')
        }
        if (source.scope !== intent.destination.scope) {
            return rejected(
                'inline-scope-mismatch',
                '不能通过行内写入修改另一作用域的模板节点；请建立当前作用域规则覆盖。',
            )
        }
        const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
        if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。')
        const patch = createInlineStylePropertyPatch(document, element, property, value)
        if (patch.status === 'rejected') return rejected(patch.code, patch.message, handle)
        if (patch.status === 'unchanged') return {status: 'unchanged'}
        return readyPatches([patch.patch], 'none', {kind: 'component-property'})
    }
    const stylesheet = findDocument(
        current.snapshot.sourceSnapshot,
        `${intent.destination.scope}:style.css`,
    )
    if (!stylesheet) return rejected('source-not-found', '目标样式表不在当前快照中。')
    let rulePatches = createManagedRulePropertyPatches(
        stylesheet,
        handle.nodeId,
        handle.kind,
        intent.destination.channel,
        property,
        value,
        target.kind === 'semantic-part' ? (target.part as ComponentSemanticPartId) : null,
    )
    if (rulePatches.status === 'rejected') {
        return rejected(rulePatches.code, rulePatches.message, handle)
    }
    if (rulePatches.status === 'unchanged') {
        if (
            intent.action.kind === 'set-value' &&
            verifyPropertyEditPostcondition(current.properties, handle, intent).status === 'failed'
        ) {
            rulePatches = createManagedRulePropertyPatches(
                stylesheet,
                handle.nodeId,
                handle.kind,
                intent.destination.channel,
                property,
                value,
                target.kind === 'semantic-part' ? (target.part as ComponentSemanticPartId) : null,
                {forceWinningWrite: true},
            )
            if (rulePatches.status === 'rejected') {
                return rejected(rulePatches.code, rulePatches.message, handle)
            }
        }
        if (rulePatches.status === 'unchanged') return {status: 'unchanged'}
    }
    return readyPatches(rulePatches.patches, 'none', {kind: 'component-property'})
}

function styleTarget(
    target: EditTarget,
    handle: ComponentHandle,
): Extract<EditTarget, {readonly kind: 'component-root' | 'semantic-part'}> | null {
    if (target.kind === 'text-range') return null
    return target.kind === 'semantic-part'
        ? Object.freeze({kind: 'semantic-part', component: handle, part: target.part})
        : Object.freeze({kind: 'component-root', component: handle})
}

function resolveStyleTargetElement(
    components: ComponentIndex,
    target: Extract<EditTarget, {readonly kind: 'component-root' | 'semantic-part'}>,
) {
    if (target.kind === 'component-root') return components.resolveElement(target.component)
    const descriptor = components
        .query()
        .find(component => component.handle.handleId === target.component.handleId)
    const part = descriptor?.semanticParts.find(candidate => candidate.id === target.part)
    if (!part || part.status !== 'resolved') return null
    const definitionPart = target.part as Parameters<typeof components.resolveSemanticPart>[1]
    const elements = components.resolveSemanticPart(target.component, definitionPart)
    return elements?.length === 1 ? elements[0] : null
}

function planTextRangePropertyEdit(
    current: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    intent: PropertyEditIntent,
    target: Extract<PropertyEditIntent['target'], {kind: 'text-range'}>,
):
    | ReturnType<typeof readyPatches>
    | {readonly status: 'unchanged'}
    | Extract<PropertyPlanningResult, {status: 'rejected'}> {
    if (intent.destination.channel.kind !== 'inline') {
        return rejected('text-format-destination-invalid', '文本选区格式只能写入行内包装。', handle)
    }
    const source = handle.origin.source
    const element = current.components?.resolveElement(handle)
    if (
        !source ||
        source.file !== 'article.html' ||
        !element ||
        !current.components ||
        !current.properties
    ) {
        return rejected('source-origin-unavailable', '文本组件没有可写的作者 HTML 来源。', handle)
    }
    if (source.scope !== intent.destination.scope) {
        return rejected('inline-scope-mismatch', '不能在词条作用域改写项目模板的文本结构。', handle)
    }
    const propertyAnalyzer = current.properties
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。', handle)
    const result = createTextRangeStylePatches(
        document,
        element,
        node => current.components?.originOfNode(node) ?? null,
        target.range,
        target.expected,
        intent.property,
        intent.action.kind === 'set-value' ? intent.action.value : null,
        (element, property) =>
            propertyAnalyzer.inspectElement(element, property, intent.readContext),
    )
    if (result.status === 'rejected') return rejected(result.code, result.message, handle)
    if (result.status === 'unchanged') return result
    return readyPatches(result.patches, 'inline-wrapper', {kind: 'text-format'})
}

function planTextReplacement(
    current: PlanningAnalysisRuntime,
    intent: TextReplacementIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'content.text')) {
        return rejected('text-content-not-supported', `${handle.kind} 不支持文本内容编辑。`, handle)
    }
    try {
        preserveNodeIdentity({id: handle.nodeId, kind: handle.kind}, handle.kind)
    } catch (error) {
        return rejected(
            'node-identity-preservation-failed',
            error instanceof Error ? error.message : '文本编辑不能改变节点身份。',
            handle,
        )
    }
    const source = handle.origin.source
    const element = current.components.resolveElement(handle)
    if (!source || source.file !== 'article.html' || !element) {
        return rejected('source-origin-unavailable', '文本组件没有作者 HTML 来源。', handle)
    }
    if (!hasWritableScope(authorizedScopes, source.scope)) {
        return rejected('write-scope-denied', `未授权写入 ${source.scope} 作用域。`, handle)
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。', handle)
    const result = createTextReplacementPatches(
        document,
        element,
        node => current.components?.originOfNode(node) ?? null,
        intent.target.range,
        intent.target.expected,
        intent.text,
    )
    if (result.status === 'rejected') return rejected(result.code, result.message, handle)
    if (result.status === 'unchanged') return result
    return readyPatches(result.patches, 'inline-wrapper', {
        kind: 'text-content',
        expectedText: result.expectedText,
    })
}

function planTextLinkEdit(
    current: PlanningAnalysisRuntime,
    intent: LinkEditIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'format.inline')) {
        return rejected('text-link-not-supported', `${handle.kind} 不支持文本链接。`, handle)
    }
    const source = handle.origin.source
    const element = current.components.resolveElement(handle)
    if (!source || source.file !== 'article.html' || !element) {
        return rejected('source-origin-unavailable', '文本组件没有作者 HTML 来源。', handle)
    }
    if (!hasWritableScope(authorizedScopes, source.scope)) {
        return rejected('write-scope-denied', `未授权写入 ${source.scope} 作用域。`, handle)
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。', handle)
    const result = createTextRangeLinkPatches(
        document,
        element,
        node => current.components?.originOfNode(node) ?? null,
        intent.target.range,
        intent.target.expected,
        intent.href,
    )
    if (result.status === 'rejected') return rejected(result.code, result.message, handle)
    if (result.status === 'unchanged') return result
    return readyPatches(result.patches, 'inline-wrapper', {
        kind: 'text-link',
        href: intent.href,
    })
}

function planTextBlockSplit(
    current: PlanningAnalysisRuntime,
    intent: SplitTextBlockIntent,
    authorizedScopes: ReadonlySet<SourceScope>,
): PlannedSingleEdit {
    const handle = rebindHandle(current.components, intent.target.component)
    if (!handle || !current.components) {
        return rejected('stale-component-handle', '目标组件已删除、改型或身份发生变化。')
    }
    if (!componentHasCapability(handle.kind, 'structure.split')) {
        return rejected('text-block-split-not-supported', `${handle.kind} 不支持创建后续文本块。`)
    }
    if (
        Number(intent.target.range.from) !== Number(intent.target.range.to) ||
        intent.target.expected
    ) {
        return rejected(
            'text-block-split-selection-not-collapsed',
            '创建新文本块前须先用同批次文本替换删除当前选区。',
            handle,
        )
    }
    const existing = current.components.bind([intent.newNodeId])
    if (
        existing.handles.length > 0 ||
        existing.failures[0]?.code === 'component-identity-ambiguous'
    ) {
        return rejected('duplicate-node-id', '新文本块身份已被当前文档占用。', handle)
    }
    const source = handle.origin.source
    const element = current.components.resolveElement(handle)
    if (!source || source.file !== 'article.html' || !element) {
        return rejected('source-origin-unavailable', '文本组件没有作者 HTML 来源。', handle)
    }
    if (!hasWritableScope(authorizedScopes, source.scope)) {
        return rejected('write-scope-denied', `未授权写入 ${source.scope} 作用域。`, handle)
    }
    const document = findDocument(current.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return rejected('source-not-found', '目标作者源码不在当前快照中。', handle)
    let splitIdentity
    try {
        splitIdentity = planTextBlockSplitIdentity(handle.nodeId, intent.newNodeId)
    } catch (error) {
        return rejected(
            'node-identity-allocation-invalid',
            error instanceof Error ? error.message : '文本块分裂身份无效。',
            handle,
        )
    }
    const result = createTextBlockSplitPatches(
        document,
        element,
        node => current.components?.originOfNode(node) ?? null,
        handle.kind,
        Number(intent.target.range.from),
        splitIdentity.rightNodeId,
    )
    if (result.status === 'rejected') return rejected(result.code, result.message, handle)
    return readyPatches(result.patches, 'component-tree', {
        kind: 'text-block-split',
        leftText: result.leftText,
        rightText: result.rightText,
        newNodeId: intent.newNodeId,
        newKind: result.newKind,
    })
}

function verifyTextFormatCandidate(
    analyzed: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    intent: PropertyEditIntent,
): boolean {
    if (intent.target.kind !== 'text-range') return false
    const source = handle.origin.source
    const element = analyzed.components?.resolveElement(handle)
    if (!source || !element || !analyzed.components || !analyzed.properties) return false
    const document = findDocument(analyzed.snapshot.sourceSnapshot, sourceKeyString(source))
    if (!document) return false
    const propertyAnalyzer = analyzed.properties
    const originOfNode = (node: Parameters<typeof analyzed.components.originOfNode>[0]) =>
        analyzed.components?.originOfNode(node) ?? null
    return intent.action.kind === 'set-value'
        ? textRangeHasStyle(
              document,
              element,
              originOfNode,
              intent.target.range,
              intent.target.expected,
              intent.property,
              intent.action.value,
              (element, property) =>
                  propertyAnalyzer.inspectElement(element, property, intent.readContext),
          )
        : textRangeHasNoManagedOverride(
              document,
              element,
              originOfNode,
              intent.target.range,
              intent.target.expected,
              intent.property,
              (element, property) =>
                  propertyAnalyzer.inspectElement(element, property, intent.readContext),
          )
}

function verifyTextContentCandidate(
    analyzed: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    expectedText: string,
): boolean {
    const source = handle.origin.source
    const element = analyzed.components?.resolveElement(handle)
    if (!source || !element || !analyzed.components) return false
    const document = findDocument(analyzed.snapshot.sourceSnapshot, sourceKeyString(source))
    return document
        ? componentTextEquals(
              document,
              element,
              node => analyzed.components?.originOfNode(node) ?? null,
              expectedText,
          )
        : false
}

function verifyTextLinkCandidate(
    analyzed: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    intent: LinkEditIntent,
    href: string | null,
): boolean {
    const source = handle.origin.source
    const element = analyzed.components?.resolveElement(handle)
    if (!source || !element || !analyzed.components) return false
    const document = findDocument(analyzed.snapshot.sourceSnapshot, sourceKeyString(source))
    return document
        ? textRangeHasHref(
              document,
              element,
              node => analyzed.components?.originOfNode(node) ?? null,
              intent.target.range,
              intent.target.expected,
              href,
          )
        : false
}

function verifyTextBlockSplitCandidate(
    analyzed: PlanningAnalysisRuntime,
    oldHandle: ComponentHandle,
    verification: Extract<PlannedVerification, {readonly kind: 'text-block-split'}>,
): boolean {
    if (!analyzed.components) return false
    const next = analyzed.components.bind([verification.newNodeId]).handles[0]
    if (!next || next.kind !== verification.newKind || next.nodeId === oldHandle.nodeId)
        return false
    const oldSource = oldHandle.origin.source
    const nextSource = next.origin.source
    const oldElement = analyzed.components.resolveElement(oldHandle)
    const nextElement = analyzed.components.resolveElement(next)
    if (!oldSource || !nextSource || !oldElement || !nextElement) return false
    if (sourceKeyString(oldSource) !== sourceKeyString(nextSource)) return false
    const document = findDocument(analyzed.snapshot.sourceSnapshot, sourceKeyString(oldSource))
    if (!document) return false
    const originOfNode = (node: Parameters<typeof analyzed.components.originOfNode>[0]) =>
        analyzed.components?.originOfNode(node) ?? null
    return (
        componentTextEquals(document, oldElement, originOfNode, verification.leftText) &&
        componentTextEquals(document, nextElement, originOfNode, verification.rightText)
    )
}

function verifyComponentVisibilityCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    hidden: boolean,
): boolean {
    const element = components?.resolveElement(handle)
    return (
        Boolean(element) && element?.attrs.some(attribute => attribute.name === 'hidden') === hidden
    )
}

function verifyGridAutoPlacementCandidate(
    analyzed: PlanningAnalysisRuntime,
    handle: ComponentHandle,
    parentNodeId: NodeId,
): boolean {
    if (!analyzed.components || !analyzed.properties) return false
    const descriptor = analyzed.components.components.find(
        component => component.handle.nodeId === handle.nodeId,
    )
    if (descriptor?.parentNodeId !== parentNodeId) return false
    const target = {kind: 'component-root' as const, component: handle}
    return (['mobile', 'desktop'] as const).every(viewport =>
        ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end'].every(
            property => {
                const inspection = analyzed.properties?.inspectTarget(target, property, {
                    viewport,
                    interactions: {hover: false, focusWithin: false},
                    direction: 'unknown',
                    writingMode: 'unknown',
                })
                const value =
                    inspection?.effectiveValue?.resolvedValue ??
                    inspection?.effectiveValue?.rawValue
                return inspection?.confidence.kind === 'proven' && value?.trim() === 'auto'
            },
        ),
    )
}

function verifyComponentTagCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    tag: ComponentTagIntent['tag'],
): boolean {
    return components?.resolveElement(handle)?.tagName === tag
}

function verifyAssetAltCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    alt: string,
): boolean {
    const images = components?.resolveSemanticPart(handle, 'asset-image')
    return (
        images?.length === 1 &&
        images[0].attrs.find(attribute => attribute.name === 'alt')?.value === alt
    )
}

function verifyAssetCaptionCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    caption: string | null,
): boolean {
    const root = components?.resolveElement(handle)
    if (!root) return false
    const state = readAssetCaptionState(root)
    if (state.status === 'rejected') return false
    if (caption === null) return state.state.kind === 'absent'
    return state.state.kind === 'plain' && state.state.text === normalizeAssetText(caption)
}

function verifyAssetReferenceCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    assetId: string,
): boolean {
    const images = components?.resolveSemanticPart(handle, 'asset-image')
    if (images?.length !== 1) return false
    const reference = readAssetReferenceExpectation(images[0])
    const normalized = assetId.toLowerCase()
    return reference.src === `fcasset://${normalized}` && reference.assetId === normalized
}

function verifyTableSizeCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    expected: Extract<PlannedVerification, {readonly kind: 'table-size'}>,
): boolean {
    const table = components?.resolveElement(handle)
    if (!components || !table) return false
    const structure = readManagedTableStructure(table)
    if (
        !structure ||
        structure.rows.length !== expected.rowCount ||
        structure.columnCount !== expected.columnCount
    ) {
        return false
    }
    const children = components.query({parentNodeId: handle.nodeId, kinds: ['table-cell']})
    const childIds = new Set(children.map(child => child.handle.nodeId))
    return (
        children.length === expected.rowCount * expected.columnCount &&
        expected.newCellNodeIds.every(id => childIds.has(id as ComponentHandle['nodeId'])) &&
        expected.removedNodeIds.every(id => !childIds.has(id as ComponentHandle['nodeId']))
    )
}

function verifyComponentRemovalCandidate(
    components: ComponentIndex | null,
    expected: Extract<PlannedVerification, {readonly kind: 'component-removed'}>,
): boolean {
    if (!components) return false
    const removed = components.bind(expected.removedNodeIds)
    const parent = components.bind([expected.parentNodeId])
    return removed.handles.length === 0 && parent.handles.length === 1
}

function verifyComponentMoveCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    expected: Extract<PlannedVerification, {readonly kind: 'component-moved'}>,
): boolean {
    if (!components) return false
    const movement = inspectComponentMovementPolicy(components, handle)
    if (movement.status === 'rejected' || movement.parentNodeId !== expected.parentNodeId) {
        return false
    }
    const previous =
        movement.currentIndex > 0 ? movement.siblingNodeIds[movement.currentIndex - 1] : null
    return previous === expected.previousSiblingNodeId
}

function verifyComponentInsertionCandidate(
    components: ComponentIndex | null,
    expected: Extract<PlannedVerification, {readonly kind: 'component-inserted'}>,
): boolean {
    if (!components) return false
    const created = components.bind([expected.newNodeId]).handles[0]
    if (!created || created.kind !== expected.componentKind) return false
    const movement = inspectComponentMovementPolicy(components, created)
    if (movement.status === 'rejected' || movement.parentNodeId !== expected.parentNodeId) {
        return false
    }
    const previous =
        movement.currentIndex > 0 ? movement.siblingNodeIds[movement.currentIndex - 1] : null
    if (previous !== expected.previousSiblingNodeId) return false
    if (expected.newChildNodeIds.length === 0) return true
    const descriptor = components.components.find(
        component => component.handle.handleId === created.handleId,
    )
    if (!descriptor) return false
    const expectedChildKind = expected.componentKind === 'list' ? 'list-item' : 'table-cell'
    const children = components.bind(expected.newChildNodeIds)
    return (
        children.failures.length === 0 &&
        children.handles.length === expected.newChildNodeIds.length &&
        children.handles.every(handle => handle.kind === expectedChildKind) &&
        expected.newChildNodeIds.every(id => descriptor.childNodeIds.includes(id))
    )
}

function verifyPublicComponentInsertionCandidate(
    components: ComponentIndex | null,
    expected: Extract<PlannedVerification, {readonly kind: 'public-component-inserted'}>,
): boolean {
    if (!components) return false
    const binding = components.bind([expected.newNodeId])
    const handle = binding.handles[0]
    if (
        binding.failures.length > 0 ||
        !handle ||
        handle.kind !== 'component' ||
        handle.instanceId !== expected.instanceId
    ) {
        return false
    }
    const movement = inspectComponentMovementPolicy(components, handle)
    if (movement.status === 'rejected' || movement.parentNodeId !== expected.parentNodeId) {
        return false
    }
    const previous = movement.currentIndex > 0 ? movement.siblingNodeIds[movement.currentIndex - 1] : null
    return previous === expected.previousSiblingNodeId
}

function verifyPublicComponentInstanceCandidate(
    components: ComponentIndex | null,
    handle: ComponentHandle,
    expected: Extract<PlannedVerification, {readonly kind: 'public-component-instance-edited'}>,
): boolean {
    if (!components || handle.kind !== 'component') return false
    const element = components.resolveElement(handle)
    if (!element) return false
    for (const [name, value] of Object.entries(expected.properties)) {
        const actual = element.attrs.find(item => item.name === `data-fc-prop-${name}`)?.value
        if ((value ?? null) !== (actual ?? null)) return false
    }
    for (const [name, value] of Object.entries(expected.styleVariables)) {
        const style = element.attrs.find(item => item.name === 'style')?.value ?? ''
        const declaration = style.split(';').map(item => item.trim()).find(item => item.toLowerCase().startsWith(`${name.toLowerCase()}:`))
        const actual = declaration ? declaration.slice(declaration.indexOf(':') + 1).trim() : null
        if ((value ?? null) !== actual) return false
    }
    return true
}

function verifyOpaqueElementAdoptionCandidate(
    components: ComponentIndex,
    expected: Extract<PlannedVerification, {readonly kind: 'component-adopted'}>,
): boolean {
    const binding = components.bind([expected.newNodeId])
    const handle = binding.handles[0]
    return Boolean(
        binding.failures.length === 0 &&
        binding.handles.length === 1 &&
        handle?.kind === expected.componentKind &&
        handle.origin.kind === 'author' &&
        handle.origin.source?.scope === expected.source.scope &&
        handle.origin.source.file === expected.source.file,
    )
}

function verifyThemeTokenCandidate(
    analyzed: PlanningAnalysisRuntime,
    expected: Extract<PlannedVerification, {readonly kind: 'theme-token'}>,
): boolean {
    if (expected.scope === 'component') return false
    const inspection = analyzed.themeTokens?.inspect(expected.scope, expected.property)
    if (!inspection) return false
    const actual = inspection.managedValue?.rawValue ?? null
    if (actual !== expected.value || expected.value === null) return actual === expected.value
    if (inspection.confidence.kind !== 'proven') return true
    const effective = inspection.effectiveValue
    if (expected.scope === 'project' && effective?.origin.source?.scope === 'entry') return true
    return (effective?.resolvedValue ?? effective?.rawValue ?? null) === expected.value
}

function normalizeAssetText(value: string): string {
    return value.replace(/\r\n?/gu, '\n').replaceAll('\0', '\uFFFD')
}

function readyPatches(
    patches: readonly Parameters<typeof applySourcePatches>[1][number][],
    structuralChange: SourcePatchIntent['structuralChange'],
    verification: PlannedVerification,
    impacts: readonly EditImpact[] = [],
) {
    return {status: 'ready' as const, patches, structuralChange, verification, impacts}
}

function rebindHandle(
    components: ComponentIndex | null,
    previous: ComponentHandle,
): ComponentHandle | null {
    if (!components) return null
    const bound = components.bind([previous.nodeId])
    const handle = bound.handles[0]
    return handle?.kind === previous.kind ? handle : null
}

function sameDestination(
    left: PropertyEditIntent['destination'],
    right: PropertyEditIntent['destination'],
): boolean {
    if (left.scope !== right.scope || left.channel.kind !== right.channel.kind) return false
    return (
        left.channel.kind !== 'conditional-rule' ||
        (right.channel.kind === 'conditional-rule' &&
            left.channel.context === right.channel.context)
    )
}

function findDocument(snapshot: SourceSnapshot, key: string): SourceDocument | null {
    return snapshot.documents.find(document => sourceKeyString(document.key) === key) ?? null
}

function rejected(
    code: string,
    message: string,
    handle?: ComponentHandle,
): Extract<PropertyPlanningResult, {readonly status: 'rejected'}> {
    return Object.freeze({
        status: 'rejected',
        diagnostics: Object.freeze([diagnostic(code, message, handle)]),
    })
}

function diagnostic(code: string, message: string, handle?: ComponentHandle): DocumentDiagnostic {
    return Object.freeze({
        severity: 'error',
        category: 'capability',
        code,
        message,
        nodeId: handle?.nodeId,
    })
}

function hasWritableScope(scopes: ReadonlySet<SourceScope>, scope: SourceScope): boolean {
    if (scope === 'component') return false
    return scopes.has(scope)
}
