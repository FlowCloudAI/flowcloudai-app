import {
    type ButtonHTMLAttributes,
    type CSSProperties,
    type ReactNode,
    type RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import {pushOverlay, removeOverlay} from '../../../shared/ui/overlay/overlayStack'
import './MobileTopControls.css'

/** 读不到 CSS 变量时的兜底，正常路径下不应命中。 */
const MOBILE_ANCHORED_MENU_CLOSE_FALLBACK_MS = 220

/** 与 CSS 里 max-height 的 `- 1rem` 留白保持一致，用来算某一侧真正能用多少高度。 */
const MOBILE_ANCHORED_MENU_VIEWPORT_GAP = 16

/**
 * 一侧至少要有这么多高度才算「放得下」：容器上下内边距（2 * --fc-space-md ≈ 24px）
 * 加两行（row 的 min-height 是 3.15rem ≈ 50px）。低于这个值菜单已经不成菜单，
 * 宁可翻到另一侧。取值偏保守是刻意的——只在真的塞不下时才推翻调用方给的 placement。
 */
const MOBILE_ANCHORED_MENU_MIN_SPACE = 128

/**
 * 定下实际生效的展开方向。`placement` 退化为「偏好」：只有偏好那一侧确实放不下、
 * 且另一侧更宽裕时才翻面。
 *
 * 注意两侧可用高度的算法不对称，因为菜单不是贴着锚点外侧排的：
 * placement=bottom 时容器 top 对齐锚点的**上**边往下长，所以可用高度从 anchor.top 算起；
 * placement=top 时容器 bottom 对齐锚点的**下**边往上长，可用高度到 anchor.bottom 为止。
 * 这两条和 CSS 里那两个 max-height 是同一套算式，改一处要一起改。
 */
function resolveAnchoredMenuPlacement(
    preferred: 'bottom' | 'top',
    anchorTop: number,
    anchorBottom: number,
    viewportHeight: number,
): 'bottom' | 'top' {
    const spaceForBottom = viewportHeight - anchorTop - MOBILE_ANCHORED_MENU_VIEWPORT_GAP
    const spaceForTop = anchorBottom - MOBILE_ANCHORED_MENU_VIEWPORT_GAP
    const preferredSpace = preferred === 'bottom' ? spaceForBottom : spaceForTop
    const flippedSpace = preferred === 'bottom' ? spaceForTop : spaceForBottom
    if (preferredSpace >= MOBILE_ANCHORED_MENU_MIN_SPACE) return preferred
    if (flippedSpace <= preferredSpace) return preferred
    return preferred === 'bottom' ? 'top' : 'bottom'
}

/**
 * 收起时长以 CSS 的 --mobile-anchored-menu-duration-close 为准。
 * 卸载时机必须等于收尾动画时长，早了会截断、晚了会留着不可见的 DOM；
 * 两边各写一个数字迟早失步，所以这里去读 CSS 声明的那一份
 * （reduced-motion 降级也是改这个变量，因此会一起跟上）。
 */
function readAnchoredMenuCloseMs(element: HTMLElement | null): number {
    if (!element) return MOBILE_ANCHORED_MENU_CLOSE_FALLBACK_MS
    const raw = window.getComputedStyle(element)
        .getPropertyValue('--mobile-anchored-menu-duration-close')
        .trim()
    if (!raw) return MOBILE_ANCHORED_MENU_CLOSE_FALLBACK_MS
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value) || value < 0) return MOBILE_ANCHORED_MENU_CLOSE_FALLBACK_MS
    return raw.endsWith('ms') ? value : value * 1000
}

export interface MobilePageTopBarProps {
    left?: ReactNode
    center?: ReactNode
    right?: ReactNode
    className?: string
    sticky?: boolean
    edgeToEdge?: boolean
    ariaLabel?: string
}

/**
 * 移动端页面顶栏外框：只统一高度、贴顶方式、背景和三段插槽。
 * 具体按钮、标题内容和菜单锚点仍由页面传入，避免把页面业务塞进通用组件。
 */
export function MobilePageTopBar({
    left,
    center,
    right,
    className,
    sticky = false,
    edgeToEdge = false,
    ariaLabel,
}: MobilePageTopBarProps) {
    return (
        <header
            className={`mobile-page-topbar${sticky ? ' mobile-page-topbar--sticky' : ''}${edgeToEdge ? ' mobile-page-topbar--edge-to-edge' : ''}${className ? ` ${className}` : ''}`}
            aria-label={ariaLabel}
        >
            <div className="mobile-page-topbar__side mobile-page-topbar__side--left">
                {left}
            </div>
            <div className="mobile-page-topbar__center">
                {center}
            </div>
            <div className="mobile-page-topbar__side mobile-page-topbar__side--right">
                {right}
            </div>
        </header>
    )
}

export interface MobileTopAction {
    key: string
    label: string
    icon: ReactNode
    onClick: () => void
    disabled?: boolean
    kind?: 'add' | 'more'
    ariaHasPopup?: ButtonHTMLAttributes<HTMLButtonElement>['aria-haspopup']
    ariaExpanded?: boolean
}

export interface MobileTopActionPillProps {
    actions: MobileTopAction[]
    className?: string
}

export const MobileTopActionPill = forwardRef<HTMLDivElement, MobileTopActionPillProps>(
    function MobileTopActionPill({actions, className}, ref) {
        const expanded = actions.some(action => action.ariaExpanded)
        return (
            <div
                ref={ref}
                className={`mobile-top-action-pill${expanded ? ' mobile-top-action-pill--expanded' : ''}${className ? ` ${className}` : ''}`}
            >
                {actions.map(action => (
                    <button
                        key={action.key}
                        type="button"
                        className={`mobile-top-action-pill__button mobile-top-action-pill__button--${action.kind ?? 'default'}`}
                        aria-label={action.label}
                        aria-haspopup={action.ariaHasPopup}
                        aria-expanded={action.ariaExpanded}
                        disabled={action.disabled}
                        onClick={action.onClick}
                    >
                        <span className="mobile-top-action-pill__icon" aria-hidden="true">
                            {action.icon}
                        </span>
                    </button>
                ))}
            </div>
        )
    }
)

export interface MobileAnchoredMenuProps {
    open: boolean
    onClose: () => void
    anchorRef: RefObject<HTMLElement | null>
    containerRef: RefObject<HTMLElement | null>
    ariaLabel: string
    children: ReactNode
    className?: string
    align?: 'left' | 'right'
    placement?: 'bottom' | 'top'
    rightBoundaryRef?: RefObject<HTMLElement | null>
    rightBoundaryGap?: number
}

export function MobileAnchoredMenu({
    open,
    onClose,
    anchorRef,
    containerRef,
    ariaLabel,
    children,
    className,
    align = 'right',
    placement = 'bottom',
    rightBoundaryRef,
    rightBoundaryGap = 0,
}: MobileAnchoredMenuProps) {
    const [anchor, setAnchor] = useState<{top: number; bottom: number; left: number; right: number; width: number; height: number; borderColor: string; rightBoundary: number | null; placement: 'bottom' | 'top'} | null>(null)
    const [rendered, setRendered] = useState(open)
    const [closing, setClosing] = useState(false)
    const [anchorReady, setAnchorReady] = useState(false)
    const menuRef = useRef<HTMLDivElement | null>(null)

    const updateAnchor = useCallback(() => {
        const containerElement = containerRef.current
        const anchorElement = anchorRef.current
        if (!anchorElement) return
        const viewportWidth = window.innerWidth || containerElement?.clientWidth || 0
        const viewportHeight = window.innerHeight || containerElement?.clientHeight || 0
        const anchorRect = anchorElement.getBoundingClientRect()
        const anchorStyle = window.getComputedStyle(anchorElement)
        const boundaryRect = rightBoundaryRef?.current?.getBoundingClientRect()
        setAnchor({
            top: Math.max(0, anchorRect.top),
            bottom: Math.max(0, viewportHeight - anchorRect.bottom),
            left: Math.max(0, anchorRect.left),
            right: Math.max(0, viewportWidth - anchorRect.right),
            width: anchorRect.width,
            height: anchorRect.height,
            borderColor: anchorStyle.borderTopColor,
            rightBoundary: boundaryRect
                ? Math.max(0, boundaryRect.left - rightBoundaryGap)
                : null,
            placement: resolveAnchoredMenuPlacement(
                placement,
                Math.max(0, anchorRect.top),
                Math.min(viewportHeight, anchorRect.bottom),
                viewportHeight,
            ),
        })
    }, [anchorRef, containerRef, placement, rightBoundaryGap, rightBoundaryRef])

    useEffect(() => {
        if (open) {
            setRendered(true)
            setClosing(false)
            return undefined
        }
        if (!rendered) return undefined
        setClosing(true)
        const timer = window.setTimeout(() => {
            setRendered(false)
            setClosing(false)
        }, readAnchoredMenuCloseMs(menuRef.current))
        return () => window.clearTimeout(timer)
    }, [open, rendered])

    /*
     * 必须在菜单进 DOM 之前把锚点量好（见下方的 anchorReady 闸门）。
     * @starting-style 取的是元素第一次样式解析时的值，那时候要是
     * --mobile-anchored-menu-anchor-* 还没写进 style，latch 到的就是 CSS 里的默认值
     * （--mobile-top-surface-size，等于单按钮胶囊的尺寸）——双按钮胶囊首次展开
     * 就会从一个偏窄的起始形状长出来，正好毁掉「从这颗按钮长出来」这件事本身。
     */
    useLayoutEffect(() => {
        if (!open) {
            setAnchorReady(false)
            return
        }
        updateAnchor()
        setAnchorReady(true)
    }, [open, updateAnchor])

    const onCloseRef = useRef(onClose)
    useEffect(() => {
        onCloseRef.current = onClose
    }, [onClose])

    /*
     * 打开期间注册到浮层返回栈：安卓物理返回键（以及外接键盘 Esc）走 MobileApp.handleBack，
     * 它会先 closeTopOverlay()。不注册的话返回键会越过菜单直接退页面——
     * 「按钮 + 返回键都能退出当前层」是移动端的基线预期。
     */
    useEffect(() => {
        if (!open) return undefined
        const id = pushOverlay(() => onCloseRef.current())
        return () => removeOverlay(id)
    }, [open])

    useEffect(() => {
        if (!open) return undefined
        updateAnchor()
        const viewport = window.visualViewport
        window.addEventListener('resize', updateAnchor)
        viewport?.addEventListener('resize', updateAnchor)
        return () => {
            window.removeEventListener('resize', updateAnchor)
            viewport?.removeEventListener('resize', updateAnchor)
        }
    }, [open, updateAnchor])

    if (!open && !rendered) return null
    /*
     * 打开时先跳过一次渲染，等上面那个 layout effect 量完锚点再挂载。
     * setAnchorReady 发生在 layout effect 里，重渲染在同一帧的绘制前就冲掉了，所以不会慢一帧。
     * 收起中（open=false、rendered=true）不受这道闸门影响，退场动画照常播。
     */
    if (open && !anchorReady) return null

    return (
        <div
            className={`mobile-anchored-menu-layer${closing ? ' mobile-anchored-menu-layer--closing' : ''}`}
            role="presentation"
            onPointerDown={event => {
                if (!closing && event.target === event.currentTarget) onClose()
            }}
        >
            <div
                ref={menuRef}
                className={`mobile-anchored-menu mobile-anchored-menu--${align} mobile-anchored-menu--placement-${anchor?.placement ?? placement}${closing ? ' mobile-anchored-menu--closing' : ''}${className ? ` ${className}` : ''}`}
                role="menu"
                aria-label={ariaLabel}
                data-open={open}
                style={anchor ? {
                    '--mobile-anchored-menu-top': `${anchor.top}px`,
                    '--mobile-anchored-menu-bottom': `${anchor.bottom}px`,
                    '--mobile-anchored-menu-left': `${anchor.left}px`,
                    '--mobile-anchored-menu-right': `${anchor.right}px`,
                    '--mobile-anchored-menu-anchor-width': `${anchor.width}px`,
                    '--mobile-anchored-menu-anchor-height': `${anchor.height}px`,
                    '--mobile-anchored-menu-anchor-border-color': anchor.borderColor,
                    ...(anchor.rightBoundary != null
                        ? {'--mobile-anchored-menu-right-boundary': `${anchor.rightBoundary}px`}
                        : {}),
                } as CSSProperties : undefined}
                onPointerDown={event => event.stopPropagation()}
            >
                <div className="mobile-anchored-menu__content">
                    {children}
                </div>
            </div>
        </div>
    )
}

export interface MobileAnchoredMenuItem {
    key: string
    label: string
    description?: string
    icon?: ReactNode
    danger?: boolean
    disabled?: boolean
    onSelect: () => void
}

export interface MobileAnchoredActionMenuProps extends Omit<MobileAnchoredMenuProps, 'children'> {
    items: MobileAnchoredMenuItem[]
}

export function MobileAnchoredActionMenu({
    items,
    onClose,
    ...menuProps
}: MobileAnchoredActionMenuProps) {
    return (
        <MobileAnchoredMenu {...menuProps} onClose={onClose}>
            <div className="mobile-anchored-menu__group">
                {items.map(item => (
                    <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        className={`mobile-anchored-menu__row${item.danger ? ' mobile-anchored-menu__row--danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            onClose()
                            item.onSelect()
                        }}
                    >
                        <span className="mobile-anchored-menu__check" aria-hidden="true"/>
                        <span className="mobile-anchored-menu__icon" aria-hidden="true">
                            {item.icon}
                        </span>
                        <span className="mobile-anchored-menu__text">
                            <span>{item.label}</span>
                            {item.description ? <small>{item.description}</small> : null}
                        </span>
                    </button>
                ))}
            </div>
        </MobileAnchoredMenu>
    )
}

export function MobileBackIcon() {
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M14.5 5.5 8 12l6.5 6.5"/>
        </svg>
    )
}

export function MobileCheckIcon() {
    return (
        <svg className="mobile-check-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M5 12.5 9.2 16.7 19 6.8"/>
        </svg>
    )
}

export function MobileMenuIcon({className = 'mobile-top-control-svg'}: {className?: string}) {
    return (
        <svg className={className} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M5 7h14"/>
            <path d="M5 12h14"/>
            <path d="M5 17h14"/>
        </svg>
    )
}

export function MobileSearchIcon({className}: {className?: string}) {
    return (
        <svg className={className} viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="5.8"/>
            <path d="m15 15 4.5 4.5"/>
        </svg>
    )
}

export function MobileAddIcon({className = ''}: {className?: string} = {}) {
    return (
        <svg
            className={`mobile-top-control-svg mobile-top-control-svg--add${className ? ` ${className}` : ''}`}
            viewBox="0 0 24 24"
            focusable="false"
        >
            <path d="M12 4.5v15"/>
            <path d="M4.5 12h15"/>
        </svg>
    )
}

export function MobileMoreIcon() {
    return (
        <svg className="mobile-top-control-svg mobile-top-control-svg--more" viewBox="0 0 24 24" focusable="false">
            <circle cx="5" cy="12" r="1.65"/>
            <circle cx="12" cy="12" r="1.65"/>
            <circle cx="19" cy="12" r="1.65"/>
        </svg>
    )
}
