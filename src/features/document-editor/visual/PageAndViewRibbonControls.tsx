// 本组件承载页面范围与画布视图设置；主仓暂未接入主题与开发者任务窗格的内核契约。
import {
    Code2,
    Eye,
    EyeOff,
    FileStack,
    Info,
    LayoutGrid,
    LayoutPanelLeft,
    Monitor,
    Palette,
} from 'lucide-react'
import {DocumentRibbonCommand, DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'
import {
    createPageLayoutPaddingRequest,
    PREVIEW_WIDTH_OPTION_LABELS,
    PREVIEW_WIDTH_OPTION_TITLES,
    RESPONSIVE_EDIT_SCOPE_LABELS,
    RESPONSIVE_EDIT_SCOPE_NOTES,
    type DocumentQuickScope,
    type LayoutPreviewViewportMode,
    type ResponsiveViewportContext,
} from './pageAndViewRibbonModel.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'

export function PageRibbonControls({scope, onScopeChange, onOpenTheme, onOpenPageLayout, nodeId, onApplyLayout}: {
    scope: DocumentQuickScope
    onScopeChange: (scope: DocumentQuickScope) => void
    onOpenTheme: (scope: DocumentQuickScope) => void
    onOpenPageLayout: () => void
    nodeId?: string | null
    onApplyLayout?: (request: KernelDraftEditRequest, label: string) => void
}) {
    const selectScope = (next: DocumentQuickScope) => { onScopeChange(next); onOpenTheme(next) }
    return <>
        <DocumentRibbonGroup label="修改范围" priority="essential">
            <DocumentRibbonCommand active={scope === 'entry'} icon={Palette} label="当前页面" onClick={() => selectScope('entry')} title="当前页面样式范围" />
            <DocumentRibbonCommand active={scope === 'project'} icon={FileStack} label="项目模板" onClick={() => selectScope('project')} title="项目模板样式范围" />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup disabledReason="主题令牌与项目模板任务窗格尚未接入页面文档契约。" label="页面外观" priority="high" wide>
            <button aria-label="页面外观任务窗格未接入" className="document-page-theme-open" disabled type="button">
                <Palette size={18} /><span><strong>{scope === 'entry' ? '编辑当前页面样式' : '编辑项目默认主题'}</strong></span><Info aria-hidden="true" size={13} />
            </button>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="当前词条布局" priority="normal">
            <DocumentRibbonCommand
                disabled={!nodeId || !onApplyLayout}
                icon={LayoutGrid}
                label="页面内距"
                onClick={() => {
                    if (nodeId && onApplyLayout) {
                        onApplyLayout(createPageLayoutPaddingRequest(nodeId, 1), '设置页面上内距')
                    } else onOpenPageLayout()
                }}
                title="写入当前节点的页面上内距"
            />
        </DocumentRibbonGroup>
    </>
}

export function ViewRibbonControls({previewMode, editContext, outlineVisible, layoutGuidesVisible, onPreviewModeChange, onEditContextChange, onOutlineVisibleChange, onLayoutGuidesVisibleChange, onOpenDisplay, onOpenDeveloperInfo}: {
    previewMode: LayoutPreviewViewportMode
    editContext: ResponsiveViewportContext
    outlineVisible: boolean
    layoutGuidesVisible: boolean
    onPreviewModeChange: (mode: LayoutPreviewViewportMode) => void
    onEditContextChange: (context: ResponsiveViewportContext) => void
    onOutlineVisibleChange: (visible: boolean) => void
    onLayoutGuidesVisibleChange: (visible: boolean) => void
    onOpenDisplay: () => void
    onOpenDeveloperInfo: () => void
}) {
    return <>
        <DocumentRibbonGroup label="预览画布宽度" priority="essential" wide>
            <div className="document-ribbon-choice-row" role="group" aria-label="预览画布宽度">
                {(Object.keys(PREVIEW_WIDTH_OPTION_LABELS) as LayoutPreviewViewportMode[]).map(mode => <button aria-pressed={previewMode === mode} key={mode} onClick={() => onPreviewModeChange(mode)} title={PREVIEW_WIDTH_OPTION_TITLES[mode]} type="button">{PREVIEW_WIDTH_OPTION_LABELS[mode]}</button>)}
            </div>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="修改生效范围" priority="high" wide>
            <div className="document-ribbon-choice-row" role="group" aria-label="修改生效范围">
                {(Object.keys(RESPONSIVE_EDIT_SCOPE_LABELS) as ResponsiveViewportContext[]).map(context => <button aria-pressed={editContext === context} key={context} onClick={() => onEditContextChange(context)} title={RESPONSIVE_EDIT_SCOPE_NOTES[context]} type="button">{RESPONSIVE_EDIT_SCOPE_LABELS[context]}</button>)}
            </div>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="显示" priority="normal">
            <DocumentRibbonCommand icon={Eye} label="阅读预览" onClick={onOpenDisplay} />
            <DocumentRibbonCommand active={outlineVisible} icon={LayoutPanelLeft} label="文档图层" onClick={() => onOutlineVisibleChange(!outlineVisible)} title="文档图层由工作区侧栏控制" />
            <DocumentRibbonCommand active={layoutGuidesVisible} icon={layoutGuidesVisible ? Monitor : EyeOff} label="布局线" onClick={() => onLayoutGuidesVisibleChange(!layoutGuidesVisible)} title="布局线状态仅保留在当前编辑会话" />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="高级" priority="low">
            <DocumentRibbonCommand icon={Code2} label="开发者信息" onClick={onOpenDeveloperInfo} />
        </DocumentRibbonGroup>
    </>
}
