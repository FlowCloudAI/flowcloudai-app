// 本组件封装 CodeMirror 的源码输入与诊断标记；保存、冲突和预览仍由页面文档会话管理。

import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react'
import {redo, redoDepth, undo, undoDepth} from '@codemirror/commands'
import {Compartment, type Extension} from '@codemirror/state'
import {lintGutter, setDiagnostics, type Diagnostic} from '@codemirror/lint'
import {EditorView, basicSetup} from 'codemirror'
import type {DocumentDiagnostic, SourceFileName} from '../../domain/contract.ts'

interface CodeSourceEditorProps {
    file: SourceFileName
    value: string
    diagnostics: readonly DocumentDiagnostic[]
    onChange: (value: string) => void
    onHistoryChange: (history: CodeSourceEditorHistory) => void
}

export interface CodeSourceEditorHistory {
    canUndo: boolean
    canRedo: boolean
}

export interface CodeSourceEditorHandle {
    undo: () => boolean
    redo: () => boolean
}

const editorTheme = EditorView.theme({
    '&': {
        height: '100%',
        backgroundColor: 'transparent',
        color: 'var(--fc-color-text)',
        fontSize: '13px',
    },
    '.cm-scroller': {
        fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
        lineHeight: '1.6',
        overflow: 'auto',
    },
    '.cm-content': {padding: '12px 0 32px'},
    '.cm-gutters': {
        backgroundColor: 'var(--fc-color-bg-secondary)',
        borderRight: '1px solid var(--fc-color-border-light)',
        color: 'var(--fc-color-text-tertiary)',
    },
    '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in srgb, var(--fc-color-primary) 9%, transparent)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--fc-color-primary) 28%, transparent) !important',
    },
    '.cm-cursor': {borderLeftColor: 'var(--fc-color-primary)'},
    '.cm-tooltip': {
        backgroundColor: 'var(--fc-color-bg-elevated)',
        border: '1px solid var(--fc-color-border)',
        color: 'var(--fc-color-text)',
    },
})

function codeMirrorDiagnostics(
    diagnostics: readonly DocumentDiagnostic[],
    file: SourceFileName,
    documentLength: number,
): Diagnostic[] {
    return diagnostics.flatMap(item => {
        if (item.file !== file || !item.range) return []
        const from = Math.max(0, Math.min(documentLength, item.range.from))
        const to = Math.max(from, Math.min(documentLength, item.range.to))
        return [{from, to, severity: item.severity, message: item.message, source: item.code}]
    })
}

async function loadLanguage(file: SourceFileName): Promise<Extension> {
    return file === 'article.html'
        ? (await import('@codemirror/lang-html')).html()
        : (await import('@codemirror/lang-css')).css()
}

export const CodeSourceEditor = forwardRef<CodeSourceEditorHandle, CodeSourceEditorProps>(
function CodeSourceEditor({file, value, diagnostics, onChange, onHistoryChange}, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const externalUpdateRef = useRef(false)
    const onChangeRef = useRef(onChange)
    const onHistoryChangeRef = useRef(onHistoryChange)
    const valueRef = useRef(value)
    const diagnosticsRef = useRef(diagnostics)
    const editableCompartmentRef = useRef(new Compartment())

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])
    useEffect(() => {
        onHistoryChangeRef.current = onHistoryChange
    }, [onHistoryChange])
    useEffect(() => {
        valueRef.current = value
    }, [value])
    useEffect(() => {
        diagnosticsRef.current = diagnostics
    }, [diagnostics])

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        let cancelled = false
        let view: EditorView | null = null
        void loadLanguage(file).then(language => {
            if (cancelled) return
            view = new EditorView({
                doc: valueRef.current,
                parent: host,
                extensions: [
                    basicSetup,
                    language,
                    lintGutter(),
                    EditorView.lineWrapping,
                    editorTheme,
                    editableCompartmentRef.current.of(EditorView.editable.of(true)),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged && !externalUpdateRef.current) {
                            onChangeRef.current(update.state.doc.toString())
                        }
                        if (update.transactions.length > 0) {
                            onHistoryChangeRef.current({
                                canUndo: undoDepth(update.state) > 0,
                                canRedo: redoDepth(update.state) > 0,
                            })
                        }
                    }),
                ],
            })
            viewRef.current = view
            onHistoryChangeRef.current({canUndo: false, canRedo: false})
            view.dispatch(setDiagnostics(
                view.state,
                codeMirrorDiagnostics(diagnosticsRef.current, file, view.state.doc.length),
            ))
        })
        return () => {
            cancelled = true
            if (viewRef.current === view) viewRef.current = null
            view?.destroy()
            onHistoryChangeRef.current({canUndo: false, canRedo: false})
        }
    }, [file])

    useImperativeHandle(ref, () => ({
        undo: () => Boolean(viewRef.current && undo(viewRef.current)),
        redo: () => Boolean(viewRef.current && redo(viewRef.current)),
    }), [])

    useEffect(() => {
        const view = viewRef.current
        if (!view || view.state.doc.toString() === value) return
        externalUpdateRef.current = true
        view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: value}})
        externalUpdateRef.current = false
    }, [value])

    useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch(setDiagnostics(
            view.state,
            codeMirrorDiagnostics(diagnostics, file, view.state.doc.length),
        ))
    }, [diagnostics, file, value])

    return <div ref={hostRef} className="page-document-code-editor" aria-label={`${file} 源码编辑器`} />
})
