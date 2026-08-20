import {logger} from '../../shared/logger'
import {isBrowserPreview} from '../../shared/devPreview'
import {closeTopOverlay, hasOpenOverlay} from '../../shared/ui/overlay'
import AiConfirmModal from '../../features/ai-chat/components/AiConfirmModal'
import EntryEditModal from '../../features/entries/components/EntryEditModal'
import './mobileTokens.css'
import './mobileAccessibility.css'
import './MobileApp.css'
import {useAlert} from 'flowcloudai-ui'
import {
    type CSSProperties,
    type TransitionEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {listen} from '../../api/events'
import {
    type BackendStartupStatus,
    exit_app,
    setting_get_backend_status,
    showWindow,
    getAndroidNavigationMode,
    type PlatformInfo,
} from '../../api'
import {useProjectContextStore} from '../../features/projects/projectContextStore'
import {type AiFocus} from '../../features/ai-chat/hooks/useAiController'
import type {WorldCheckDiscussionParams} from '../../features/project-editor/hooks/useWorldCheckController'
import MobileCategoryDrawer, {type MobileCategoryDrawerSelection} from './components/MobileCategoryDrawer'
import MobileStartupUpdatePrompt from './MobileStartupUpdatePrompt'
import MobileNav, {type MobileTab} from './MobileNav'
import MobilePageTransitionHost from './MobilePageTransitionHost'
import MobileAiChat from './pages/MobileAiChat'
import MobileCategoryManager from './pages/MobileCategoryManager'
import MobileEntryTypeManager from './pages/MobileEntryTypeManager'
import MobileEntryDetail from './pages/MobileEntryDetail'
import MobileEntryList from './pages/MobileEntryList'
import MobileHome from './pages/MobileHome'
import MobileIdea from './pages/MobileIdea'
import MobileProjectHome from './pages/MobileProjectHome'
import MobileProjectList from './pages/MobileProjectList'
import MobileRelationGraph from './pages/MobileRelationGraph'
import MobileSettings from './pages/MobileSettings'
import MobileTagManager from './pages/MobileTagManager'
import MobileTimeline from './pages/MobileTimeline'
import MobileWorldCheck from './pages/MobileWorldCheck'
import {
    type MobileBeforeLeave,
    type MobileBackTarget,
    type MobileNavigationIntent,
    resolveMobileBackTarget,
} from './mobileBackNavigation'
import {
    getMobilePageTransitionLayers,
    type MobilePageTransitionLayer,
} from './mobilePageTransition'
import {type MobilePage, usePageStack} from './usePageStack'
import {getMobileSideDrawerWidth, useMobileSideDrawerGesture} from './useMobileSideDrawerGesture'
import {useMobileInputMode} from './useMobileInputMode'
import {useAndroidPredictiveBack} from './useAndroidPredictiveBack'
import {
    getMobileReservedKeyboardInset,
    useMobileKeyboardMetrics,
} from './useMobileKeyboardMetrics'
import {useIosWebViewFocusRevealGuard} from './useIosWebViewFocusRevealGuard'

interface MobileAppProps {
    platformInfo: PlatformInfo
}

let mobileWindowShown = false

type PageProps = {
    push: (page: MobilePage) => void
    pop: () => void
    replace: (page: MobilePage) => void
    navigateToTab: (tab: MobileTab, page?: MobilePage) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    /** 栈内页面身份，用于滚动位置记忆（见 useMobilePageScrollMemory）。Tab 根页为空串。 */
    pageKey: string
    aiFocus: AiFocus
    setAiFocus: (focus: AiFocus) => void
    startReportDiscussion: (params: WorldCheckDiscussionParams) => Promise<void>
}

interface MobileEdgeBackOrigin {
    tab: MobileTab
    pageKey: string
}

export default function MobileApp({platformInfo}: MobileAppProps) {
    const {showAlert} = useAlert()
    useIosWebViewFocusRevealGuard(platformInfo.os === 'ios')
    const closingRef = useRef(false)
    const mobileAppRef = useRef<HTMLDivElement>(null)
    const beforeLeaveRef = useRef<MobileBeforeLeave | null>(null)
    const pendingEdgeBackTargetRef = useRef<MobileBackTarget | null>(null)
    const [activeTab, setActiveTab] = useState<MobileTab>('home')
    const [edgeBackOrigin, setEdgeBackOrigin] = useState<MobileEdgeBackOrigin | null>(null)
    const homeStack = usePageStack()
    const aiStack = usePageStack()
    const ideasStack = usePageStack()
    const settingsStack = usePageStack()

    const stacks = useMemo(() => ({
        home: homeStack,
        ai: aiStack,
        ideas: ideasStack,
        settings: settingsStack,
    }), [homeStack, aiStack, ideasStack, settingsStack])

    const activeStack = stacks[activeTab]
    const currentPage = activeStack.currentPage
    const pageType = currentPage?.type ?? ''
    const edgeBackTarget = resolveMobileBackTarget(activeTab, activeStack.canGoBack)

    // 开发期浏览器预览没有后端，直接视为就绪，避免卡在启动屏。
    const [backendReady, setBackendReady] = useState(() => isBrowserPreview())
    const [backendError, setBackendError] = useState<string | null>(null)
    const [aiFocus, setAiFocus] = useState<AiFocus>({projectId: null, entryId: null})
    const androidNavigationMode = useMemo(
        () => platformInfo.os === 'android' ? getAndroidNavigationMode() : 'unknown',
        [platformInfo.os],
    )
    const reportDiscussionRef = useRef<((params: WorldCheckDiscussionParams) => Promise<void>) | null>(null)
    const [categoryDrawerWidth, setCategoryDrawerWidth] = useState(getMobileSideDrawerWidth)
    const {
        active: mobileInputModeActive,
        dismissFocusedInput,
    } = useMobileInputMode(mobileAppRef)
    const mobileKeyboardMetrics = useMobileKeyboardMetrics()
    const nativeKeyboardDocked = mobileKeyboardMetrics.source === 'native'
        && mobileKeyboardMetrics.docked
    const reservedKeyboardInset = getMobileReservedKeyboardInset(mobileKeyboardMetrics)
    const mobileKeyboardStyle = useMemo(() => ({
        '--mobile-keyboard-inset': `${reservedKeyboardInset}px`,
    }) as CSSProperties, [reservedKeyboardInset])

    const categoryDrawerProjectId = activeTab === 'home'
        && currentPage
        && (currentPage.type === 'projectHome' || currentPage.type === 'entryList')
        ? currentPage.params.projectId
        : undefined
    const categoryDrawerEnabled = Boolean(categoryDrawerProjectId)
    const categoryDrawerContext = useProjectContextStore(categoryDrawerProjectId)
    const aiConversationDrawerEnabled = activeTab === 'ai'
    const ideaDrawerEnabled = activeTab === 'ideas'
    const mobileSideDrawerEnabled = categoryDrawerEnabled || aiConversationDrawerEnabled || ideaDrawerEnabled
    const mobileSideDrawerKind = categoryDrawerEnabled ? 'category' : aiConversationDrawerEnabled ? 'ai' : ideaDrawerEnabled ? 'idea' : null

    useEffect(() => {
        /*
         * WKWebView 在部分 iOS 版本会忽略 viewport 的缩放限制。只拦截 WebKit 的页面级
         * gesture 事件，不拦 touchmove，避免破坏抽屉、滚动区和业务组件自己的触摸逻辑。
         */
        const preventPageZoom = (event: Event) => event.preventDefault()
        const options: AddEventListenerOptions = {passive: false}
        document.addEventListener('gesturestart', preventPageZoom, options)
        document.addEventListener('gesturechange', preventPageZoom, options)
        document.addEventListener('gestureend', preventPageZoom, options)
        return () => {
            document.removeEventListener('gesturestart', preventPageZoom, options)
            document.removeEventListener('gesturechange', preventPageZoom, options)
            document.removeEventListener('gestureend', preventPageZoom, options)
        }
    }, [])

    // 当前页离开前的统一闸门：返回键、边缘返回手势、切 Tab 都必须先过它，
    // 否则未保存内容会随页面卸载静默丢失。
    const runLeaveGuard = useCallback(async (intent: MobileNavigationIntent) => {
        const beforeLeave = beforeLeaveRef.current
        if (!beforeLeave) return true
        return await beforeLeave(intent)
    }, [])

    const commitBackTarget = useCallback(async (target: MobileBackTarget): Promise<boolean> => {
        if (target === 'page') {
            if (!activeStack.canGoBack) return false
            activeStack.pop()
            return true
        }
        if (target === 'home') {
            setActiveTab('home')
            return true
        }

        if (closingRef.current) return false
        closingRef.current = true
        try {
            await exit_app()
            return true
        } catch (error) {
            closingRef.current = false
            logger.error('关闭移动端窗口失败', error)
            return false
        }
    }, [activeStack])

    const confirmExit = useCallback(async (): Promise<boolean> => {
        const result = await showAlert('确定要退出当前移动端应用吗？', 'warning', 'confirm')
        return result === 'yes' && !closingRef.current
    }, [showAlert])

    const runBackNavigation = useCallback(async (): Promise<boolean> => {
        if (!await runLeaveGuard('back')) return false
        const target = resolveMobileBackTarget(activeTab, activeStack.canGoBack)
        if (target === 'exit' && !await confirmExit()) return false
        return await commitBackTarget(target)
    }, [activeStack.canGoBack, activeTab, commitBackTarget, confirmExit, runLeaveGuard])

    const prepareEdgeBackNavigation = useCallback(async (): Promise<boolean> => {
        pendingEdgeBackTargetRef.current = null
        if (!await runLeaveGuard('back')) return false
        const target = resolveMobileBackTarget(activeTab, activeStack.canGoBack)
        if (target === 'exit' && !await confirmExit()) return false
        pendingEdgeBackTargetRef.current = target
        return true
    }, [activeStack.canGoBack, activeTab, confirmExit, runLeaveGuard])

    const commitPreparedEdgeBackNavigation = useCallback(async (): Promise<boolean> => {
        const target = pendingEdgeBackTargetRef.current
        pendingEdgeBackTargetRef.current = null
        if (!target) return false
        if (target === 'page') {
            if (!activeStack.canGoBack) return false
            activeStack.popWithoutAnimation()
            return true
        }
        return await commitBackTarget(target)
    }, [activeStack, commitBackTarget])
    /*
     * 分类树是否正在拖拽。用 ref 不用 state：它只在手势回调里被读，
     * 走 state 会在每次拖拽起止时重渲染整个移动端外壳，白白掉帧。
     */
    const categoryDragActiveRef = useRef(false)
    const handleEdgeBackStart = useCallback(() => {
        setEdgeBackOrigin({
            tab: activeTab,
            pageKey: activeStack.currentPageKey || `${activeTab}-root`,
        })
    }, [activeStack.currentPageKey, activeTab])
    const handleEdgeBackFinish = useCallback(() => {
        setEdgeBackOrigin(null)
    }, [])
    const pointerEdgeBackEnabled = platformInfo.os === 'ios'
        || (platformInfo.os === 'android' && androidNavigationMode === 'buttons')
    const {
        open: sideDrawerOpen,
        drawerDragging: sideDrawerDragging,
        edgeBackTransitionDisabled,
        surfaceOffset: sideDrawerSurfaceOffset,
        edgeBackOffset,
        edgeBackProgress,
        edgeBackPhase,
        completeEdgeBackTransition,
        openDrawer: openSideDrawer,
        closeDrawer: closeSideDrawer,
        pointerHandlers: sideDrawerPointerHandlers,
    } = useMobileSideDrawerGesture({
        enabled: mobileSideDrawerEnabled,
        width: categoryDrawerWidth,
        allowTextEditingTargetGestures: ideaDrawerEnabled,
        beforeEdgeBackGesture: pointerEdgeBackEnabled ? prepareEdgeBackNavigation : undefined,
        onEdgeBackGesture: pointerEdgeBackEnabled ? commitPreparedEdgeBackNavigation : undefined,
        onEdgeBackStart: pointerEdgeBackEnabled ? handleEdgeBackStart : undefined,
        onEdgeBackFinish: pointerEdgeBackEnabled ? handleEdgeBackFinish : undefined,
        // 分类树长按拖拽进行中：抽屉横滑必须整划让路，否则拖节点时往左飘会把抽屉关掉。
        shouldSuppress: () => categoryDragActiveRef.current,
    })
    const canAnimateAndroidPredictiveBack = useCallback(() => (
        !mobileInputModeActive
        && !sideDrawerOpen
        && !hasOpenOverlay()
        && edgeBackTarget !== 'exit'
    ), [edgeBackTarget, mobileInputModeActive, sideDrawerOpen])
    const androidPredictiveBack = useAndroidPredictiveBack({
        enabled: platformInfo.os === 'android',
        canAnimate: canAnimateAndroidPredictiveBack,
        beforeBack: prepareEdgeBackNavigation,
        commitBack: commitPreparedEdgeBackNavigation,
        onStart: handleEdgeBackStart,
        onFinish: handleEdgeBackFinish,
    })
    const activeEdgeBackPhase = edgeBackPhase !== 'idle'
        ? edgeBackPhase
        : androidPredictiveBack.phase
    const activeEdgeBackProgress = edgeBackPhase !== 'idle'
        ? edgeBackProgress
        : androidPredictiveBack.progress
    const activeEdgeBackOffset = edgeBackPhase !== 'idle'
        ? edgeBackOffset
        : androidPredictiveBack.offset
    const handleEdgeBackTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
        if (event.propertyName !== 'transform') return
        if (!(event.target instanceof HTMLElement)) return
        if (!event.target.classList.contains('is-edge-back-foreground')) return
        completeEdgeBackTransition()
    }, [completeEdgeBackTransition])
    const sideDrawerProgress = categoryDrawerWidth > 0
        ? Math.min(1, Math.max(0, sideDrawerSurfaceOffset / categoryDrawerWidth))
        : 0
    const categoryDrawerSelection = useMemo<MobileCategoryDrawerSelection>(() => {
        if (currentPage?.type === 'projectHome') return {kind: 'projectHome'}
        if (currentPage?.type !== 'entryList') return {kind: 'projectHome'}
        if (currentPage.params.uncategorizedOnly) return {kind: 'uncategorized'}
        const categoryId = currentPage.params.categoryId || ''
        return categoryId ? {kind: 'category', categoryId} : {kind: 'allEntries'}
    }, [currentPage])

    useEffect(() => {
        // 浏览器预览无后端信号，跳过监听（backendReady 初始已为 true）。
        if (isBrowserPreview()) return
        let disposed = false
        let marked = false
        const mark = () => {
            if (disposed || marked) return
            marked = true
            setBackendError(null)
            setBackendReady(true)
            logger.info('[MobileApp] 后端已就绪')
        }
        const applyStatus = (status: BackendStartupStatus) => {
            if (disposed) return
            if (status.phase === 'ready') {
                mark()
                return
            }
            if (status.phase === 'failed') {
                const message = status.message || '后端初始化失败'
                setBackendError(message)
                logger.error('[MobileApp] 后端启动失败', message)
            }
        }
        const p = listen<BackendStartupStatus>('backend-status-changed', event => {
            applyStatus(event.payload)
        })
        setting_get_backend_status().then(applyStatus).catch(error => {
            logger.warn('[MobileApp] 检查后端启动状态失败', error)
        })
        return () => { disposed = true; p.then(fn => fn()) }
    }, [])

    useEffect(() => {
        if (!backendReady || !platformInfo.windowControls || mobileWindowShown) return
        mobileWindowShown = true
        showWindow().catch((error) => {
            mobileWindowShown = false
            logger.error('显示移动端窗口失败', error)
        })
    }, [backendReady, platformInfo.windowControls])

    useEffect(() => {
        const updateCategoryDrawerWidth = () => {
            setCategoryDrawerWidth(getMobileSideDrawerWidth())
        }
        updateCategoryDrawerWidth()
        window.addEventListener('resize', updateCategoryDrawerWidth)
        window.visualViewport?.addEventListener('resize', updateCategoryDrawerWidth)
        return () => {
            window.removeEventListener('resize', updateCategoryDrawerWidth)
            window.visualViewport?.removeEventListener('resize', updateCategoryDrawerWidth)
        }
    }, [])

    const navigation = useMemo<Omit<PageProps, 'aiFocus' | 'setAiFocus' | 'setBeforeLeave' | 'pageKey' | 'startReportDiscussion'>>(() => ({
        push: (page: MobilePage) => stacks[activeTab].push(page),
        pop: () => stacks[activeTab].pop(),
        replace: (page: MobilePage) => stacks[activeTab].replace(page),
        navigateToTab: (tab: MobileTab, page?: MobilePage) => {
            void (async () => {
                if (!await runLeaveGuard('leave')) return
                setActiveTab(tab)
                if (page) {
                    stacks[tab].push(page)
                } else {
                    // 切 Tab 是横向跳转，不该重放目标 Tab 上一次 push/pop 的方向动画。
                    stacks[tab].resetNavigation()
                }
            })()
        },
    }), [activeTab, runLeaveGuard, stacks])

    const registerReportDiscussion = useCallback((
        handler: ((params: WorldCheckDiscussionParams) => Promise<void>) | null,
    ) => {
        reportDiscussionRef.current = handler
    }, [])

    const startReportDiscussion = useCallback(async (params: WorldCheckDiscussionParams) => {
        const handler = reportDiscussionRef.current
        if (!handler) throw new Error('AI 对话尚未准备好，请稍后重试。')
        await handler(params)
        navigation.navigateToTab('ai')
    }, [navigation])

    const closeCategoryDrawer = useCallback(() => {
        closeSideDrawer()
    }, [closeSideDrawer])

    const openCategoryDrawer = useCallback(() => {
        if (!categoryDrawerEnabled) return
        openSideDrawer()
    }, [categoryDrawerEnabled, openSideDrawer])

    const openAiConversationDrawer = useCallback(() => {
        if (!aiConversationDrawerEnabled) return
        openSideDrawer()
    }, [aiConversationDrawerEnabled, openSideDrawer])

    const openIdeaDrawer = useCallback(() => {
        if (!ideaDrawerEnabled) return
        openSideDrawer()
    }, [ideaDrawerEnabled, openSideDrawer])

    const refreshCategoryDrawer = useCallback(async () => {
        await categoryDrawerContext.refresh()
    }, [categoryDrawerContext])

    const handleSelectDrawerCategory = useCallback((selection: MobileCategoryDrawerSelection, label: string) => {
        if (!categoryDrawerProjectId) return
        closeCategoryDrawer()
        if (selection.kind === 'projectHome') {
            if (pageType === 'projectHome') return
            const nextPage: MobilePage = {type: 'projectHome', params: {projectId: categoryDrawerProjectId}}
            const previousPage = activeStack.stack[activeStack.stack.length - 2]
            if (
                pageType === 'entryList'
                && previousPage?.type === 'projectHome'
                && previousPage.params?.projectId === categoryDrawerProjectId
            ) {
                activeStack.pop()
            } else if (pageType === 'entryList') {
                navigation.replace(nextPage)
            } else {
                navigation.push(nextPage)
            }
            return
        }

        const nextPage: MobilePage = selection.kind === 'allEntries'
            ? {type: 'entryList', params: {projectId: categoryDrawerProjectId, categoryId: '', displayName: label}}
            : selection.kind === 'uncategorized'
                ? {
                    type: 'entryList',
                    params: {
                        projectId: categoryDrawerProjectId,
                        categoryId: '',
                        uncategorizedOnly: true,
                        displayName: label,
                    },
                }
                : {type: 'entryList', params: {projectId: categoryDrawerProjectId, categoryId: selection.categoryId, displayName: label}}

        if (pageType === 'entryList') {
            navigation.replace(nextPage)
        } else {
            navigation.push(nextPage)
        }
    }, [activeStack, categoryDrawerProjectId, closeCategoryDrawer, navigation, pageType])

    const handleTabChange = useCallback((tab: MobileTab) => {
        if (activeEdgeBackPhase !== 'idle') return
        // Tab 在软键盘展开时保持可见可用；切换前主动结束焦点，避免键盘跟到目标 Tab。
        if (mobileInputModeActive) dismissFocusedInput()
        // 再点一次当前 Tab = 回到该 Tab 根页（移动端通用约定）。
        // 深在词条详情里点「首页」原本毫无反应，用户没有快速逃生口。
        if (tab === activeTab) {
            if (!activeStack.canGoBack) return
            void (async () => {
                if (!await runLeaveGuard('leave')) return
                closeCategoryDrawer()
                activeStack.popToRoot()
            })()
            return
        }
        void (async () => {
            if (!await runLeaveGuard('leave')) return
            closeCategoryDrawer()
            setActiveTab(tab)
            // 切 Tab 是横向跳转，不该重放目标 Tab 上一次 push/pop 的方向动画。
            stacks[tab].resetNavigation()
        })()
    }, [activeEdgeBackPhase, activeStack, activeTab, closeCategoryDrawer, dismissFocusedInput, mobileInputModeActive, runLeaveGuard, stacks])

    const setBeforeLeave = useCallback((handler: MobileBeforeLeave | null) => {
        beforeLeaveRef.current = handler
    }, [])

    const ignoreBeforeLeave = useCallback(() => {
        // 双层转场的底层页保持挂载但不拥有导航闸门；只有栈顶能注册。
    }, [])

    const handleBack = useCallback(() => {
        if (edgeBackPhase !== 'idle') return
        // 输入期间第一次返回只收起键盘；退出输入模式后才允许关闭浮层或回退页面。
        if (dismissFocusedInput()) return
        // 有浮层打开时，返回优先关闭浮层，而非回退页面/退出应用。
        if (closeTopOverlay()) return
        if (sideDrawerOpen) {
            closeCategoryDrawer()
            return
        }
        void runBackNavigation()
    }, [closeCategoryDrawer, dismissFocusedInput, edgeBackPhase, runBackNavigation, sideDrawerOpen])

    useEffect(() => {
        const handleAndroidBackFallback = () => {
            handleBack()
        }
        window.addEventListener('flowcloudai:android-back-fallback', handleAndroidBackFallback)
        return () => window.removeEventListener('flowcloudai:android-back-fallback', handleAndroidBackFallback)
    }, [handleBack])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            // iOS/iPadOS 与 Android 的外接键盘保持一致：先结束输入，再按返回栈关闭界面。
            e.preventDefault()
            handleBack()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack])

    const pageProps: PageProps = useMemo(() => ({
        ...navigation,
        setBeforeLeave,
        pageKey: activeStack.currentPageKey,
        aiFocus,
        setAiFocus,
        startReportDiscussion,
    }), [activeStack.currentPageKey, navigation, setBeforeLeave, aiFocus, startReportDiscussion])

    const createLayerPageProps = useCallback((pageKey: string, interactive: boolean): PageProps => ({
        ...navigation,
        setBeforeLeave: interactive ? setBeforeLeave : ignoreBeforeLeave,
        pageKey,
        aiFocus,
        setAiFocus,
        startReportDiscussion,
    }), [aiFocus, ignoreBeforeLeave, navigation, setBeforeLeave, startReportDiscussion])

    const homeTransitionLayers = useMemo(
        () => getMobilePageTransitionLayers(homeStack.entries, 'home-root'),
        [homeStack.entries],
    )
    const settingsTransitionLayers = useMemo(
        () => getMobilePageTransitionLayers(settingsStack.entries, 'settings-root'),
        [settingsStack.entries],
    )

    const renderHomeLayer = useCallback((layer: MobilePageTransitionLayer, interactive: boolean) => {
        const layerProps = createLayerPageProps(layer.key, interactive)
        const page = layer.page
        return (
            <>
                {!page && <MobileHome {...layerProps}/>}
                {page?.type === 'projectList' && <MobileProjectList {...layerProps}/>}
                {page?.type === 'projectHome' && (
                    <MobileProjectHome
                        {...layerProps}
                        params={page.params}
                        categoryDrawerOpen={interactive && sideDrawerOpen}
                        onOpenCategoryDrawer={interactive ? openCategoryDrawer : undefined}
                    />
                )}
                {page?.type === 'entryList' && (
                    <MobileEntryList
                        {...layerProps}
                        params={page.params}
                        categoryDrawerOpen={interactive && sideDrawerOpen}
                        onOpenCategoryDrawer={interactive ? openCategoryDrawer : undefined}
                    />
                )}
                {page?.type === 'entryDetail' && <MobileEntryDetail {...layerProps} params={page.params}/>}
                {page?.type === 'typeManager' && <MobileEntryTypeManager {...layerProps} params={page.params}/>}
                {page?.type === 'tagManager' && <MobileTagManager {...layerProps} params={page.params}/>}
                {page?.type === 'categoryManager' && <MobileCategoryManager {...layerProps} params={page.params}/>}
                {page?.type === 'worldCheck' && <MobileWorldCheck {...layerProps} params={page.params}/>}
                {page?.type === 'timeline' && <MobileTimeline {...layerProps} params={page.params}/>}
                {page?.type === 'relationGraph' && <MobileRelationGraph {...layerProps} params={page.params}/>}
            </>
        )
    }, [createLayerPageProps, openCategoryDrawer, sideDrawerOpen])

    const renderSettingsLayer = useCallback((layer: MobilePageTransitionLayer, interactive: boolean) => {
        const layerProps = createLayerPageProps(layer.key, interactive)
        return <MobileSettings {...layerProps} page={layer.page} platformOs={platformInfo.os}/>
    }, [createLayerPageProps, platformInfo.os])

    const edgeBackActive = activeEdgeBackPhase !== 'idle'
    const showHomeTab = activeTab === 'home' || (edgeBackActive && edgeBackTarget === 'home')

    if (!backendReady) {
        return (
            <div ref={mobileAppRef} className="mobile-app" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100vh', background: 'var(--fc-color-bg)',
                color: 'var(--fc-color-text-secondary)', fontSize: 'var(--fc-font-size-sm)',
            }}>
                {backendError ? (
                    <div role="alert" style={{maxWidth: 'min(88vw, 32rem)', textAlign: 'center'}}>
                        <div style={{color: 'var(--fc-color-error)', marginBottom: 'var(--fc-spacing-sm)'}}>
                            启动失败
                        </div>
                        <div style={{overflowWrap: 'anywhere'}}>{backendError}</div>
                    </div>
                ) : '正在启动…'}
            </div>
        )
    }

    return (
        <div
            ref={mobileAppRef}
            className="mobile-app"
            data-native-keyboard={nativeKeyboardDocked ? 'docked' : mobileKeyboardMetrics.visible ? 'floating' : 'hidden'}
            style={mobileKeyboardStyle}
        >
            <div
                className={`mobile-app-side-drawer-shell${mobileSideDrawerEnabled ? ' is-enabled' : ''}${sideDrawerOpen ? ' is-open' : ''}${sideDrawerDragging ? ' is-drawer-dragging' : ''}${edgeBackTransitionDisabled || activeEdgeBackPhase === 'tracking' ? ' is-edge-back-direct' : ''}${activeEdgeBackPhase !== 'idle' ? ' is-edge-back-active' : ''}${activeEdgeBackPhase === 'cancelling' ? ' is-edge-back-cancelling' : ''}${activeEdgeBackPhase === 'committing' ? ' is-edge-back-committing' : ''}${mobileSideDrawerKind ? ` is-${mobileSideDrawerKind}` : ''}`}
                style={{
                    '--mobile-entry-drawer-width': `${categoryDrawerWidth}px`,
                    '--mobile-entry-drawer-shift': `${sideDrawerSurfaceOffset}px`,
                    '--mobile-entry-drawer-progress': sideDrawerProgress,
                    '--mobile-edge-back-shift': `${activeEdgeBackOffset}px`,
                    '--mobile-edge-back-progress': activeEdgeBackProgress,
                    '--mobile-edge-back-underlay-shift': activeEdgeBackPhase === 'idle'
                        ? '0px'
                        : `calc(var(--mobile-gap-section) * -1 * ${1 - activeEdgeBackProgress})`,
                    '--mobile-edge-back-underlay-scrim-opacity': activeEdgeBackPhase === 'idle'
                        ? 0
                        : 1 - activeEdgeBackProgress,
                } as CSSProperties}
            >
                {mobileSideDrawerEnabled && (
                    <div
                        className="mobile-app-side-drawer-shell__drawer"
                        {...sideDrawerPointerHandlers}
                    >
                        {categoryDrawerEnabled ? (
                            <MobileCategoryDrawer
                                projectId={categoryDrawerProjectId!}
                                categories={categoryDrawerContext.categories}
                                stats={categoryDrawerContext.stats}
                                selected={categoryDrawerSelection}
                                onSelect={handleSelectDrawerCategory}
                                onChanged={refreshCategoryDrawer}
                                onDragStateChange={(dragging) => { categoryDragActiveRef.current = dragging }}
                            />
                        ) : aiConversationDrawerEnabled ? (
                            <div id="mobile-ai-conversation-drawer-root" className="mobile-app-ai-drawer-root"/>
                        ) : (
                            <div id="mobile-idea-drawer-root" className="mobile-app-idea-drawer-root"/>
                        )}
                    </div>
                )}
                <div
                    className="mobile-app-side-drawer-shell__surface"
                    {...sideDrawerPointerHandlers}
                >
                    <button
                        type="button"
                        className="mobile-app-side-drawer-shell__surface-close"
                        aria-label={mobileSideDrawerKind === 'ai' ? '关闭对话列表' : mobileSideDrawerKind === 'idea' ? '关闭灵感列表' : '关闭分类树'}
                        tabIndex={sideDrawerOpen ? 0 : -1}
                        onClick={closeCategoryDrawer}
                    />
                    <div className="mobile-app__content" onTransitionEnd={handleEdgeBackTransitionEnd}>
                        {/*
                          * 首页栈顶两层保持同一 React key 与挂载位置。push 时旧页只是降到底层，
                          * 边缘 pop 时它已经渲染完成，不需要在手势中重新加载数据。
                          */}
                        {showHomeTab && (
                            <div className={`mobile-app__tab-view${activeTab === 'home' ? ' is-active' : ' is-cross-tab-underlay'}`}>
                                <MobilePageTransitionHost
                                    layers={homeTransitionLayers}
                                    lastNavigation={homeStack.lastNavigation}
                                    edgeBackForegroundKey={edgeBackOrigin?.tab === 'home' ? edgeBackOrigin.pageKey : null}
                                    interactive={activeTab === 'home'}
                                    renderLayer={renderHomeLayer}
                                />
                                {activeTab !== 'home' && (
                                    <span className="mobile-page-transition-host__underlay-scrim" aria-hidden="true"/>
                                )}
                            </div>
                        )}

                        {/* AI Tab 原本就长期挂载，外层只负责跨 Tab 返回时的前景滑出。 */}
                        <div
                            className={`mobile-app__tab-view${activeTab === 'ai' ? ' is-active' : ''}${edgeBackOrigin?.tab === 'ai' ? ' is-edge-back-foreground' : ''}`}
                            hidden={activeTab !== 'ai'}
                        >
                            <MobileAiChat
                                {...pageProps}
                                active={activeTab === 'ai'}
                                conversationDrawerOpen={sideDrawerOpen && aiConversationDrawerEnabled}
                                onOpenConversationDrawer={openAiConversationDrawer}
                                onCloseConversationDrawer={closeCategoryDrawer}
                                onStartReportDiscussionReady={registerReportDiscussion}
                            />
                        </div>

                        {/* 灵感 Tab */}
                        {activeTab === 'ideas' && (
                            <div className={`mobile-app__tab-view is-active${edgeBackOrigin?.tab === 'ideas' ? ' is-edge-back-foreground' : ''}`}>
                                <MobileIdea
                                    {...pageProps}
                                    ideaDrawerOpen={sideDrawerOpen && ideaDrawerEnabled}
                                    onOpenIdeaDrawer={openIdeaDrawer}
                                    onCloseIdeaDrawer={closeCategoryDrawer}
                                    preventWebViewFocusReveal={platformInfo.os === 'ios'}
                                />
                            </div>
                        )}

                        {/* 设置也使用同一双层 Host，根菜单与各设置分页之间无需单独写动画。 */}
                        {activeTab === 'settings' && (
                            <div className="mobile-app__tab-view is-active">
                                <MobilePageTransitionHost
                                    layers={settingsTransitionLayers}
                                    lastNavigation={settingsStack.lastNavigation}
                                    edgeBackForegroundKey={edgeBackOrigin?.tab === 'settings' ? edgeBackOrigin.pageKey : null}
                                    interactive
                                    renderLayer={renderSettingsLayer}
                                />
                            </div>
                        )}
                    </div>

                    <MobileNav
                        activeTab={activeTab}
                        keyboardSuppressed={nativeKeyboardDocked}
                        onTabChange={handleTabChange}
                    />
                </div>
            </div>

            <EntryEditModal/>
            <AiConfirmModal/>
            <MobileStartupUpdatePrompt enabled={platformInfo.os === 'android'}/>
        </div>
    )
}
