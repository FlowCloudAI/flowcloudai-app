// 本组件提供 Office 式顶部功能区外壳；两行布局、宽度收缩和浮动组菜单都不接触文档源码。
import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
} from 'react'
import {createPortal} from 'react-dom'
import {ChevronDown, ChevronRight, ChevronUp, type LucideIcon} from 'lucide-react'
import {
    documentRibbonDensity,
    ribbonGroupIsCollapsed,
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
    slot?: 'font' | 'paragraph' | 'style' | 'edit' | 'block'
    wide?: boolean
}) {
    const density = useContext(DocumentRibbonDensityContext)
    const collapsed = ribbonGroupIsCollapsed(density, priority)
    const [menuOpen, setMenuOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

    useLayoutEffect(() => {
        if (!menuOpen) return
        const trigger = triggerRef.current
        const menu = menuRef.current
        if (!trigger || !menu) return
        const anchor = trigger.getBoundingClientRect()
        const bounds = menu.getBoundingClientRect()
        const gap = 4
        const left = Math.max(gap, Math.min(anchor.left, window.innerWidth - bounds.width - gap))
        const below = anchor.bottom + gap
        const top =
            below + bounds.height <= window.innerHeight - gap
                ? below
                : Math.max(gap, anchor.top - bounds.height - gap)
        setMenuStyle({left, top})
    }, [menuOpen])

    useEffect(() => {
        if (!menuOpen) return
        const closeOnPointer = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
            setMenuOpen(false)
        }
        const closeOnKey = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') return
            setMenuOpen(false)
            triggerRef.current?.focus()
        }
        document.addEventListener('pointerdown', closeOnPointer)
        document.addEventListener('keydown', closeOnKey)
        return () => {
            document.removeEventListener('pointerdown', closeOnPointer)
            document.removeEventListener('keydown', closeOnKey)
        }
    }, [menuOpen])

    const content = <div className="document-ribbon-group-content">{children}</div>
    return (
        <div
            aria-disabled={disabledReason ? true : undefined}
            className={`document-ribbon-group${wide ? ' is-wide' : ''}${disabledReason ? ' is-disabled' : ''}${collapsed ? ' is-group-collapsed' : ''}`}
            data-ribbon-priority={priority}
            data-ribbon-group={slot}
            title={disabledReason ?? undefined}
        >
            {collapsed ? (
                <button
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    className="document-ribbon-group-trigger"
                    onClick={() => setMenuOpen(open => !open)}
                    ref={triggerRef}
                    title={`展开${label}组`}
                    type="button"
                >
                    <span>{label}</span>
                    <ChevronDown size={13} />
                </button>
            ) : (
                content
            )}
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
                        <ChevronRight size={11} />
                    </button>
                )}
            </div>
            {collapsed &&
                menuOpen &&
                createPortal(
                    <div
                        aria-label={`${label}组命令`}
                        className="document-ribbon-group-menu"
                        ref={menuRef}
                        role="menu"
                        style={menuStyle}
                    >
                        <strong>{label}</strong>
                        {content}
                        {onOpenDetails && (
                            <button
                                className="document-ribbon-group-menu-details"
                                disabled={Boolean(disabledReason)}
                                onClick={() => {
                                    setMenuOpen(false)
                                    onOpenDetails()
                                }}
                                type="button"
                            >
                                详细设置
                                <ChevronRight size={12} />
                            </button>
                        )}
                    </div>,
                    document.body,
                )}
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
