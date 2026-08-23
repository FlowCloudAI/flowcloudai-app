import {useCallback, useMemo, useRef, useState} from 'react'

export interface MobileProjectPageParams {
    projectId: string
    displayName?: string
}

export interface MobileEntryListPageParams extends MobileProjectPageParams {
    categoryId?: string
    uncategorizedOnly?: boolean
}

export interface MobileEntryDetailPageParams extends MobileProjectPageParams {
    entryId?: string
    mode?: 'view' | 'edit'
}

export type MobileProjectScopedPageParams = MobileProjectPageParams

export interface MobileAiSettingsPageParams {
    pluginId?: string
}

export interface MobilePageParamsMap {
    projectList: undefined
    projectHome: MobileProjectPageParams
    entryList: MobileEntryListPageParams
    entryDetail: MobileEntryDetailPageParams
    typeManager: MobileProjectScopedPageParams
    tagManager: MobileProjectScopedPageParams
    categoryManager: MobileProjectScopedPageParams
    worldCheck: MobileProjectScopedPageParams
    timeline: MobileProjectScopedPageParams
    relationGraph: MobileProjectScopedPageParams
    settingsStorage: undefined
    settingsAi: MobileAiSettingsPageParams
    settingsPlugins: undefined
    settingsModels: undefined
    settingsPermissions: undefined
    settingsTemplates: undefined
    settingsAppearance: undefined
    settingsUsage: undefined
    settingsUpdate: undefined
    settingsFeedback: undefined
    settingsAbout: undefined
}

export type MobilePageType = keyof MobilePageParamsMap

export type MobileSettingsPageType =
    | 'settingsStorage'
    | 'settingsAi'
    | 'settingsPlugins'
    | 'settingsModels'
    | 'settingsPermissions'
    | 'settingsTemplates'
    | 'settingsAppearance'
    | 'settingsUsage'
    | 'settingsUpdate'
    | 'settingsFeedback'
    | 'settingsAbout'

export type MobilePageOf<T extends MobilePageType = MobilePageType> = {
    [K in T]: MobilePageParamsMap[K] extends undefined
        ? {type: K; params?: undefined}
        : {type: K; params: MobilePageParamsMap[K]}
}[T]

export type MobilePage = MobilePageOf

/**
 * 上一次栈操作，决定页面转场动画的方向。
 * `replace` 不换 key、页面不重挂载，不会触发转场；`none` 用于初次挂载和切 Tab（横向跳转不该滑）。
 */
export type MobilePageNavigation = 'none' | 'push' | 'pop' | 'replace'

export interface PageStack {
    push: (page: MobilePage) => void
    pop: () => void
    /** 交互式返回已在外层完成动画时使用，避免底层页接管后又重放 pop 入场。 */
    popWithoutAnimation: () => void
    back: (fallback: () => void) => void
    replace: (page: MobilePage) => void
    /** 清空整个栈回到 Tab 根页。用于「再点一次当前 Tab」。 */
    popToRoot: () => void
    /** 切 Tab 时调用，避免回到本 Tab 时重放上一次 push/pop 的方向动画。 */
    resetNavigation: () => void
    lastNavigation: MobilePageNavigation
    currentPage: MobilePage | null
    /**
     * 栈顶页面的身份标识，用作页面组件的 React key。
     * 同类型页面互相 push（词条 A→点双链→词条 B）时类型不变，
     * 没有它 React 会复用同一个实例，本地 state（mode / 表单 / 滚动）会串页。
     */
    currentPageKey: string
    canGoBack: boolean
    stack: MobilePage[]
    /** 带稳定 key 的原始栈项，供公共双层转场 Host 保留前后页实例。 */
    entries: readonly MobilePageStackEntry[]
}

export interface MobilePageStackEntry {
    page: MobilePage
    key: string
}

let pageKeySeq = 0

function nextPageKey(): string {
    pageKeySeq += 1
    return `page-${pageKeySeq}`
}

export function usePageStack(): PageStack {
    const [entries, setEntries] = useState<MobilePageStackEntry[]>([])
    const [lastNavigation, setLastNavigation] = useState<MobilePageNavigation>('none')
    const entriesRef = useRef<MobilePageStackEntry[]>([])

    const push = useCallback((page: MobilePage) => {
        entriesRef.current = [...entriesRef.current, {page, key: nextPageKey()}]
        setEntries(entriesRef.current)
        setLastNavigation('push')
    }, [])

    const pop = useCallback(() => {
        if (entriesRef.current.length <= 1) {
            entriesRef.current = []
            setEntries([])
            setLastNavigation('pop')
            return
        }
        entriesRef.current = entriesRef.current.slice(0, -1)
        setEntries(entriesRef.current)
        setLastNavigation('pop')
    }, [])

    const popWithoutAnimation = useCallback(() => {
        if (entriesRef.current.length <= 1) {
            entriesRef.current = []
            setEntries([])
            setLastNavigation('none')
            return
        }
        entriesRef.current = entriesRef.current.slice(0, -1)
        setEntries(entriesRef.current)
        setLastNavigation('none')
    }, [])

    const back = useCallback((fallback: () => void) => {
        if (entriesRef.current.length > 0) {
            pop()
        } else {
            fallback()
        }
    }, [pop])

    // replace 沿用栈顶原 key：它表达的是「同一个页面换参数」（如词条保存后回写标题），
    // 换 key 会重挂载并丢掉正在编辑的内容。真正的换页请用 push / pop。
    const replace = useCallback((page: MobilePage) => {
        const current = entriesRef.current
        const next = current.length > 0
            ? [...current.slice(0, -1), {page, key: current[current.length - 1].key}]
            : [{page, key: nextPageKey()}]
        entriesRef.current = next
        setEntries(next)
        setLastNavigation('replace')
    }, [])

    const popToRoot = useCallback(() => {
        if (entriesRef.current.length === 0) return
        entriesRef.current = []
        setEntries([])
        setLastNavigation('pop')
    }, [])

    const resetNavigation = useCallback(() => {
        setLastNavigation('none')
    }, [])

    const stack = useMemo(() => entries.map(entry => entry.page), [entries])
    const currentEntry = entries.length > 0 ? entries[entries.length - 1] : null

    return {
        push,
        pop,
        popWithoutAnimation,
        back,
        replace,
        popToRoot,
        resetNavigation,
        lastNavigation,
        currentPage: currentEntry?.page ?? null,
        currentPageKey: currentEntry?.key ?? '',
        canGoBack: entries.length > 0,
        stack,
        entries,
    }
}

export function createPage<T extends MobilePageType>(
    type: T,
    ...args: MobilePageParamsMap[T] extends undefined ? [] : [params: MobilePageParamsMap[T]]
): MobilePageOf<T> {
    const params = args[0]
    return (params === undefined ? {type} : {type, params}) as MobilePageOf<T>
}
