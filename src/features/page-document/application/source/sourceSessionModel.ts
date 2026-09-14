// 本模块定义源码工作台从统一内存文档模型读取的视图类型；状态转移只存在于 documentDraftModel。
import type {
    DocumentDiagnostic,
    DocumentSourceStatus,
    SourceFileName,
    SourceFileSet,
} from '../../domain/contract.ts'

export type SourceEditorScope = 'project' | 'entry'
export type SourceEditorPhase = 'clean' | 'dirty' | 'saving' | 'conflict' | 'failed'
export type SourceValidationPhase = 'valid' | 'pending' | 'validating' | 'invalid' | 'failed'

export interface SourceDraftModel {
    scope: SourceEditorScope
    activeFile: SourceFileName
    baseRevision: number
    baseTemplateVersion: number
    baseSources: SourceFileSet
    baseDiagnostics: DocumentDiagnostic[]
    sources: SourceFileSet
    latestRevision: number
    latestTemplateVersion: number
    latestSources: SourceFileSet
    sourceStatus: DocumentSourceStatus
    phase: SourceEditorPhase
    validationPhase: SourceValidationPhase
    diagnostics: DocumentDiagnostic[]
    error: string | null
    conflictCode: string | null
}
