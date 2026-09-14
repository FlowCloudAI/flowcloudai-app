// 本模块定义不可变分析版本与属性级状态；未知信息只能沿真实依赖影响对应属性。

import type {DocumentDiagnostic} from '../../contract.ts'
import type {AnalysisStampId} from './identity.ts'
import type {DependencySet, ReadContext, WriteDestination} from './context.ts'
import type {
    SourceKey,
    SourceOrigin,
    SourceScope,
    SourceSnapshot,
    Utf16SourceRange,
} from './source.ts'

export interface AnalysisStamp {
    readonly id: AnalysisStampId
    readonly snapshotId: SourceSnapshot['id']
    readonly metadataHash: string
    readonly assetHash: string
    readonly componentRegistryVersion: string
    readonly policyVersion: string
}

export type PropertyApplicability =
    | {readonly kind: 'applicable'}
    | {readonly kind: 'not-applicable'; readonly reason: string}
    | {readonly kind: 'unknown'; readonly reason: string}

export type PropertyConfidence =
    | {readonly kind: 'proven'}
    | {readonly kind: 'partial'; readonly reason: string}
    | {readonly kind: 'unknown'; readonly reason: string}

export type PropertyValueCapability =
    | {readonly kind: 'editable'; readonly normalizedValue: unknown}
    | {readonly kind: 'read-only'; readonly rawValue: string; readonly reason: string}
    | {readonly kind: 'absent'}

export type AuthorConditionState = 'active' | 'inactive' | 'indeterminate'

export interface AuthorDeclarationState {
    readonly id: string
    readonly property: string
    readonly declaredProperty: string
    readonly rawValue: string
    readonly resolvedValue: string | null
    readonly important: boolean
    readonly sourceKind: 'stylesheet' | 'inline'
    readonly selector: string | null
    readonly layer: string | null
    readonly media: string | null
    readonly origin: SourceOrigin
    readonly condition: AuthorConditionState
    readonly reason: string | null
}

export interface EffectiveAuthorValue {
    readonly property: string
    readonly declaredProperty: string
    readonly rawValue: string
    readonly resolvedValue: string | null
    readonly origin: SourceOrigin
    readonly inherited: boolean
}

export interface PropertyInspection {
    readonly propertyFamily: string
    readonly context: ReadContext
    readonly directDeclarations: readonly AuthorDeclarationState[]
    readonly effectiveValue: EffectiveAuthorValue | null
    readonly applicability: PropertyApplicability
    readonly confidence: PropertyConfidence
    readonly valueCapability: PropertyValueCapability
    readonly writeDestinations: readonly WriteDestination[]
    readonly dependencies: DependencySet
    readonly diagnostics: readonly DocumentDiagnostic[]
}

export interface ThemeTokenInspection {
    readonly propertyFamily: string
    readonly scope: SourceScope
    /** 当前作用域规范受管根规则中的声明，不含其他选择器或其他 layer。 */
    readonly managedDeclarations: readonly AuthorDeclarationState[]
    readonly managedValue: EffectiveAuthorValue | null
    /** 当前词条组合页面实际生效的作者值；编辑项目模板时可能仍被词条覆盖。 */
    readonly effectiveValue: EffectiveAuthorValue | null
    readonly relatedDeclarations: readonly AuthorDeclarationState[]
    readonly confidence: PropertyConfidence
    readonly valueCapability: PropertyValueCapability
    readonly writeDestination: SourceKey | null
    readonly dependencies: DependencySet
    readonly diagnostics: readonly DocumentDiagnostic[]
}

export interface TextRangeValueSegment {
    readonly range: Utf16SourceRange
    readonly value: string | null
    /** 排除编辑器专属行内包装后，由作者源码与语义标签共同决定的值。 */
    readonly valueWithoutManagedOverride: string | null
    readonly textOrigin: SourceOrigin
    /** 当前属性值是否由编辑器专属的行内格式包装直接覆盖。 */
    readonly managedOverride: boolean
}

export type TextRangeValueState =
    | {readonly kind: 'uniform'; readonly value: string | null}
    | {readonly kind: 'mixed'; readonly values: readonly (string | null)[]}

export interface TextRangePropertyInspection {
    readonly propertyFamily: string
    readonly range: Utf16SourceRange
    readonly selectedText: string
    readonly valueState: TextRangeValueState
    readonly segments: readonly TextRangeValueSegment[]
    readonly dependencies: DependencySet
    readonly diagnostics: readonly DocumentDiagnostic[]
}

export interface TextRangeLinkSegment {
    readonly range: Utf16SourceRange
    readonly href: string | null
    readonly textOrigin: SourceOrigin
    readonly linkOrigin: SourceOrigin | null
}

export interface TextRangeLinkInspection {
    readonly range: Utf16SourceRange
    readonly selectedText: string
    readonly valueState: TextRangeValueState
    readonly segments: readonly TextRangeLinkSegment[]
    readonly dependencies: DependencySet
    readonly diagnostics: readonly DocumentDiagnostic[]
}

export interface DocumentAnalysisSnapshot {
    readonly sourceSnapshot: SourceSnapshot
    readonly stamp: AnalysisStamp
    readonly diagnostics: readonly DocumentDiagnostic[]
}
