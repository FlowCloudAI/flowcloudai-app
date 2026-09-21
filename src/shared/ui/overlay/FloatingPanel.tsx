import {type ReactNode, type RefObject, useId} from 'react'
import {Button} from 'flowcloudai-ui'
import Overlay from './Overlay'

export interface FloatingPanelProps {
    open: boolean
    onClose?: () => void
    dismissible?: boolean
    /** 输入建议等浮层不夺取编辑焦点，也不锁定页面滚动。 */
    passive?: boolean
    /** 提供触发器后改为贴靠式浮层；省略时维持原有居中面板。 */
    anchorRef?: RefObject<HTMLElement | null>
    /** 浮层背板附加类名，用于全屏等页面级布局。 */
    layerClassName?: string
    className?: string
    title?: ReactNode
    ariaLabel?: string
    labelledBy?: string
    dataTourId?: string
    closeLabel?: string
    showCloseButton?: boolean
    children?: ReactNode
}

/**
 * 浮动面板：默认居中；提供 anchorRef 时贴近触发器并自动避让视口边缘。基于 Overlay。
 */
export default function FloatingPanel({
    title,
    onClose,
    dismissible = true,
    ariaLabel,
    labelledBy,
    closeLabel = '关闭',
    showCloseButton,
    anchorRef,
    children,
    ...props
}: FloatingPanelProps) {
    const generatedTitleId = useId()
    const titleId = labelledBy ?? (title ? generatedTitleId : undefined)
    const shouldShowCloseButton = showCloseButton ?? Boolean(onClose)
    const shouldShowHeader = Boolean(title || (shouldShowCloseButton && onClose))

    return (
        <Overlay
            variant={anchorRef ? 'anchored' : 'floating'}
            anchorRef={anchorRef}
            onClose={onClose}
            dismissible={dismissible}
            ariaLabel={titleId ? undefined : ariaLabel}
            labelledBy={titleId}
            {...props}
        >
            {shouldShowHeader && (
                <div className="fc-floating-panel__header">
                    {title && (
                        <div id={titleId} className="fc-floating-panel__title">
                            {title}
                        </div>
                    )}
                    {shouldShowCloseButton && onClose && (
                        <Button
                            type="button"
                            className="fc-floating-panel__close"
                            variant="ghost"
                            size="sm"
                            iconOnly
                            circle
                            aria-label={closeLabel}
                            disabled={!dismissible}
                            onClick={onClose}
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                                <path
                                    d="M5 5L15 15M15 5L5 15"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </Button>
                    )}
                </div>
            )}
            {children}
        </Overlay>
    )
}
