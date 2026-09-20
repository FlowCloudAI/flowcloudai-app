// 本组件承载页面范围、项目主题令牌与画布视图设置；主题写回统一经页面文档内核。
import {useEffect, useState} from 'react'
import {Button, Input} from 'flowcloudai-ui'
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
import type {
    KernelThemeTokenInspectionRequest,
    KernelThemeTokenInspectionResult,
} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {
    createThemeTokenKernelRequest,
    readThemeTokenEditorState,
    themeTokenStatusLabel,
    themeTokenValueAccepted,
    updateThemeTokenEditorState,
    THEME_TOKEN_FIELDS,
    type ThemeTokenEditorState,
} from '../../page-document/application/themeTokenEditing.ts'
import type {LiveVisualScheduleOptions} from '../../page-document/application/liveVisualCommitScheduler.ts'

type InspectThemeTokens = (
    request: KernelThemeTokenInspectionRequest,
) => KernelThemeTokenInspectionResult
type ApplyThemeToken = (
    request: KernelDraftEditRequest,
    label: string,
    options?: LiveVisualScheduleOptions,
) => Promise<boolean>

const THEME_TOKEN_PROPERTIES = THEME_TOKEN_FIELDS.map(field => field.property)

function ProjectThemeTaskPane({
    sourceVersion,
    inspectThemeTokens,
    applyThemeToken,
}: {
    sourceVersion: number
    inspectThemeTokens: InspectThemeTokens
    applyThemeToken: ApplyThemeToken
}) {
    const read = () => readThemeTokenEditorState(inspectThemeTokens({
        scope: 'project',
        properties: THEME_TOKEN_PROPERTIES,
    }))
    const [state, setState] = useState<ThemeTokenEditorState>(() => read())
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setState(read())
        setError(null)
        // sourceVersion 是绑定层提供的草稿版本，不把 model 或 snapshot 传入功能区。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceVersion])

    const commitField = async (property: string, override?: string | null) => {
        const field = THEME_TOKEN_FIELDS.find(item => item.property === property)
        if (!field) return
        const value = override === undefined ? state.values[property] ?? '' : override ?? ''
        if (!themeTokenValueAccepted(field, value)) {
            setError(`${field.label}不是有效 CSS 值，尚未写入草稿。`)
            return
        }
        if (!state.analysisStamp) {
            setError('当前项目主题没有可用的分析版本，请重新打开页面后重试。')
            return
        }
        const request = createThemeTokenKernelRequest(
            {scope: 'project', analysisStamp: state.analysisStamp},
            {[property]: value.trim() || null},
            {},
        )
        const applied = await applyThemeToken(request, `修改项目${field.label}`, {immediate: true})
        if (!applied) {
            setError('项目主题令牌未写入草稿；当前源码保持不变。')
            return
        }
        setState(current => Object.freeze({
            ...current,
            dirtyFields: new Set([...current.dirtyFields].filter(item => item !== property)),
        }))
        setError(null)
    }

    return (
        <section className="document-theme-task-pane" aria-label="项目主题令牌">
            <header>
                <strong>项目默认主题</strong>
                <span>写入 fc-project，影响继承项目主题的页面</span>
            </header>
            {THEME_TOKEN_FIELDS.map(field => {
                const source = state.sources[field.property]
                const value = state.values[field.property] ?? ''
                const invalid = state.dirtyFields.has(field.property) && !themeTokenValueAccepted(field, value)
                return (
                    <div className="document-theme-token-field" key={field.property}>
                        <label htmlFor={`theme-token-${field.property}`}>{field.label}</label>
                        <div>
                            <Input
                                id={`theme-token-${field.property}`}
                                aria-label={`项目${field.label}`}
                                aria-invalid={invalid}
                                value={value}
                                onValueChange={next => setState(current => updateThemeTokenEditorState(current, field.property, next))}
                                onBlur={() => {
                                    if (state.dirtyFields.has(field.property)) void commitField(field.property)
                                }}
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={!state.dirtyFields.has(field.property) || invalid}
                                onClick={() => void commitField(field.property)}
                            >
                                应用
                            </Button>
                        </div>
                        <small>{themeTokenStatusLabel(source) ?? '当前页面有效值'}</small>
                    </div>
                )
            })}
            {error && <p role="alert">{error}</p>}
        </section>
    )
}

export function PageRibbonControls({scope, editContext, onScopeChange, onOpenTheme, onOpenPageLayout, nodeId, onApplyLayout, sourceVersion, inspectThemeTokens, applyThemeToken}: {
    scope: DocumentQuickScope
    editContext: ResponsiveViewportContext
    onScopeChange: (scope: DocumentQuickScope) => void
    onOpenTheme: (scope: DocumentQuickScope) => void
    onOpenPageLayout: () => void
    nodeId?: string | null
    onApplyLayout?: (request: KernelDraftEditRequest, label: string) => void
    sourceVersion: number
    inspectThemeTokens: InspectThemeTokens
    applyThemeToken: ApplyThemeToken
}) {
    const [themeOpen, setThemeOpen] = useState(false)
    const selectScope = (next: DocumentQuickScope) => {
        if (next !== 'project') return
        onScopeChange(next)
        setThemeOpen(true)
        onOpenTheme(next)
    }
    return <>
        <DocumentRibbonGroup label="修改范围" priority="essential">
            <DocumentRibbonCommand disabled active={scope === 'entry'} icon={Palette} label="当前页面" onClick={() => undefined} title="主题令牌当前只允许写入项目级样式" />
            <DocumentRibbonCommand active={scope === 'project'} icon={FileStack} label="项目模板" onClick={() => selectScope('project')} title="写入 fc-project 项目默认主题" />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="页面外观" priority="high" wide>
            <button
                aria-expanded={themeOpen && scope === 'project'}
                aria-label="打开项目主题令牌任务窗格"
                className="document-page-theme-open"
                disabled={scope !== 'project'}
                onClick={() => setThemeOpen(open => !open)}
                title="编辑项目默认主题令牌"
                type="button"
            >
                <Palette size={18} /><span><strong>编辑项目默认主题</strong></span><Info aria-hidden="true" size={13} />
            </button>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="当前词条布局" priority="normal">
            <DocumentRibbonCommand
                disabled={!nodeId || !onApplyLayout}
                icon={LayoutGrid}
                label="页面内距"
                onClick={() => {
                    if (nodeId && onApplyLayout) {
                        onApplyLayout(createPageLayoutPaddingRequest(nodeId, 1, editContext), '设置页面上内距')
                    } else onOpenPageLayout()
                }}
                title="写入当前节点的页面上内距"
                />
            </DocumentRibbonGroup>
        {themeOpen && scope === 'project' && <ProjectThemeTaskPane
            applyThemeToken={applyThemeToken}
            inspectThemeTokens={inspectThemeTokens}
            sourceVersion={sourceVersion}
        />}
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
            <small>这里只切换属性读写档位；画布宽度由左侧“预览画布宽度”单独控制。</small>
        </DocumentRibbonGroup>
        <DocumentRibbonGroup label="显示" priority="normal">
            <DocumentRibbonCommand icon={Eye} label="预览草稿" onClick={onOpenDisplay} />
            <DocumentRibbonCommand active={outlineVisible} disabled icon={LayoutPanelLeft} label="文档图层" onClick={() => onOutlineVisibleChange(!outlineVisible)} title="图层可见性切换尚未接入工具栏状态" />
            <DocumentRibbonCommand active={layoutGuidesVisible} disabled icon={layoutGuidesVisible ? Monitor : EyeOff} label="布局线" onClick={() => onLayoutGuidesVisibleChange(!layoutGuidesVisible)} title="布局线渲染尚未接入画布状态" />
        </DocumentRibbonGroup>
        <DocumentRibbonGroup disabledReason="开发者信息面板尚未接入页面文档功能区契约。" label="高级" priority="low">
            <DocumentRibbonCommand disabled icon={Code2} label="开发者信息" onClick={onOpenDeveloperInfo} title="开发者信息面板尚未接入" />
        </DocumentRibbonGroup>
    </>
}
