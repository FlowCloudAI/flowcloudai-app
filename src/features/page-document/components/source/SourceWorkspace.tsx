// 本组件组织 HTML/CSS 页签、诊断、基线差异与实时画布；它只通过会话回调修改内存草稿。

import {forwardRef, useImperativeHandle, useMemo, useRef, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import type {DocumentDiagnostic, SourceFileName, SourceFileSet} from '../../domain/contract.ts'
import {PageDocumentCanvas} from '../../canvas/host/PageDocumentCanvas.tsx'
import type {CompiledCanvasPreview} from '../../canvas/host/compiledPreview.ts'
import {
    CodeSourceEditor,
    type CodeSourceEditorHandle,
    type CodeSourceEditorHistory,
} from './CodeSourceEditor.tsx'
import {createSourceDiff} from './sourceDiff.ts'

const SOURCE_FILES: Array<{file: SourceFileName; label: string}> = [
    {file: 'article.html', label: 'article.html'},
    {file: 'style.css', label: 'style.css'},
]

interface SourceWorkspaceProps {
    documentKey: string
    projectId: string
    sources: SourceFileSet
    baseSources: SourceFileSet
    conflictSources?: SourceFileSet | null
    diagnostics: readonly DocumentDiagnostic[]
    preview: CompiledCanvasPreview | null
    previewStale: boolean
    onSourceChange: (file: SourceFileName, value: string) => void
    onNavigationIntent: (href: string) => void
    onHistoryChange: (history: CodeSourceEditorHistory) => void
}

export interface SourceWorkspaceHandle {
    undo: () => boolean
    redo: () => boolean
}

export const SourceWorkspace = forwardRef<SourceWorkspaceHandle, SourceWorkspaceProps>(
function SourceWorkspace({
    documentKey,
    projectId,
    sources,
    baseSources,
    conflictSources = null,
    diagnostics,
    preview,
    previewStale,
    onSourceChange,
    onNavigationIntent,
    onHistoryChange,
}, ref) {
    const [activeFile, setActiveFile] = useState<SourceFileName>('article.html')
    const [showDiff, setShowDiff] = useState(false)
    const editorRef = useRef<CodeSourceEditorHandle>(null)
    const activeDiagnostics = diagnostics.filter(item => !item.file || item.file === activeFile)
    const comparisonSources = conflictSources ?? baseSources
    const diff = useMemo(
        () => createSourceDiff(comparisonSources[activeFile], sources[activeFile]),
        [activeFile, comparisonSources, sources],
    )

    useImperativeHandle(ref, () => ({
        undo: () => editorRef.current?.undo() ?? false,
        redo: () => editorRef.current?.redo() ?? false,
    }), [])

    return (
        <section className="page-document-source-workspace">
            <div className="page-document-source-workspace__editor">
                <header className="page-document-source-workspace__tabs">
                    {SOURCE_FILES.map(item => (
                        <button
                            key={item.file}
                            type="button"
                            className={activeFile === item.file ? 'is-active' : ''}
                            aria-pressed={activeFile === item.file}
                            onClick={() => setActiveFile(item.file)}
                        >
                            {item.label}
                        </button>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowDiff(current => !current)}
                    >
                        {showDiff ? '返回源码' : `查看差异 +${diff.addedLines} −${diff.removedLines}`}
                    </Button>
                </header>

                <div className="page-document-source-workspace__code">
                    {showDiff ? (
                        <div className="page-document-source-diff" aria-label={`${activeFile} 差异`}>
                            {diff.rows.length === 0 ? (
                                <p>当前文件与{conflictSources ? '磁盘最新版本' : '保存基线'}一致。</p>
                            ) : diff.rows.map((row, index) => (
                                <div
                                    key={`${row.kind}:${row.oldLine}:${row.newLine}:${index}`}
                                    className={`page-document-source-diff__row is-${row.kind}`}
                                >
                                    <span>{row.oldLine ?? ''}</span>
                                    <span>{row.newLine ?? ''}</span>
                                    <code>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}{row.text}</code>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <CodeSourceEditor
                            ref={editorRef}
                            file={activeFile}
                            value={sources[activeFile]}
                            diagnostics={diagnostics}
                            onChange={value => onSourceChange(activeFile, value)}
                            onHistoryChange={onHistoryChange}
                        />
                    )}
                </div>

                <section className="page-document-diagnostics" aria-label="页面文档诊断">
                    <strong>诊断 · {activeDiagnostics.length}</strong>
                    {activeDiagnostics.length === 0 ? (
                        <span>当前文件没有诊断。</span>
                    ) : (
                        <ul>
                            {activeDiagnostics.map((item, index) => (
                                <li key={`${item.code}:${item.range?.from ?? -1}:${index}`} data-severity={item.severity}>
                                    <code>{item.code}</code>
                                    <span>{item.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>

            <aside className="page-document-source-workspace__preview">
                <header>
                    <strong>实时预览</strong>
                    {previewStale && <span role="status">预览未更新</span>}
                </header>
                <div className="page-document-source-workspace__preview-canvas">
                    {preview?.html != null && preview.css != null ? (
                        <PageDocumentCanvas
                            documentKey={documentKey}
                            projectId={projectId}
                            html={preview.html}
                            css={preview.css}
                            minimumHeight={420}
                            onNavigationIntent={onNavigationIntent}
                        />
                    ) : (
                        <p>当前没有可渲染的合法结果。</p>
                    )}
                </div>
            </aside>
        </section>
    )
})
