// 本组件提供页面文档第一批编辑壳层；只编辑独立 HTML/CSS，并把保存交给页面文档会话。

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from 'flowcloudai-ui'
import {Eye, FilePlus2, Home, Image, LayoutPanelTop, Table2, type LucideIcon} from 'lucide-react'
import {
    pageDocumentAssetErrorMessage,
    pageDocumentComponentErrorMessage,
    type PageDocumentAsset,
    type PageDocumentComponentImpact,
} from '../../../api/pageDocument.ts'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {useEntryPageDocumentSession} from '../hooks/useEntryPageDocumentSession.ts'
import type {SourceFileSet} from '../domain/contract.ts'
import {createLayerProjection, type LayerProjectionNode} from '../domain/layerProjection.ts'
import {
    findLayerNode,
    resolveVisualSelection,
    type VisualSelectionSource,
} from '../application/visualSelectionModel.ts'
import {PageDocumentCanvas, type PageDocumentCanvasHandle} from '../canvas/host/PageDocumentCanvas.tsx'
import {
    CANVAS_EDITABLE_KINDS,
    type CanvasLinkCandidateIntentMessage,
    type CanvasTextSelectionMessage,
} from '../canvas/protocol/index.ts'
import {pageDocumentLinkCandidates} from '../application/linkCandidateSelection.ts'
import {createImageInsertionRequest, createImageReplacementRequest, isCurrentImageAssetSelection, resolveImageInsertionTarget} from '../application/imageAssetEditing.ts'
import {readManagedImageDescription} from '../application/imageSemanticEditing.ts'
import type {EntryBrief} from '../../../api/worldflow.ts'
import {SourceWorkspace, type SourceWorkspaceHandle} from './source/SourceWorkspace.tsx'
import {PageDocumentLayerTree} from './layers/PageDocumentLayerTree.tsx'
import {pageDocumentLayerLabel} from './layers/layerTreePresentation.ts'
import {PageDocumentPropertiesPanel} from './properties/PageDocumentPropertiesPanel.tsx'
import {PageDocumentAssetPicker} from './assets/PageDocumentAssetPicker.tsx'
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
import {
    DocumentOfficeRibbon,
    type DocumentRibbonTabOption,
} from '../../document-editor/visual/DocumentOfficeRibbon.tsx'
import {HomeRibbonControls} from '../../document-editor/visual/HomeRibbonControls.tsx'
import {
    PageRibbonControls,
    ViewRibbonControls,
} from '../../document-editor/visual/PageAndViewRibbonControls.tsx'
import type {
    DocumentQuickScope,
    LayoutPreviewViewportMode,
    ResponsiveViewportContext,
} from '../../document-editor/visual/pageAndViewRibbonModel.ts'
import {ContainerLayoutRibbonControls} from '../../document-editor/visual/ContainerLayoutRibbonControls.tsx'
import {ContextualRibbonControls} from '../../document-editor/visual/ContextualRibbonControls.tsx'
import {PublicComponentRibbonControls} from '../../document-editor/visual/PublicComponentRibbonControls.tsx'
import {BuiltInStructureRibbonControls} from '../../document-editor/visual/BuiltInStructureRibbonControls.tsx'
import {
    createBuiltInStructureInsertion,
    type BuiltInStructureKind,
} from '../application/builtInStructureInsertion.ts'
import {PublicComponentDefinitionCreator} from './public-components/PublicComponentDefinitionCreator.tsx'
import {
    publicComponentDefinitionFormValue,
    type PublicComponentDefinitionFormValue,
} from '../application/publicComponentDefinitionForm.ts'
import type {PublicComponentDefinitionContract} from '../domain/kernel/contracts/publicComponent.ts'
import {
    createListItemInsertionRequest,
    resolveStructuredSelectionContext,
} from '../application/structuredContentEditing.ts'
import type {RibbonTextRange} from '../../document-editor/visual/ribbonKernelBinding.ts'
import {
    resolveRibbonTab,
    ribbonTabsForNode,
    type DocumentRibbonTab,
} from '../../document-editor/visual/documentRibbonModel.ts'

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

function RibbonUnavailableTab({tab}: {tab: string}) {
    return (
        <div className="page-document-editor__ribbon-unavailable" role="status">
            {tab} 页签将在后续页面文档编辑批次接入。
        </div>
    )
}

const RIBBON_TAB_ICONS: Readonly<Record<DocumentRibbonTab, LucideIcon>> = {
    home: Home,
    insert: FilePlus2,
    page: LayoutPanelTop,
    view: Eye,
    picture: Image,
    gallery: Image,
    table: Table2,
    container: LayoutPanelTop,
    list: LayoutPanelTop,
    divider: LayoutPanelTop,
}

const RIBBON_TAB_LABELS: Readonly<Record<DocumentRibbonTab, string>> = {
    home: '开始',
    insert: '插入',
    page: '页面',
    view: '视图',
    picture: '图片',
    gallery: '画廊',
    table: '表格',
    container: '容器',
    list: '列表',
    divider: '分隔线',
}

function ribbonTabOptions(node: LayerProjectionNode | null): readonly DocumentRibbonTabOption[] {
    return ribbonTabsForNode(node).map(tab => ({
        id: tab,
        label: RIBBON_TAB_LABELS[tab],
        icon: RIBBON_TAB_ICONS[tab],
        contextual: !['home', 'insert', 'page', 'view'].includes(tab),
        disabled: false,
    }))
}

interface ComponentDefinitionEditorState {
    readonly componentId: string
    readonly expectedRevision?: number
    readonly initialValue?: PublicComponentDefinitionFormValue
    readonly initialPreviewAssetId?: string | null
}

interface ComponentActionState {
    readonly definition: PublicComponentDefinitionContract
    readonly node: LayerProjectionNode | null
    readonly impact: PageDocumentComponentImpact | null
    readonly loading: boolean
    readonly busy: boolean
    readonly error: string | null
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
        projectEntries,
        resetVersion,
        selectionRequest,
        onDirtyChange,
        onSavedDerivedText,
        onNavigationIntent,
        onRequestLeave,
    } = props
    const [mode, setMode] = useState<PageDocumentWorkspaceMode>('visual')
    const [ribbonTab, setRibbonTab] = useState<DocumentRibbonTab>('home')
    const [ribbonCollapsed, setRibbonCollapsed] = useState(false)
    const [pageScope, setPageScope] = useState<DocumentQuickScope>('entry')
    const [previewWidth, setPreviewWidth] = useState<LayoutPreviewViewportMode>('auto')
    const [editContext, setEditContext] = useState<ResponsiveViewportContext>('desktop')
    const [outlineVisible, setOutlineVisible] = useState(true)
    const [layoutGuidesVisible, setLayoutGuidesVisible] = useState(false)
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [activeTextRange, setActiveTextRange] = useState<RibbonTextRange | null>(null)
    const [sourceHistory, setSourceHistory] = useState({canUndo: false, canRedo: false})
    const [linkCandidateIntent, setLinkCandidateIntent] = useState<CanvasLinkCandidateIntentMessage | null>(null)
    const [assetPicker, setAssetPicker] = useState<{mode: 'insert' | 'replace'; contextKey: string; pickerId: string} | null>(null)
    const [assetPickerBusy, setAssetPickerBusy] = useState(false)
    const [assetPickerError, setAssetPickerError] = useState<string | null>(null)
    const [componentEditor, setComponentEditor] = useState<ComponentDefinitionEditorState | null>(null)
    const [componentAction, setComponentAction] = useState<ComponentActionState | null>(null)
    const canvasRef = useRef<PageDocumentCanvasHandle>(null)
    const committingCandidateRef = useRef<string | null>(null)
    const sourceWorkspaceRef = useRef<SourceWorkspaceHandle>(null)
    const interactionKeyRef = useRef('')
    const appliedSelectionRequestRef = useRef('')
    const activeAssetPickerIdRef = useRef<string | null>(null)
    const session = useEntryPageDocumentSession({
        entryId,
        projectId,
        title,
        summary,
        markdown,
    })
    const {state} = session
    const {canSave, dirty, discard, flushCanvasInput, save} = session
    const {
        active: activeWorkspace,
        sidebarHost,
        dockHost,
    } = usePageDocumentWorkspace()
    const appliedResetVersionRef = useRef(resetVersion)
    const handleSave = useCallback(async () => {
        const result = await save()
        if (result) onSavedDerivedText?.(result.document.derivedText)
    }, [onSavedDerivedText, save])

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
        setComponentEditor(null)
        setComponentAction(null)
    }, [entryId, projectId])

    useEffect(() => {
        if (!active) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.altKey) return
            if (!(event.metaKey || event.ctrlKey)) return
            const key = event.key.toLowerCase()
            if (key === 's' && !event.shiftKey) {
                event.preventDefault()
                if (canSave) void handleSave()
            } else if (key === 'z' && !event.shiftKey) {
                event.preventDefault()
                if (mode === 'code') sourceWorkspaceRef.current?.undo()
                else session.undo()
            } else if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) {
                event.preventDefault()
                if (mode === 'code') sourceWorkspaceRef.current?.redo()
                else session.redo()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [active, canSave, handleSave, mode, session])

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
    const interactionKey = `${projectId}:${entryId}:${active}:${mode}:${selectedNodeId ?? ''}:${state?.model.changeVersion ?? -1}`
    useLayoutEffect(() => {
        interactionKeyRef.current = interactionKey
    }, [interactionKey])

    useEffect(() => {
        if (selectedNodeId === null) return
        if (resolveVisualSelection(layerProjection.nodes, selectedNodeId, 'layer') === null) {
            setSelectedNodeId(null)
        }
    }, [layerProjection.nodes, selectedNodeId])

    useEffect(() => {
        if (!active || !state || !selectionRequest) return
        const requestKey = `${entryId}:${selectionRequest.requestId}`
        if (appliedSelectionRequestRef.current === requestKey) return
        appliedSelectionRequestRef.current = requestKey
        const nodeId = resolveVisualSelection(layerProjection.nodes, selectionRequest.nodeId, 'layer')
        if (nodeId) setSelectedNodeId(nodeId)
    }, [active, entryId, layerProjection.nodes, selectionRequest, state])

    useEffect(
        () => () => flushCanvasInput(),
        [flushCanvasInput, mode, selectedNodeId],
    )

    const handleSelection = (nodeId: string, source: VisualSelectionSource) => {
        setSelectedNodeId(resolveVisualSelection(layerProjection.nodes, nodeId, source))
    }

    const handleTextSelection = (message: CanvasTextSelectionMessage) => {
        if (message.nodeId === null || message.from === message.to) {
            setActiveTextRange(null)
            return
        }
        const target = findLayerNode(layerProjection.nodes, message.nodeId)
        if (!active || mode !== 'visual' || !target || !CANVAS_EDITABLE_KINDS.includes(target.kind as never)) {
            setActiveTextRange(null)
            return
        }
        setSelectedNodeId(message.nodeId)
        setActiveTextRange({
            nodeId: message.nodeId,
            from: message.from,
            to: message.to,
            expected: message.expected,
        })
    }

    const handleLinkCandidateIntent = (message: CanvasLinkCandidateIntentMessage) => {
        if (committingCandidateRef.current) return
        if (message.query === null) {
            setLinkCandidateIntent(current => current?.intentId === message.intentId ? null : current)
            return
        }
        const target = findLayerNode(layerProjection.nodes, message.nodeId)
        if (active && mode === 'visual' && target && CANVAS_EDITABLE_KINDS.some(kind => kind === target.kind)) {
            setLinkCandidateIntent(message)
        }
    }

    const changeMode = (nextMode: PageDocumentWorkspaceMode) => {
        setLinkCandidateIntent(null)
        setActiveTextRange(null)
        activeAssetPickerIdRef.current = null
        setAssetPicker(null)
        setMode(nextMode)
    }

    const commitLinkCandidate = async (entry: EntryBrief) => {
        const candidate = linkCandidateIntent
        if (!candidate || committingCandidateRef.current) return
        committingCandidateRef.current = candidate.intentId
        setLinkCandidateIntent(null)
        try {
            const resolution = await session.applyLinkCandidateSelection(candidate, entry)
            canvasRef.current?.resolveLinkCandidate(candidate.intentId, resolution)
        } finally {
            committingCandidateRef.current = null
        }
    }

    const selectedNode = selectedNodeId
        ? findLayerNode(layerProjection.nodes, selectedNodeId)
        : null
    const structuredSelection = resolveStructuredSelectionContext(
        layerProjection.nodes,
        selectedNodeId,
    )
    const visibleRibbonTab = resolveRibbonTab(ribbonTab, selectedNode)
    const ribbonTabs = ribbonTabOptions(selectedNode)

    const builtInInsertionTarget = mode === 'visual'
        ? resolveImageInsertionTarget(layerProjection.nodes, selectedNodeId)
        : null
    const insertBuiltInStructure = (kind: BuiltInStructureKind) => {
        if (!builtInInsertionTarget) {
            void session.reportVisualFailure('请选择正文容器或其中一个受管节点作为插入位置。')
            return
        }
        const insertion = createBuiltInStructureInsertion(builtInInsertionTarget, kind)
        void session.applyVisualPropertyEntry(
            insertion.request,
            `插入${({paragraph: '段落', heading: '标题', list: '列表', table: '表格', divider: '分隔线', container: '容器'} as const)[kind]}`,
            {immediate: true},
        ).then(accepted => {
            if (accepted) setSelectedNodeId(insertion.newNodeId)
        })
    }

    const openComponentEditor = (definition?: PublicComponentDefinitionContract) => {
        setComponentAction(null)
        setComponentEditor(definition ? {
            componentId: definition.componentId,
            expectedRevision: definition.revision,
            initialValue: publicComponentDefinitionFormValue(definition),
            initialPreviewAssetId: definition.preview?.assetId ?? null,
        } : {componentId: crypto.randomUUID()})
    }

    const openCapturedComponentEditor = (node: LayerProjectionNode | null) => {
        if (!node?.managed || node.kind === 'component') return
        try {
            const captured = session.captureSelectedComponent(node.id)
            setComponentAction(null)
            setComponentEditor({
                componentId: captured.componentId,
                initialValue: captured.form,
            })
        } catch (error) {
            void session.reportVisualFailure(
                error instanceof Error ? error.message : '无法把选中内容保存为公共组件。',
            )
        }
    }

    const openComponentActions = (
        definition: PublicComponentDefinitionContract,
        node: LayerProjectionNode | null,
    ) => {
        const componentId = definition.componentId
        const nodeId = node?.id ?? null
        setComponentAction({definition, node, impact: null, loading: true, busy: false, error: null})
        void session.getComponentImpact(componentId).then(impact => {
            setComponentAction(current => current &&
                current.definition.componentId === componentId && (current.node?.id ?? null) === nodeId
                ? {...current, impact, loading: false}
                : current)
        }).catch(error => {
            setComponentAction(current => current &&
                current.definition.componentId === componentId && (current.node?.id ?? null) === nodeId
                ? {...current, loading: false, error: pageDocumentComponentErrorMessage(error)}
                : current)
        })
    }

    const openSelectedComponentActions = (node: LayerProjectionNode) => {
        const definition = session.componentDefinitions
            .filter(item => item.componentId.toLowerCase() === node.attributes['data-fc-component']?.toLowerCase())
            .reduce<PublicComponentDefinitionContract | null>(
                (latest, item) => !latest || item.revision > latest.revision ? item : latest,
                null,
            )
        if (!definition) {
            void session.reportVisualFailure('公共组件定义缺失，不能编辑或创建本地副本。')
            return
        }
        openComponentActions(definition, node)
    }

    const localizeSelectedComponent = async () => {
        const current = componentAction
        if (!current?.node || current.busy) return
        setComponentAction({...current, busy: true, error: null})
        const localizedNodeId = await session.localizePublicComponent(current.node)
        if (localizedNodeId) {
            setSelectedNodeId(localizedNodeId)
            setComponentAction(null)
            return
        }
        setComponentAction(latest => latest ? {
            ...latest,
            busy: false,
            error: session.visualError ?? '公共组件没有转换为本地内容；页面草稿保持不变。',
        } : latest)
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
    const openAssetPicker = (pickerMode: 'insert' | 'replace') => {
        if (!active || mode !== 'visual') return
        if (pickerMode === 'replace' && selectedNode?.kind !== 'asset') return
        const pickerId = crypto.randomUUID()
        activeAssetPickerIdRef.current = pickerId
        setAssetPicker({mode: pickerMode, contextKey: interactionKey, pickerId})
        setAssetPickerError(null)
        void session.refreshAssets().catch(error => {
            if (interactionKeyRef.current === interactionKey) setAssetPickerError(pageDocumentAssetErrorMessage(error))
        })
    }
    const applyChosenAsset = async (
        asset: PageDocumentAsset,
        importedPicker?: {mode: 'insert' | 'replace'; contextKey: string; pickerId: string},
    ) => {
        const picker = importedPicker ?? assetPicker
        if (!picker || (assetPickerBusy && !importedPicker)) return
        setAssetPickerBusy(true)
        setAssetPickerError(null)
        try {
            if (!isCurrentImageAssetSelection(
                picker.contextKey, interactionKeyRef.current, asset.projectId, projectId,
                picker.pickerId, activeAssetPickerIdRef.current,
            )) {
                throw new TypeError('词条、选中节点或草稿已变化，请重新打开图片选择器。')
            }
            const checked = await session.verifyImageAsset(asset.id)
            if (!checked || activeAssetPickerIdRef.current !== picker.pickerId ||
                picker.contextKey !== interactionKeyRef.current) {
                throw new TypeError('图片或编辑目标已变化，本次没有修改页面草稿。')
            }
            let newNodeId: string | null = null
            let request
            if (picker.mode === 'replace') {
                const image = selectedNodeId
                    ? readManagedImageDescription(scope.sources['article.html'], selectedNodeId)
                    : null
                if (!image) throw new TypeError('选中的图片已变化，请重新选择。')
                request = createImageReplacementRequest(image, checked.id)
            } else {
                const target = resolveImageInsertionTarget(layerProjection.nodes, selectedNodeId)
                if (!target) throw new TypeError('请选择正文容器或其中一个受管节点作为插入位置。')
                newNodeId = crypto.randomUUID()
                request = createImageInsertionRequest(target, checked.id, newNodeId)
            }
            const accepted = await session.applyKernelEntry(request,
                picker.mode === 'insert' ? '插入图片' : '替换图片', {},
                () => activeAssetPickerIdRef.current === picker.pickerId &&
                    picker.contextKey === interactionKeyRef.current)
            if (!accepted) throw new TypeError('内核未接纳图片操作；页面草稿保持原样。')
            if (newNodeId) setSelectedNodeId(newNodeId)
            activeAssetPickerIdRef.current = null
            setAssetPicker(null)
        } catch (error) {
            setAssetPickerError(pageDocumentAssetErrorMessage(error))
        } finally {
            setAssetPickerBusy(false)
        }
    }
    const importAndApplyAsset = async () => {
        if (!assetPicker || assetPickerBusy) return
        const captured = assetPicker
        setAssetPickerBusy(true)
        setAssetPickerError(null)
        try {
            const imported = await session.importImageAsset()
            if (!imported) return
            if (activeAssetPickerIdRef.current !== captured.pickerId ||
                captured.contextKey !== interactionKeyRef.current) {
                throw new TypeError('导入已留在项目资产库；编辑目标已变化，页面草稿未修改。')
            }
            await applyChosenAsset(imported, captured)
        } catch (error) {
            setAssetPickerError(pageDocumentAssetErrorMessage(error))
        } finally {
            setAssetPickerBusy(false)
        }
    }
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
    const visibleCandidate = active && mode === 'visual' ? linkCandidateIntent : null
    const linkCandidates = visibleCandidate?.query !== null && visibleCandidate
        ? pageDocumentLinkCandidates(projectEntries, entryId, visibleCandidate.query)
        : []

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
                    articleHtml={scope.sources['article.html']}
                    assets={session.assets}
                    componentDefinitions={session.componentDefinitions}
                    entryStyleCss={scope.sources['style.css']}
                    inspectComponent={session.inspectComponent}
                    applyKernelEntry={session.applyVisualPropertyEntry}
                    flushPendingChanges={session.flushVisualPropertyEntry}
                    onAdopt={async node => {
                        const adoptedNodeId = await session.adoptOpaqueElement(node)
                        if (adoptedNodeId) setSelectedNodeId(adoptedNodeId)
                        return adoptedNodeId
                    }}
                    onReplaceImage={() => openAssetPicker('replace')}
                    onManagePublicComponent={openSelectedComponentActions}
                    onSaveAsPublicComponent={openCapturedComponentEditor}
                    visualError={session.visualError}
                />,
                dockPortalHost,
            )}
            <section className="page-document-editor">
            {componentEditor && <PublicComponentDefinitionCreator
                open
                projectId={projectId}
                componentId={componentEditor.componentId}
                expectedRevision={componentEditor.expectedRevision}
                initialValue={componentEditor.initialValue}
                initialPreviewAssetId={componentEditor.initialPreviewAssetId}
                assets={session.assets}
                onClose={() => setComponentEditor(null)}
                onSave={async input => {
                    if (input.expectedRevision) await session.updateComponentDefinition({...input, expectedRevision: input.expectedRevision})
                    else await session.createComponentDefinition(input)
                }}
            />}
            {componentAction && <FloatingPanel
                open
                onClose={() => componentAction.busy ? undefined : setComponentAction(null)}
                dismissible={!componentAction.busy}
                title="公共组件操作"
                className="page-document-editor__component-action"
            >
                <div className="page-document-editor__component-action-body">
                    <strong>{componentAction.definition.name}</strong>
                    {componentAction.loading ? <p role="status">正在统计影响范围…</p> : componentAction.impact ? <>
                        <p>此组件来自公共模板，修改会影响 {componentAction.impact.entryPages} 个词条。</p>
                        <p>另有 {componentAction.impact.projectHomes} 个项目首页，共 {componentAction.impact.instances} 个跟随最新修订的实例会受影响；固定修订实例不受影响。</p>
                    </> : null}
                    {componentAction.error && <p role="alert">{componentAction.error}</p>}
                    <div>
                        <Button
                            type="button"
                            size="sm"
                            disabled={componentAction.loading || componentAction.busy || componentAction.impact === null}
                            onClick={() => openComponentEditor(
                                session.componentDefinitions
                                    .filter(item => item.componentId.toLowerCase() === componentAction.definition.componentId.toLowerCase())
                                    .reduce((latest, item) => item.revision > latest.revision ? item : latest, componentAction.definition),
                            )}
                        >编辑公共组件</Button>
                        {componentAction.node && <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={componentAction.loading || componentAction.busy || componentAction.impact === null}
                            onClick={() => void localizeSelectedComponent()}
                        >{componentAction.busy ? '正在创建本地副本…' : '仅为当前内容创建本地副本'}</Button>}
                    </div>
                </div>
            </FloatingPanel>}
            {assetPicker && <PageDocumentAssetPicker
                mode={assetPicker.mode}
                assets={session.assets}
                busy={assetPickerBusy}
                error={assetPickerError}
                onChoose={asset => void applyChosenAsset(asset)}
                onImport={() => void importAndApplyAsset()}
                onClose={() => {
                    activeAssetPickerIdRef.current = null
                    setAssetPicker(null)
                }}
            />}
            {visibleCandidate && <FloatingPanel
                open
                passive
                onClose={() => setLinkCandidateIntent(null)}
                title="选择词条双链"
                className="page-document-editor__link-candidate"
                layerClassName="page-document-editor__link-candidate-layer"
            >
                <div className="page-document-editor__link-candidate-query">
                    {visibleCandidate?.query || '继续输入词条名…'}
                </div>
                <div className="page-document-editor__link-candidate-list">
                    {linkCandidates.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            onPointerDown={event => {
                                event.preventDefault()
                                void commitLinkCandidate(entry)
                            }}
                            onClick={() => void commitLinkCandidate(entry)}
                        >
                            {entry.title}
                        </button>
                    ))}
                    {linkCandidates.length === 0 && <p>没有匹配的词条</p>}
                </div>
            </FloatingPanel>}
            <header className="page-document-editor__workbar">
                <strong>页面编辑</strong>
                <span className="page-document-editor__separator" aria-hidden="true" />
                <div className="page-document-editor__modes" role="group" aria-label="页面编辑模式">
                    <button
                        type="button"
                        className={mode === 'visual' ? 'is-active' : ''}
                        aria-pressed={mode === 'visual'}
                        onClick={() => changeMode('visual')}
                    >可视</button>
                    <button
                        type="button"
                        className={mode === 'display' ? 'is-active' : ''}
                        aria-pressed={mode === 'display'}
                        onClick={() => changeMode('display')}
                    >
                        展示
                    </button>
                    <button
                        type="button"
                        className={mode === 'code' ? 'is-active' : ''}
                        aria-pressed={mode === 'code'}
                        onClick={() => changeMode('code')}
                    >
                        代码
                    </button>
                </div>
                {mode === 'visual' && <Button type="button" size="sm" variant="outline" onClick={() => openAssetPicker('insert')}>插入图片</Button>}
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
                <Button type="button" size="sm" radius="full" disabled={!canSave} onClick={() => void handleSave()}>
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

            {mode === 'visual' && (
                <div className="page-document-editor__ribbon">
                    <DocumentOfficeRibbon
                        activeTab={visibleRibbonTab}
                        collapsed={ribbonCollapsed}
                        onCollapsedChange={setRibbonCollapsed}
                        onTabChange={setRibbonTab}
                        tabs={ribbonTabs}
                    >
                        {visibleRibbonTab === 'home' ? (
                            <HomeRibbonControls
                                selected={selectedNode}
                                applyKernelEntry={session.applyVisualPropertyEntry}
                                inspectComponent={session.inspectComponent}
                                inspectTextRange={session.inspectTextRange}
                                activeTextRange={activeTextRange}
                            />
                        ) : visibleRibbonTab === 'insert' ? (
                            <>
                                <BuiltInStructureRibbonControls
                                    disabledReason={builtInInsertionTarget ? null : '请选择正文容器或其中一个受管节点作为插入位置。'}
                                    onInsert={insertBuiltInStructure}
                                />
                                <PublicComponentRibbonControls
                                    definitions={session.componentDefinitions}
                                    warning={session.componentDefinitionsWarning}
                                    assets={session.assets}
                                    selected={selectedNode}
                                    applyKernelEntry={session.applyVisualPropertyEntry}
                                    onInserted={setSelectedNodeId}
                                    onOpenCreate={() => openComponentEditor()}
                                    onOpenEdit={definition => openComponentActions(definition, null)}
                                    onSaveSelected={() => openCapturedComponentEditor(selectedNode)}
                                    onDelete={session.deleteComponentDefinition}
                                />
                            </>
                        ) : visibleRibbonTab === 'page' ? (
                            <PageRibbonControls
                                scope={pageScope}
                                onScopeChange={setPageScope}
                                onOpenTheme={() => undefined}
                                onOpenPageLayout={() => undefined}
                                nodeId={selectedNode?.id ?? null}
                                onApplyLayout={(request, label) => {
                                    void session.applyVisualPropertyEntry(request, label, {immediate: true})
                                }}
                                sourceVersion={state.model.changeVersion}
                                inspectThemeTokens={session.inspectThemeTokens}
                                applyThemeToken={session.applyKernelEntry}
                            />
                        ) : visibleRibbonTab === 'view' ? (
                            <ViewRibbonControls
                                previewMode={previewWidth}
                                editContext={editContext}
                                outlineVisible={outlineVisible}
                                layoutGuidesVisible={layoutGuidesVisible}
                                onPreviewModeChange={setPreviewWidth}
                                onEditContextChange={setEditContext}
                                onOutlineVisibleChange={setOutlineVisible}
                                onLayoutGuidesVisibleChange={setLayoutGuidesVisible}
                                onOpenDisplay={() => changeMode('display')}
                                onOpenDeveloperInfo={() => changeMode('code')}
                            />
                        ) : visibleRibbonTab === 'container' && selectedNode?.kind === 'container' ? (
                            <ContainerLayoutRibbonControls
                                node={selectedNode}
                                context={editContext}
                                sourceVersion={state.model.changeVersion}
                                applyKernelEntry={session.applyVisualPropertyEntry}
                                inspectComponent={session.inspectComponent}
                                onOpenArrangementDetails={() => undefined}
                                onOpenGridDetails={() => undefined}
                                onOpenSpacingDetails={() => undefined}
                            />
                        ) : selectedNode ? (
                            <ContextualRibbonControls
                                selected={selectedNode}
                                tableNode={structuredSelection.tableNode}
                                snapshot={state.snapshot}
                                context={editContext}
                                canAddListItem={layerProjection.managedNodeCount < state.snapshot.editorLimits.managedNodes}
                                parentListId={structuredSelection.listNode?.id ?? null}
                                onAddListItem={(listId, afterId) => {
                                    const request = createListItemInsertionRequest(
                                        listId,
                                        afterId,
                                        crypto.randomUUID(),
                                    )
                                    void session.applyVisualPropertyEntry(request, '添加列表项', {immediate: true})
                                }}
                                assetFeedback={session.visualError}
                                applyKernelEntry={session.applyVisualPropertyEntry}
                                inspectComponent={session.inspectComponent}
                                sourceVersion={state.model.changeVersion}
                                onChooseLocalAsset={() => openAssetPicker('replace')}
                                onOpenDetails={() => undefined}
                            />
                        ) : (
                            <RibbonUnavailableTab tab={visibleRibbonTab} />
                        )}
                    </DocumentOfficeRibbon>
                </div>
            )}

            <div className="page-document-editor__workspace" data-mode={mode}>
                {mode !== 'code' ? (
                    <div className="page-document-editor__canvas-stage">
                        <div
                            className="page-document-editor__page-card"
                            style={previewWidth === 'auto' ? undefined : {
                                    maxWidth: ({
                                    mobile: '390px',
                                    tablet: '640px',
                                    desktop: '960px',
                                    wide: '1280px',
                                    auto: undefined,
                                } as Record<LayoutPreviewViewportMode, string | undefined>)[previewWidth],
                            }}
                        >
                            {state.preview?.html != null && state.preview.css != null ? (
                                <PageDocumentCanvas
                                    ref={canvasRef}
                                    documentKey={entryId}
                                    projectId={projectId}
                                    html={state.preview.html}
                                    css={state.preview.css}
                                    minimumHeight={560}
                                    editingEnabled={active && mode === 'visual'}
                                    selectedNodeId={mode === 'visual' ? selectedNodeId : null}
                                    onSelectionChange={mode === 'visual'
                                        ? nodeId => handleSelection(nodeId, 'canvas')
                                        : undefined}
                                    onTextSelectionChange={mode === 'visual'
                                        ? handleTextSelection
                                        : undefined}
                                    onNavigationIntent={forwardsNavigation ? onNavigationIntent : undefined}
                                    onInputIntent={mode === 'visual'
                                        ? session.applyCanvasInputIntent
                                        : undefined}
                                    onInputBlocked={mode === 'visual'
                                        ? session.reportCanvasInputBlocked
                                        : undefined}
                                    onInputFlush={mode === 'visual'
                                        ? flushCanvasInput
                                        : undefined}
                                    onHistoryIntent={mode === 'visual'
                                        ? action => action === 'undo' ? session.undo() : session.redo()
                                        : undefined}
                                    onLinkCandidateIntent={handleLinkCandidateIntent}
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
                        projectId={projectId}
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
                <span>修改生效范围：所有宽度</span>
                <span>选中：{selectedNode ? pageDocumentLayerLabel(selectedNode) : '—'}</span>
                <span>revision · {state.persistedRevision ? `r${state.persistedRevision}` : '—'}</span>
            </footer>
            </section>
        </>
    )
}
