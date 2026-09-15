// 本组件提供页面文档第一批编辑壳层；只编辑独立 HTML/CSS，并把保存交给页面文档会话。

import {useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from 'flowcloudai-ui'
import {useEntryPageDocumentSession} from '../hooks/useEntryPageDocumentSession.ts'
import type {SourceFileSet} from '../domain/contract.ts'
import {createLayerProjection} from '../domain/layerProjection.ts'
import {
    findLayerNode,
    resolveVisualSelection,
    type VisualSelectionSource,
} from '../application/visualSelectionModel.ts'
import {PageDocumentCanvas} from '../canvas/host/PageDocumentCanvas.tsx'
import {SourceWorkspace, type SourceWorkspaceHandle} from './source/SourceWorkspace.tsx'
import {PageDocumentLayerTree} from './layers/PageDocumentLayerTree.tsx'
import {PageDocumentPropertiesPanel} from './properties/PageDocumentPropertiesPanel.tsx'
import type {PageDocumentEditorEntryProps} from '../editor/entry/types.ts'
import {
    setActivePageDocumentWorkspace,
    usePageDocumentWorkspace,
} from '../editor/workspace/pageDocumentWorkspaceStore.ts'
import {resolvePageDocumentEditorLoadView} from './pageDocumentEditorLoadState.ts'
import {
    shouldForwardPageDocumentNavigation,
    shouldOccupyPageDocumentSharedHost,
    type PageDocumentWorkspaceMode,
} from './pageDocumentEditorWorkspacePolicy.ts'
import './PageDocumentEditor.css'

function validationLabel(phase: string): string {
    if (phase === 'valid') return '校验通过'
    if (phase === 'pending') return '等待校验'
    if (phase === 'validating') return '正在校验…'
    if (phase === 'invalid') return '存在阻断诊断'
    return '校验失败'
}

function sourceSetFromConflict(html: string, css: string): SourceFileSet {
    return {'article.html': html, 'style.css': css}
}

export function PageDocumentEditor(props: PageDocumentEditorEntryProps) {
    const {
        entryId,
        projectId,
        categoryId,
        active,
        title,
        summary,
        markdown,
        resetVersion,
        onDirtyChange,
        onNavigationIntent,
        onRequestLeave,
    } = props
    const [mode, setMode] = useState<PageDocumentWorkspaceMode>('visual')
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [sourceHistory, setSourceHistory] = useState({canUndo: false, canRedo: false})
    const sourceWorkspaceRef = useRef<SourceWorkspaceHandle>(null)
    const session = useEntryPageDocumentSession({
        entryId,
        projectId,
        title,
        summary,
        markdown,
    })
    const {state} = session
    const {canSave, dirty, discard, save} = session
    const {
        active: activeWorkspace,
        sidebarHost,
        dockHost,
    } = usePageDocumentWorkspace()
    const appliedResetVersionRef = useRef(resetVersion)

    useEffect(() => {
        onDirtyChange(dirty)
    }, [dirty, onDirtyChange])

    useEffect(() => () => onDirtyChange(false), [onDirtyChange])

    useEffect(() => {
        if (!active) return
        return setActivePageDocumentWorkspace({
            projectId,
            entryId,
            categoryId,
            dirty,
            requestLeave: onRequestLeave,
        })
    }, [active, categoryId, dirty, entryId, onRequestLeave, projectId])

    useEffect(() => {
        if (resetVersion === appliedResetVersionRef.current) return
        appliedResetVersionRef.current = resetVersion
        discard()
    }, [discard, resetVersion])

    useEffect(() => {
        if (!active) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey ||
                !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's'
            ) return
            event.preventDefault()
            if (canSave) void save()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [active, canSave, save])

    const saveStatus = useMemo(() => {
        if (!state) return '正在读取页面文档…'
        if (state.model.entry.phase === 'saving') return '保存中…'
        if (state.model.entry.phase === 'conflict') return '版本冲突'
        if (state.model.entry.phase === 'failed') return '保存失败'
        if (state.persistedRevision === undefined) return '未保存'
        if (dirty) return '未保存'
        return `已保存 · r${state.persistedRevision}`
    }, [dirty, state])
    const canUndo = mode === 'code' ? sourceHistory.canUndo : session.canUndo
    const canRedo = mode === 'code' ? sourceHistory.canRedo : session.canRedo
    const loadView = resolvePageDocumentEditorLoadView(session.loadStatus, Boolean(state))
    const layerProjection = useMemo(
        () => createLayerProjection(state?.model.entry.sources['article.html'] ?? ''),
        [state?.model.entry.sources],
    )

    useEffect(() => {
        if (selectedNodeId === null) return
        if (resolveVisualSelection(layerProjection.nodes, selectedNodeId, 'layer') === null) {
            setSelectedNodeId(null)
        }
    }, [layerProjection.nodes, selectedNodeId])

    const handleSelection = (nodeId: string, source: VisualSelectionSource) => {
        setSelectedNodeId(resolveVisualSelection(layerProjection.nodes, nodeId, source))
    }

    if (loadView === 'error') {
        return (
            <div className="page-document-editor-state is-error" role="alert">
                <span>{session.loadError || '读取页面文档失败。'}</span>
                <Button type="button" size="sm" variant="outline" onClick={session.retryLoad}>
                    重试读取
                </Button>
            </div>
        )
    }
    if (loadView === 'loading' || !state) {
        return <div className="page-document-editor-state" role="status">正在建立页面编辑会话…</div>
    }

    const scope = state.model.entry
    const diagnosticCount = scope.diagnostics.length
    const conflict = state.conflict
    const conflictSources = conflict?.latestDocument
        ? sourceSetFromConflict(conflict.latestDocument.html, conflict.latestDocument.css)
        : null
    const selectedNode = selectedNodeId
        ? findLayerNode(layerProjection.nodes, selectedNodeId)
        : null
    const editorIdentity = {projectId, entryId}
    // 词条标签会常驻挂载；共享宿主必须只由当前活动词条独占，避免后台草稿叠进同一 portal。
    const sidebarPortalHost = shouldOccupyPageDocumentSharedHost({
        active,
        editor: editorIdentity,
        workspace: activeWorkspace,
        host: sidebarHost,
    }) ? sidebarHost : null
    const dockPortalHost = shouldOccupyPageDocumentSharedHost({
        active,
        editor: editorIdentity,
        workspace: activeWorkspace,
        host: dockHost,
    }) ? dockHost : null
    const forwardsNavigation = shouldForwardPageDocumentNavigation(mode)

    return (
        <>
            {sidebarPortalHost && createPortal(
                <PageDocumentLayerTree
                    nodes={layerProjection.nodes}
                    selectedNodeId={selectedNodeId}
                    onSelect={nodeId => handleSelection(nodeId, 'layer')}
                />,
                sidebarPortalHost,
            )}
            {dockPortalHost && createPortal(
                <PageDocumentPropertiesPanel
                    node={selectedNode}
                    entryStyleCss={scope.sources['style.css']}
                    inspectComponent={session.inspectComponent}
                    applyKernelEntry={session.applyKernelEntry}
                    visualError={session.visualError}
                />,
                dockPortalHost,
            )}
            <section className="page-document-editor">
            <header className="page-document-editor__workbar">
                <strong>页面编辑</strong>
                <span className="page-document-editor__separator" aria-hidden="true" />
                <div className="page-document-editor__modes" role="group" aria-label="页面编辑模式">
                    <button
                        type="button"
                        className={mode === 'visual' ? 'is-active' : ''}
                        aria-pressed={mode === 'visual'}
                        onClick={() => setMode('visual')}
                    >可视</button>
                    <button
                        type="button"
                        className={mode === 'display' ? 'is-active' : ''}
                        aria-pressed={mode === 'display'}
                        onClick={() => setMode('display')}
                    >
                        展示
                    </button>
                    <button
                        type="button"
                        className={mode === 'code' ? 'is-active' : ''}
                        aria-pressed={mode === 'code'}
                        onClick={() => setMode('code')}
                    >
                        代码
                    </button>
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canUndo}
                    onClick={() => mode === 'code' ? sourceWorkspaceRef.current?.undo() : session.undo()}
                >撤销</Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canRedo}
                    onClick={() => mode === 'code' ? sourceWorkspaceRef.current?.redo() : session.redo()}
                >重做</Button>
                <span className={`page-document-editor__save-state is-${scope.phase}`} role="status">{saveStatus}</span>
                <Button type="button" size="sm" radius="full" disabled={!canSave} onClick={() => void save()}>
                    {scope.phase === 'saving' ? '保存中…' : '保存'}
                </Button>
            </header>

            {conflict && (
                <section className="page-document-editor__conflict" role="alert">
                    <div>
                        <strong>磁盘版本已更新到 {conflict.currentRevision !== null ? `r${conflict.currentRevision}` : '未知 revision'}。</strong>
                        <span>本地草稿仍被保留；代码模式的差异会改为对比磁盘最新版本。</span>
                        {conflict.resolutionError && <span>{conflict.resolutionError}</span>}
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => void session.keepDraft()}>
                        保留草稿，覆盖最新版本时再保存
                    </Button>
                    <Button type="button" size="sm" disabled={!conflict.latestDocument} onClick={session.loadLatest}>
                        载入最新版本（放弃本地修改）
                    </Button>
                </section>
            )}

            <div className="page-document-editor__workspace" data-mode={mode}>
                {mode !== 'code' ? (
                    <div className="page-document-editor__canvas-stage">
                        <div className="page-document-editor__page-card">
                            {state.preview?.html != null && state.preview.css != null ? (
                                <PageDocumentCanvas
                                    documentKey={entryId}
                                    html={state.preview.html}
                                    css={state.preview.css}
                                    minimumHeight={560}
                                    selectedNodeId={mode === 'visual' ? selectedNodeId : null}
                                    onSelectionChange={mode === 'visual'
                                        ? nodeId => handleSelection(nodeId, 'canvas')
                                        : undefined}
                                    onNavigationIntent={forwardsNavigation ? onNavigationIntent : undefined}
                                />
                            ) : (
                                <p>当前没有可渲染的合法结果。</p>
                            )}
                            {state.previewStale && <span className="page-document-editor__preview-stale">预览未更新</span>}
                        </div>
                    </div>
                ) : (
                    <SourceWorkspace
                        ref={sourceWorkspaceRef}
                        documentKey={entryId}
                        sources={scope.sources}
                        baseSources={scope.baseSources}
                        conflictSources={conflictSources}
                        diagnostics={scope.diagnostics}
                        preview={state.preview}
                        previewStale={state.previewStale}
                        onSourceChange={session.updateSource}
                        onNavigationIntent={onNavigationIntent}
                        onHistoryChange={setSourceHistory}
                    />
                )}
            </div>

            <footer className="page-document-editor__statusbar">
                <span>{validationLabel(scope.validationPhase)} · {diagnosticCount} 条诊断</span>
                <span>{dirty ? '草稿未保存' : state.persistedRevision ? '草稿已同步' : '新页面尚未保存'}</span>
                <span>revision · {state.persistedRevision ? `r${state.persistedRevision}` : '—'}</span>
            </footer>
            </section>
        </>
    )
}
