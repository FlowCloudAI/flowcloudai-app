import './TourProvider.css'
import {Button, useAlertModalState} from 'flowcloudai-ui'
import {
    type CSSProperties,
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {createPortal} from 'react-dom'
import {logger} from '../../shared/logger'
import {
    type StartTourOptions,
    TourContext,
    type TourContextValue,
    type TourDefinition,
    type TourLabels,
    type TourNavigationDirection,
    type TourPlacement,
    type TourStep,
    type TourStepLeaveReason,
    type TourStepTarget,
    type TourTargetStatus,
} from './tourContext'

interface TourProviderProps {
    children: ReactNode
}

interface ActiveTour {
    definition: TourDefinition
    currentIndex: number
    markCompletedOnSkip: boolean
}

interface TourTargetRect {
    top: number
    right: number
    bottom: number
    left: number
    width: number
    height: number
}

interface TooltipSize {
    width: number
    height: number
}

interface PopoverLayout {
    style: CSSProperties
    arrowClassName: string
    arrowStyle: CSSProperties
}

const DEFAULT_TARGET_WAIT_MS = 5000
const TARGET_MESSAGE_DEBOUNCE_MS = 500
const TOUR_GLIDE_RESET_MS = 320
const TARGET_PADDING = 8
const POPOVER_GAP = 26
const VIEWPORT_MARGIN = 16
const DEFAULT_TOOLTIP_SIZE: TooltipSize = {
    width: 360,
    height: 176,
}

const DEFAULT_LABELS: Required<TourLabels> = {
    previous: '上一步',
    next: '下一步',
    skip: '跳过',
    finish: '完成',
}

export function TourProvider({children}: TourProviderProps) {
    const isAlertModalOpen = useAlertModalState()
    const [registeredTours, setRegisteredTours] = useState<Record<string, TourDefinition>>({})
    const [activeTour, setActiveTour] = useState<ActiveTour | null>(null)
    const [targetRect, setTargetRect] = useState<TourTargetRect | null>(null)
    const [targetStatus, setTargetStatus] = useState<TourTargetStatus>('none')
    const targetElementRef = useRef<Element | null>(null)
    const isPreparingStepRef = useRef(false)
    const navigationDirectionRef = useRef<TourNavigationDirection>('start')
    const glideTimerRef = useRef<number | null>(null)
    const [isGliding, setIsGliding] = useState(false)

    const currentStep = activeTour?.definition.steps[activeTour.currentIndex] ?? null

    const registerTour = useCallback((definition: TourDefinition) => {
        setRegisteredTours(prev => ({
            ...prev,
            [definition.id]: definition,
        }))

        return () => {
            setRegisteredTours(prev => {
                if (prev[definition.id] !== definition) return prev
                const next = {...prev}
                delete next[definition.id]
                return next
            })
        }
    }, [])

    const runAfterLeave = useCallback((tour: ActiveTour, reason: TourStepLeaveReason) => {
        const step = tour.definition.steps[tour.currentIndex]
        if (!step?.afterLeave) return

        Promise.resolve(step.afterLeave({
            tourId: tour.definition.id,
            stepId: step.id,
            stepIndex: tour.currentIndex,
            reason,
        })).catch(error => {
            logger.warn('引导步骤离开回调执行失败', error)
        })
    }, [])

    const startTour = useCallback((definition: TourDefinition, options?: StartTourOptions) => {
        if (definition.steps.length === 0) return false
        if (!options?.force && isStoredTourCompleted(definition)) return false

        const requestedIndex = options?.fromStepId
            ? definition.steps.findIndex(step => step.id === options.fromStepId)
            : 0
        const currentIndex = requestedIndex >= 0 ? requestedIndex : 0

        navigationDirectionRef.current = 'start'
        setActiveTour({
            definition,
            currentIndex,
            markCompletedOnSkip: options?.markCompletedOnSkip ?? true,
        })
        return true
    }, [])

    const startRegisteredTour = useCallback((tourId: string, options?: StartTourOptions) => {
        const definition = registeredTours[tourId]
        if (!definition) return false
        return startTour(definition, options)
    }, [registeredTours, startTour])

    const stopTour = useCallback(() => {
        setActiveTour(prev => {
            if (prev) runAfterLeave(prev, 'stop')
            return null
        })
    }, [runAfterLeave])

    const skipTour = useCallback(() => {
        setActiveTour(prev => {
            if (!prev) return null
            if (prev.markCompletedOnSkip) {
                markStoredTourCompleted(prev.definition)
            }
            runAfterLeave(prev, 'skip')
            return null
        })
    }, [runAfterLeave])

    const completeTour = useCallback(() => {
        setActiveTour(prev => {
            if (!prev) return null
            markStoredTourCompleted(prev.definition)
            runAfterLeave(prev, 'complete')
            return null
        })
    }, [runAfterLeave])

    const nextStep = useCallback(() => {
        setActiveTour(prev => {
            if (!prev) return null
            if (prev.currentIndex >= prev.definition.steps.length - 1) {
                markStoredTourCompleted(prev.definition)
                runAfterLeave(prev, 'complete')
                return null
            }

            navigationDirectionRef.current = 'next'
            runAfterLeave(prev, 'next')
            return {
                ...prev,
                currentIndex: prev.currentIndex + 1,
            }
        })
    }, [runAfterLeave])

    const previousStep = useCallback(() => {
        setActiveTour(prev => {
            if (!prev || prev.currentIndex <= 0) return prev

            navigationDirectionRef.current = 'previous'
            runAfterLeave(prev, 'previous')
            return {
                ...prev,
                currentIndex: prev.currentIndex - 1,
            }
        })
    }, [runAfterLeave])

    const goToStep = useCallback((stepIndex: number) => {
        setActiveTour(prev => {
            if (!prev) return null
            const maxIndex = prev.definition.steps.length - 1
            const nextIndex = clamp(stepIndex, 0, maxIndex)
            if (nextIndex === prev.currentIndex) return prev

            const reason: TourStepLeaveReason = nextIndex > prev.currentIndex ? 'next' : 'previous'
            navigationDirectionRef.current = reason
            runAfterLeave(prev, reason)
            return {
                ...prev,
                currentIndex: nextIndex,
            }
        })
    }, [runAfterLeave])

    const isTourCompleted = useCallback((definition: TourDefinition) => (
        isStoredTourCompleted(definition)
    ), [])

    const resetTourCompletion = useCallback((definitionOrStorageKey: TourDefinition | string) => {
        const storageKey = typeof definitionOrStorageKey === 'string'
            ? definitionOrStorageKey
            : getTourStorageKey(definitionOrStorageKey)
        safeStorageRemove(storageKey)
    }, [])

    const clearGlideTimer = useCallback(() => {
        if (glideTimerRef.current === null) return
        window.clearTimeout(glideTimerRef.current)
        glideTimerRef.current = null
    }, [])

    const startGlide = useCallback(() => {
        clearGlideTimer()
        setIsGliding(true)
    }, [clearGlideTimer])

    const finishGlide = useCallback(() => {
        clearGlideTimer()
        setIsGliding(true)
        glideTimerRef.current = window.setTimeout(() => {
            glideTimerRef.current = null
            setIsGliding(false)
        }, TOUR_GLIDE_RESET_MS)
    }, [clearGlideTimer])

    const syncTargetRect = useCallback((markMissing: boolean) => {
        const element = targetElementRef.current
        if (!element || !document.documentElement.contains(element)) {
            if (markMissing) setTargetStatus(status => status === 'ready' ? status : 'waiting')
            return false
        }

        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
            if (markMissing) setTargetStatus(status => status === 'ready' ? status : 'waiting')
            return false
        }

        setTargetRect(toTourTargetRect(rect))
        setTargetStatus('ready')
        return true
    }, [])

    useLayoutEffect(() => {
        if (!activeTour || !currentStep) {
            targetElementRef.current = null
            isPreparingStepRef.current = false
            clearGlideTimer()
            setIsGliding(false)
            setTargetRect(null)
            setTargetStatus('none')
            return undefined
        }

        let disposed = false
        let removeTargetClickListener: (() => void) | null = null

        const refreshTargetRect = () => {
            if (disposed || isPreparingStepRef.current) return
            syncTargetRect(Boolean(currentStep.target && targetElementRef.current))
        }

        const prepareStep = async () => {
            const shouldGlide = navigationDirectionRef.current !== 'start'
            if (shouldGlide) startGlide()
            targetElementRef.current = null
            isPreparingStepRef.current = Boolean(currentStep.target)
            if (!currentStep.target) setTargetRect(null)
            setTargetStatus(currentStep.target ? 'waiting' : 'none')

            if (currentStep.beforeEnter) {
                try {
                    await currentStep.beforeEnter({
                        tourId: activeTour.definition.id,
                        stepId: currentStep.id,
                        stepIndex: activeTour.currentIndex,
                        direction: navigationDirectionRef.current,
                    })
                } catch (error) {
                    logger.warn('引导步骤进入回调执行失败', error)
                }
            }

            if (disposed) return
            if (!currentStep.target) {
                isPreparingStepRef.current = false
                if (shouldGlide) finishGlide()
                return
            }

            const element = await waitForTarget(
                currentStep.target,
                currentStep.waitTimeoutMs ?? DEFAULT_TARGET_WAIT_MS,
                () => disposed,
            )
            if (disposed) return

            targetElementRef.current = element
            if (!element) {
                isPreparingStepRef.current = false
                setTargetRect(null)
                setTargetStatus('missing')
                if (shouldGlide) finishGlide()
                return
            }

            if (scrollTourTargetIntoView(element)) {
                await waitForAnimationFrame()
                await waitForAnimationFrame()
                if (disposed) return
            }

            const latestElement = await waitForTarget(
                currentStep.target,
                currentStep.waitTimeoutMs ?? DEFAULT_TARGET_WAIT_MS,
                () => disposed,
            )
            if (disposed) return
            targetElementRef.current = latestElement
            if (!latestElement) {
                isPreparingStepRef.current = false
                setTargetRect(null)
                setTargetStatus('missing')
                if (shouldGlide) finishGlide()
                return
            }

            isPreparingStepRef.current = false
            syncTargetRect(true)
            if (shouldGlide) finishGlide()

            if (currentStep.advanceOnTargetClick) {
                const handleTargetClick = () => {
                    window.setTimeout(nextStep, 0)
                }
                element.addEventListener('click', handleTargetClick)
                removeTargetClickListener = () => {
                    element.removeEventListener('click', handleTargetClick)
                }
            }
        }

        void prepareStep()
        window.addEventListener('resize', refreshTargetRect)
        window.addEventListener('scroll', refreshTargetRect, true)

        const mutationObserver = new MutationObserver(refreshTargetRect)
        mutationObserver.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
        })

        return () => {
            disposed = true
            isPreparingStepRef.current = false
            clearGlideTimer()
            removeTargetClickListener?.()
            window.removeEventListener('resize', refreshTargetRect)
            window.removeEventListener('scroll', refreshTargetRect, true)
            mutationObserver.disconnect()
        }
    }, [activeTour, clearGlideTimer, currentStep, finishGlide, nextStep, startGlide, syncTargetRect])

    useEffect(() => {
        if (!activeTour) return undefined

        const handleKeyDown = (event: KeyboardEvent) => {
            if (isAlertModalOpen) return
            if (event.key !== 'Escape' && isEditingElement(event.target)) return

            if (event.key === 'Escape') {
                event.preventDefault()
                skipTour()
            } else if (event.key === 'ArrowRight') {
                event.preventDefault()
                nextStep()
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                previousStep()
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
        }
    }, [activeTour, isAlertModalOpen, nextStep, previousStep, skipTour])

    const contextValue = useMemo<TourContextValue>(() => ({
        isActive: Boolean(activeTour),
        activeTourId: activeTour?.definition.id ?? null,
        currentStep,
        currentIndex: activeTour?.currentIndex ?? -1,
        totalSteps: activeTour?.definition.steps.length ?? 0,
        targetStatus,
        registerTour,
        startTour,
        startRegisteredTour,
        stopTour,
        skipTour,
        completeTour,
        nextStep,
        previousStep,
        goToStep,
        isTourCompleted,
        resetTourCompletion,
    }), [
        activeTour,
        completeTour,
        currentStep,
        goToStep,
        isTourCompleted,
        nextStep,
        previousStep,
        registerTour,
        resetTourCompletion,
        skipTour,
        startRegisteredTour,
        startTour,
        stopTour,
        targetStatus,
    ])

    return (
        <TourContext.Provider value={contextValue}>
            {children}
            {activeTour && currentStep
                ? createPortal(
                    <TourOverlay
                        activeTour={activeTour}
                        currentStep={currentStep}
                        isGliding={isGliding}
                        targetRect={targetRect}
                        targetStatus={targetStatus}
                        onPrevious={previousStep}
                        onNext={nextStep}
                        onSkip={skipTour}
                    />,
                    document.body,
                )
                : null}
        </TourContext.Provider>
    )
}

interface TourOverlayProps {
    activeTour: ActiveTour
    currentStep: TourStep
    isGliding: boolean
    targetRect: TourTargetRect | null
    targetStatus: TourTargetStatus
    onPrevious: () => void
    onNext: () => void
    onSkip: () => void
}

function TourOverlay({
    activeTour,
    currentStep,
    isGliding,
    targetRect,
    targetStatus,
    onPrevious,
    onNext,
    onSkip,
}: TourOverlayProps) {
    const tooltipRef = useRef<HTMLDivElement | null>(null)
    const [tooltipSize, setTooltipSize] = useState<TooltipSize>(DEFAULT_TOOLTIP_SIZE)
    const currentIndex = activeTour.currentIndex
    const totalSteps = activeTour.definition.steps.length
    const isLastStep = currentIndex >= totalSteps - 1
    const labels = {
        ...DEFAULT_LABELS,
        ...activeTour.definition.labels,
        ...currentStep.labels,
    }
    const allowTargetInteraction = Boolean(currentStep.allowTargetInteraction || currentStep.advanceOnTargetClick)
    const paddedTargetRect = targetRect ? getPaddedTargetRect(targetRect) : null
    const popoverLayout = getPopoverLayout(currentStep, targetRect, tooltipSize)
    const rawTargetMessage = targetStatus === 'waiting' && targetRect ? '' : getTargetMessage(targetStatus)
    const [showTargetMessage, setShowTargetMessage] = useState(false)
    const targetMessage = showTargetMessage ? rawTargetMessage : ''

    useEffect(() => {
        if (!rawTargetMessage) {
            setShowTargetMessage(false)
            return undefined
        }

        setShowTargetMessage(false)
        const timer = window.setTimeout(() => {
            setShowTargetMessage(true)
        }, TARGET_MESSAGE_DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
    }, [currentStep.id, rawTargetMessage])

    useLayoutEffect(() => {
        const element = tooltipRef.current
        if (!element) return

        const rect = element.getBoundingClientRect()
        setTooltipSize({
            width: rect.width,
            height: rect.height,
        })
    }, [currentStep.id, targetMessage, targetRect, targetStatus])

    return (
        <div className="fc-tour-layer" data-glide={isGliding ? 'true' : undefined} aria-live="polite">
            {getScrimStyles(targetRect).map((style, index) => (
                <div
                    key={index}
                    className="fc-tour-scrim"
                    style={style}
                    aria-hidden="true"
                />
            ))}
            {paddedTargetRect && !allowTargetInteraction && (
                <div
                    className="fc-tour-target-blocker"
                    style={paddedTargetRect}
                    aria-hidden="true"
                />
            )}
            {paddedTargetRect && (
                <div
                    className="fc-tour-highlight"
                    style={paddedTargetRect}
                    aria-hidden="true"
                />
            )}
            <div
                ref={tooltipRef}
                className="fc-tour-popover"
                style={popoverLayout.style}
                role="dialog"
                aria-modal="true"
                aria-labelledby="fc-tour-title"
                aria-describedby="fc-tour-content"
            >
                {targetRect && (
                    <span
                        className={`fc-tour-popover__arrow ${popoverLayout.arrowClassName}`}
                        style={popoverLayout.arrowStyle}
                        aria-hidden="true"
                    />
                )}
                <div className="fc-tour-progress">
                    <span>{currentIndex + 1} / {totalSteps}</span>
                </div>
                <div key={currentStep.id} className="fc-tour-body">
                    <h2 id="fc-tour-title" className="fc-tour-title">{currentStep.title}</h2>
                    <div id="fc-tour-content" className="fc-tour-content">{currentStep.content}</div>
                    {targetMessage && (
                        <p className="fc-tour-target-message">{targetMessage}</p>
                    )}
                </div>
                <div className="fc-tour-actions">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onSkip}
                    >
                        {labels.skip}
                    </Button>
                    <div className="fc-tour-actions__step">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={currentIndex === 0}
                            onClick={onPrevious}
                        >
                            {labels.previous}
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={onNext}
                        >
                            {isLastStep ? labels.finish : labels.next}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function waitForTarget(
    target: TourStepTarget,
    timeoutMs: number,
    isCancelled: () => boolean,
): Promise<Element | null> {
    return new Promise(resolve => {
        const startedAt = performance.now()

        const tick = () => {
            if (isCancelled()) {
                resolve(null)
                return
            }

            const element = resolveTourTarget(target)
            if (element && isMeasurableTourTarget(element)) {
                resolve(element)
                return
            }

            if (performance.now() - startedAt >= timeoutMs) {
                resolve(null)
                return
            }

            window.requestAnimationFrame(tick)
        }

        tick()
    })
}

function isMeasurableTourTarget(element: Element): boolean {
    if (!document.documentElement.contains(element)) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
}

function resolveTourTarget(target: TourStepTarget): Element | null {
    if (typeof target === 'string') {
        return document.querySelector(target)
    }
    if (target instanceof Element) {
        return target
    }
    return target()
}

function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => {
        window.requestAnimationFrame(() => resolve())
    })
}

function scrollTourTargetIntoView(element: Element): boolean {
    const rect = element.getBoundingClientRect()
    const topLimit = getTourOverlayTop() + VIEWPORT_MARGIN
    const bottomLimit = window.innerHeight - VIEWPORT_MARGIN
    const outsideViewport = rect.top < topLimit
        || rect.bottom > bottomLimit
        || rect.left < VIEWPORT_MARGIN
        || rect.right > window.innerWidth - VIEWPORT_MARGIN

    if (!outsideViewport) return false

    element.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: 'auto',
    })
    return true
}

function toTourTargetRect(rect: DOMRect): TourTargetRect {
    return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
    }
}

function getPaddedTargetRect(rect: TourTargetRect): CSSProperties {
    const left = clamp(rect.left - TARGET_PADDING, 0, window.innerWidth)
    const top = clamp(rect.top - TARGET_PADDING, 0, window.innerHeight)
    const right = clamp(rect.right + TARGET_PADDING, 0, window.innerWidth)
    const bottom = clamp(rect.bottom + TARGET_PADDING, 0, window.innerHeight)

    return {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    }
}

function getScrimStyles(rect: TourTargetRect | null): CSSProperties[] {
    const overlayTop = getTourOverlayTop()
    const viewportHeight = window.innerHeight

    if (!rect) {
        return [{
            top: overlayTop,
            left: 0,
            width: '100vw',
            height: Math.max(0, viewportHeight - overlayTop),
        }]
    }

    const hole = getPaddedTargetRect(rect)
    const top = Number(hole.top ?? 0)
    const left = Number(hole.left ?? 0)
    const width = Number(hole.width ?? 0)
    const height = Number(hole.height ?? 0)
    const right = left + width
    const bottom = top + height
    const viewportWidth = window.innerWidth
    const sideTop = Math.max(top, overlayTop)
    const sideBottom = Math.max(bottom, overlayTop)

    return [
        {
            top: overlayTop,
            left: 0,
            width: '100vw',
            height: Math.max(0, top - overlayTop),
        },
        {
            top: sideBottom,
            left: 0,
            width: '100vw',
            height: Math.max(0, viewportHeight - sideBottom),
        },
        {
            top: sideTop,
            left: 0,
            width: left,
            height: Math.max(0, sideBottom - sideTop),
        },
        {
            top: sideTop,
            left: right,
            width: Math.max(0, viewportWidth - right),
            height: Math.max(0, sideBottom - sideTop),
        },
    ]
}

function getTourOverlayTop(): number {
    const titleBar = document.querySelector('.top-bar')
    if (!titleBar) return 0

    return Math.max(0, titleBar.getBoundingClientRect().bottom)
}

function getPopoverLayout(
    step: TourStep,
    rect: TourTargetRect | null,
    tooltipSize: TooltipSize,
): PopoverLayout {
    if (!rect) {
        return {
            style: {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
            },
            arrowClassName: '',
            arrowStyle: {},
        }
    }

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.min(360, Math.max(280, viewportWidth - VIEWPORT_MARGIN * 2))
    const height = tooltipSize.height || DEFAULT_TOOLTIP_SIZE.height
    const placement = resolvePlacement(step.placement ?? 'auto', rect, tooltipSize)
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    let top = 0
    let left = 0

    if (placement === 'top') {
        top = rect.top - height - POPOVER_GAP
        left = centerX - width / 2
    } else if (placement === 'bottom') {
        top = rect.bottom + POPOVER_GAP
        left = centerX - width / 2
    } else if (placement === 'left') {
        top = centerY - height / 2
        left = rect.left - width - POPOVER_GAP
    } else {
        top = centerY - height / 2
        left = rect.right + POPOVER_GAP
    }

    left = clamp(left, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
    top = clamp(top, VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN)

    const arrowStyle = placement === 'top' || placement === 'bottom'
        ? {left: clamp(centerX - left, 18, width - 18)}
        : {top: clamp(centerY - top, 18, height - 18)}

    return {
        style: {
            top,
            left,
            width,
        },
        arrowClassName: `fc-tour-popover__arrow--${placement}`,
        arrowStyle,
    }
}

function resolvePlacement(
    placement: TourPlacement,
    rect: TourTargetRect,
    tooltipSize: TooltipSize,
): Exclude<TourPlacement, 'auto'> {
    if (placement !== 'auto') return placement

    const spaces: Array<[Exclude<TourPlacement, 'auto'>, number]> = [
        ['bottom', window.innerHeight - rect.bottom],
        ['top', rect.top],
        ['right', window.innerWidth - rect.right],
        ['left', rect.left],
    ]
    const enoughSpace = spaces.find(([side, space]) => {
        const required = side === 'top' || side === 'bottom'
            ? tooltipSize.height + POPOVER_GAP + VIEWPORT_MARGIN
            : tooltipSize.width + POPOVER_GAP + VIEWPORT_MARGIN
        return space >= required
    })

    if (enoughSpace) return enoughSpace[0]

    return spaces.reduce((best, current) => current[1] > best[1] ? current : best)[0]
}

function getTargetMessage(status: TourTargetStatus): string {
    if (status === 'waiting') return '正在等待目标界面加载…'
    if (status === 'missing') return '未找到当前步骤的界面元素，可以返回上一步或跳过引导。'
    return ''
}

function getTourStorageKey(definition: TourDefinition): string {
    return definition.storageKey ?? `fc-tour:${definition.id}:v${definition.version ?? 1}`
}

function isStoredTourCompleted(definition: TourDefinition): boolean {
    return safeStorageGet(getTourStorageKey(definition)) === 'completed'
}

function markStoredTourCompleted(definition: TourDefinition) {
    safeStorageSet(getTourStorageKey(definition), 'completed')
}

function safeStorageGet(key: string): string | null {
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeStorageSet(key: string, value: string) {
    try {
        window.localStorage.setItem(key, value)
    } catch {
        // 本地存储不可用时只影响自动跳过，不阻断引导流程。
    }
}

function safeStorageRemove(key: string) {
    try {
        window.localStorage.removeItem(key)
    } catch {
        // 本地存储不可用时无需额外处理。
    }
}

function isEditingElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable
        || target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}
