import {useCallback, useMemo, useRef, useState} from 'react'
import type {WorldCheckKind} from '../../api'

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
    isPlaceholder?: boolean
}

export interface MobileEntryEditChildPageParams extends MobileProjectPageParams {
    entryId: string
    isPlaceholder?: boolean
}

export interface MobileEntryRelationPageParams extends MobileEntryEditChildPageParams {
    relationIndex?: number
}

export type MobileProjectScopedPageParams = MobileProjectPageParams

/** props 走桥、不进页面参数的子页（见 stores/mobileEditorHandoff 末尾）。 */
export interface MobileBridgedPageParams {
    propsToken: string
    displayName?: string
}

/** 加图页的两种语义：`add` 只把图片加进词条，`insert` 还要把 Markdown 引用写回正文。 */
export type MobileEntryImageAddMode = 'add' | 'insert'

export interface MobileEntryImageAddPageParams extends MobileBridgedPageParams {
    /**
     * mode 放页面参数、不放 props 桥：桥上的值要等打开方下一次 commit 后的 effect 才刷新，
     * 而子页在同一次 commit 里就挂载并读走了，按入口切换 mode 只会读到上一次的值。
     */
    mode?: MobileEntryImageAddMode
}

export interface MobileProjectCreatorPageParams {
    displayName?: string
    /** 用于重名校验；调用方已有项目列表，避免子页再取一次。 */
    existingNames?: string[]
    /** 创建成功后按它回递新项目（见 stores/mobileEditorHandoff）。 */
    resultToken?: string
}

export interface MobileTagEditorPageParams extends MobileProjectPageParams {
    /** 有 id 是编辑，没有是新建。 */
    tagId?: string
    /** 打开方希望拿回新建对象时传（见 stores/mobileEditorHandoff）。 */
    resultToken?: string
}

export interface MobileEntryTypeEditorPageParams extends MobileProjectPageParams {
    entryTypeId?: string
    resultToken?: string
}

export interface MobileWorldCheckGeneratePageParams extends MobileProjectPageParams {
    /** 从「选择检测方式」直接进来时带上的初始类型。 */
    checkKind?: WorldCheckKind
}

export interface MobileAiSettingsPageParams {
    pluginId?: string
}

export interface MobilePageParamsMap {
    projectList: undefined
    projectCreator: MobileProjectCreatorPageParams
    projectHome: MobileProjectPageParams
    projectDescription: MobileProjectScopedPageParams
    entryList: MobileEntryListPageParams
    entryDetail: MobileEntryDetailPageParams
    entryProperties: MobileEntryEditChildPageParams
    entryRelation: MobileEntryRelationPageParams
    entryImageAdd: MobileEntryImageAddPageParams
    projectCoverPicker: MobileBridgedPageParams
    typeManager: MobileProjectScopedPageParams
    typeEditor: MobileEntryTypeEditorPageParams
    tagManager: MobileProjectScopedPageParams
    tagEditor: MobileTagEditorPageParams
    categoryManager: MobileProjectScopedPageParams
    worldCheck: MobileProjectScopedPageParams
    worldCheckGenerate: MobileWorldCheckGeneratePageParams
    timeline: MobileProjectScopedPageParams
    relationGraph: MobileProjectScopedPageParams
    relationIndex: MobileBridgedPageParams
    relationLayout: MobileBridgedPageParams
    settingsStorage: undefined
    settingsAi: MobileAiSettingsPageParams
    settingsPlugins: undefined
    settingsPluginLibrary: undefined
    settingsApiKeys: undefined
    settingsModels: undefined
    settingsPermissions: undefined
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
    | 'settingsPluginLibrary'
    | 'settingsApiKeys'
    | 'settingsModels'
    | 'settingsPermissions'
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
