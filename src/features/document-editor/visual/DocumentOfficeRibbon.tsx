// 本组件提供 Office 式顶部功能区外壳；常用命令与组级详细设置入口都不接触文档源码。
import {
    Children,
    createContext,
    useContext,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from 'react'
import {ArrowUpRight, ChevronDown, ChevronUp, type LucideIcon} from 'lucide-react'
import {
    documentRibbonDensity,
    type DocumentRibbonDensity,
    type DocumentRibbonGroupPriority,
    type DocumentRibbonTab,
} from './documentRibbonModel.ts'
import './DocumentOfficeRibbon.css'

export type {DocumentRibbonTab} from './documentRibbonModel.ts'

export interface DocumentRibbonTabOption {
    id: DocumentRibbonTab
    label: string
    icon: LucideIcon
    contextual?: boolean
    disabled?: boolean
}

const DocumentRibbonDensityContext = createContext<DocumentRibbonDensity>('full')

export function DocumentOfficeRibbon({
    activeTab,
    children,
    collapsed,
    onCollapsedChange,
    onTabChange,
    tabs,
    toolbarOnly = false,
    workspaceToolbarHostRef,
}: {
    activeTab: DocumentRibbonTab
    children: ReactNode
    collapsed: boolean
    onCollapsedChange: (collapsed: boolean) => void
    onTabChange: (tab: DocumentRibbonTab) => void
    tabs: readonly DocumentRibbonTabOption[]
    toolbarOnly?: boolean
    workspaceToolbarHostRef?: (node: HTMLDivElement | null) => void
}) {
    const panelRef = useRef<HTMLDivElement | null>(null)
    const [density, setDensity] = useState<DocumentRibbonDensity>('full')

    useLayoutEffect(() => {
        const panel = panelRef.current
        if (!panel || typeof ResizeObserver === 'undefined') return
        const update = () => setDensity(documentRibbonDensity(panel.getBoundingClientRect().width))
        update()
        const observer = new ResizeObserver(update)
        observer.observe(panel)
        return () => observer.disconnect()
    }, [activeTab, collapsed])

    const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!offset) return
        event.preventDefault()
        const enabledTabs = tabs.filter(tab => !tab.disabled)
        const current = enabledTabs.findIndex(tab => tab.id === tabs[index]?.id)
        const next = enabledTabs[(current + offset + enabledTabs.length) % enabledTabs.length]
        if (!next) return
        onTabChange(next.id)
        requestAnimationFrame(() => {
            document.getElementById(`document-ribbon-tab-${next.id}`)?.focus()
        })
    }

    return (
        <section
            aria-label="文档功能区"
            className={`document-office-ribbon${collapsed && !toolbarOnly ? ' is-collapsed' : ''}${
                workspaceToolbarHostRef ? ' has-workspace-toolbar' : ''
            }${toolbarOnly ? ' is-toolbar-only' : ''}`}
        >
            {workspaceToolbarHostRef && (
                <div className="document-ribbon-workspace-toolbar" ref={workspaceToolbarHostRef} />
            )}
            {!toolbarOnly && (
                <>
                    <div className="document-ribbon-tab-row">
                        <div
                            aria-label="功能区页签"
                            className="document-ribbon-tabs"
                            role="tablist"
                        >
                            {tabs.map((tab, index) => {
                                const Icon = tab.icon
                                return (
                                    <button
                                        aria-controls="document-ribbon-panel"
                                        aria-label={tab.label}
                                        aria-selected={activeTab === tab.id}
                                        className={tab.contextual ? 'is-contextual' : undefined}
                                        disabled={tab.disabled}
                                        id={`document-ribbon-tab-${tab.id}`}
                                        key={tab.id}
                                        onClick={() => {
                                            onTabChange(tab.id)
                                            if (collapsed) onCollapsedChange(false)
                                        }}
                                        onKeyDown={event => moveTabFocus(event, index)}
                                        role="tab"
                                        tabIndex={activeTab === tab.id ? 0 : -1}
                                        title={tab.label}
                                        type="button"
                                    >
                                        <Icon size={13} />
                                        <span>{tab.label}</span>
                                    </button>
                                )
                            })}
                        </div>
                        <button
                            aria-label={collapsed ? '展开功能区' : '收起功能区'}
                            className="document-ribbon-collapse"
                            onClick={() => onCollapsedChange(!collapsed)}
                            title={collapsed ? '展开功能区' : '收起功能区'}
                            type="button"
                        >
                            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                        </button>
                    </div>
                    {!collapsed && (
                        <div
                            aria-labelledby={`document-ribbon-tab-${activeTab}`}
                            className={`document-ribbon-panel is-${density}`}
                            id="document-ribbon-panel"
                            ref={panelRef}
                            role="tabpanel"
                        >
                            <DocumentRibbonDensityContext.Provider value={density}>
                                {children}
                            </DocumentRibbonDensityContext.Provider>
                        </div>
                    )}
                </>
            )}
        </section>
    )
}

export function DocumentRibbonGroup({
    children,
    disabledReason,
    label,
    onOpenDetails,
    detailsTitle,
    priority = 'normal',
    slot,
    wide = false,
}: {
    children: ReactNode
    disabledReason?: string | null
    label: string
    onOpenDetails?: () => void
    detailsTitle?: string
    priority?: DocumentRibbonGroupPriority
    slot?: 'font' | 'paragraph' | 'edit' | 'block'
    wide?: boolean
}) {
    // 功能区只承载常用动作；详细设置由统一的组启动器交给属性任务窗格，避免整组退化成大下拉框。
    if (Children.toArray(children).length === 0) return null
    return (
        <div
            aria-disabled={disabledReason ? true : undefined}
            className={`document-ribbon-group${wide ? ' is-wide' : ''}${disabledReason ? ' is-disabled' : ''}`}
            data-ribbon-priority={priority}
            data-ribbon-group={slot}
            title={disabledReason ?? undefined}
        >
            <div className="document-ribbon-group-content">{children}</div>
            <div className="document-ribbon-group-footer">
                <span title={label}>{label}</span>
                {onOpenDetails && (
                    <button
                        aria-label={detailsTitle ?? `打开${label}详细设置`}
                        disabled={Boolean(disabledReason)}
                        onClick={onOpenDetails}
                        title={detailsTitle ?? `打开${label}详细设置`}
                        type="button"
                    >
                        <ArrowUpRight size={10} />
                    </button>
                )}
            </div>
        </div>
    )
}

export function DocumentRibbonRows({first, second}: {first: ReactNode; second: ReactNode}) {
    return (
        <div className="document-ribbon-two-rows">
            <div data-ribbon-row="first">{first}</div>
            <div data-ribbon-row="second">{second}</div>
        </div>
    )
}

export function DocumentRibbonCommand({
    active,
    ariaLabel,
    danger = false,
    disabled,
    icon: Icon,
    label,
    onClick,
    size = 'small',
    title,
}: {
    active?: boolean
    ariaLabel?: string
    danger?: boolean
    disabled?: boolean
    icon: LucideIcon
    label: string
    onClick: () => void
    size?: 'small' | 'large'
    title?: string
}) {
    const density = useContext(DocumentRibbonDensityContext)
    const iconOnly = size === 'small' && density !== 'full'
    return (
        <button
            aria-label={ariaLabel ?? label}
            aria-pressed={active}
            className={`document-ribbon-command is-${size}${danger ? ' is-danger' : ''}${iconOnly ? ' is-icon-only' : ''}`}
            disabled={disabled}
            onClick={onClick}
            title={title ?? label}
            type="button"
        >
            <Icon size={17} />
            <span>{label}</span>
        </button>
    )
}
