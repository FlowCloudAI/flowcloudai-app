/**
 * 词条浏览（搜索 / 类型筛选 / 分页 / 取数）的状态层。
 *
 * 独立成 hook 是因为它有两个宿主：词条列表页，以及项目主页底部内嵌的「全部词条」
 * ——桌面端也是把 CategoryView 直接挂在项目总览下方，两端结构一致。
 * 展示层在 MobileEntryBrowser.tsx，页面外壳（顶栏、标题、错误横幅）各自负责。
 */
import {logger} from '../../../shared/logger'
import {type RefObject, useCallback, useEffect, useRef, useState} from 'react'
import {
    db_count_entries,
    db_list_all_entry_types,
    db_list_entries,
    db_search_entries,
    type EntryBrief,
    type EntryTypeView,
    formatApiError,
    toApiError,
} from '../../../api'

/**
 * 每页条数。网格是两列，10 条即 5 行；桌面的「列数 × 行数 - 1」在这里退化成定值，
 * 减掉的那一格是给桌面的新建卡片留的，移动端新建入口在顶栏，不需要让位。
 */
const ENTRY_PAGE_SIZE = 10

/**
 * 两个降级路径的一次性上限。它们**后端不支持 offset**，只能取回上限后在客户端切片：
 * - 搜索：`db_search_entries` 只有 limit（SQL 是 `ORDER BY updated_at DESC LIMIT ?`）。
 * - 未分类：`EntryFilter.category_id` 语义是「等于某分类」，没有「IS NULL」，
 *   所以只能全量取回来在客户端筛。
 * 要让这两条也走后端分页需要先改 core_world_data（给 search 加 offset、
 * 给 filter 加 uncategorized），属跨仓改动，不在移动端这轮范围内。
 */
const SEARCH_RESULT_LIMIT = 100
const UNCATEGORIZED_SCAN_LIMIT = 500

/**
 * 记住每个宿主停在第几页。pop 回来时回到同一页，
 * 否则翻到第 5 页进词条再返回会被打回第 1 页。
 */
const pageMemory = new Map<string, number>()

interface Options {
    projectId: string
    categoryId: string | null
    uncategorizedOnly: boolean
    /** 分页记忆的键；页面栈用 pageKey，内嵌场景用一个稳定的自定义串。 */
    memoryKey: string
    /** 翻页后回到顶部的滚动容器。 */
    scrollRef: RefObject<HTMLElement | null>
}

export interface MobileEntryBrowserState {
    entries: EntryBrief[]
    entryTypes: EntryTypeView[]
    total: number | null
    currentPage: number
    pageCount: number
    loading: boolean
    loadError: string | null
    entryTypesError: string | null
    searchText: string
    typeFilter: string | null
    onSearch: (value: string) => void
    onTypeFilter: (key: string | null) => void
    onPageChange: (page: number) => void
    retry: () => void
    /** 词条被增删后由宿主调用，按当前条件重新取一次。 */
    reload: () => void
}

export function useMobileEntryBrowser({
    projectId,
    categoryId,
    uncategorizedOnly,
    memoryKey,
    scrollRef,
}: Options): MobileEntryBrowserState {
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [total, setTotal] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [entryTypesError, setEntryTypesError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    // 输入框的即时值与真正拿去查询的值分开：中间隔一层 300ms 防抖。
    const [appliedQuery, setAppliedQuery] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    /*
     * 页码与它所属的过滤条件绑在一起存。分类抽屉切换走 navigation.replace：
     * pageKey 不变、组件不重挂载，过滤条件变了必须回到第 1 页；用 effect 重置会先按
     * 旧页码发一次请求再按新页码发一次，所以改成 render 期比对、失配即就地重置
     * （React 官方的「上一次 render 的信息存进 state」写法）。
     * 首次挂载时两者相等，不会覆盖 pageMemory 恢复出来的页码。
     */
    const filterKey = `${categoryId ?? ''}|${uncategorizedOnly ? 'u' : ''}|${typeFilter ?? ''}`
    const [pageState, setPageState] = useState(() => ({filterKey, page: pageMemory.get(memoryKey) ?? 1}))
    if (pageState.filterKey !== filterKey) setPageState({filterKey, page: 1})
    const currentPage = pageState.filterKey === filterKey ? pageState.page : 1

    const load = useCallback(async (query: string, type: string | null, targetPage: number) => {
        setLoading(true)
        setLoadError(null)
        const start = (targetPage - 1) * ENTRY_PAGE_SIZE
        try {
            // ── 搜索：后端无 offset，取回上限后在客户端切页 ────────────────────
            if (query.trim()) {
                const result = await db_search_entries({
                    projectId,
                    query: query.trim(),
                    categoryId: uncategorizedOnly ? null : categoryId,
                    entryType: type,
                    limit: SEARCH_RESULT_LIMIT,
                })
                const visible = uncategorizedOnly ? result.filter(entry => !entry.category_id) : result
                setTotal(visible.length)
                setEntries(visible.slice(start, start + ENTRY_PAGE_SIZE))
                return
            }

            // ── 未分类：后端没有「category IS NULL」过滤，同样先全取再客户端切页 ──
            if (uncategorizedOnly) {
                const result = await db_list_entries({
                    projectId,
                    categoryId: null,
                    entryType: type,
                    limit: UNCATEGORIZED_SCAN_LIMIT,
                    offset: 0,
                })
                const visible = result.filter(entry => !entry.category_id)
                setTotal(visible.length)
                setEntries(visible.slice(start, start + ENTRY_PAGE_SIZE))
                return
            }

            // ── 常规浏览：offset 直接落到后端，只取当前页 ────────────────────
            const [result, count] = await Promise.all([
                db_list_entries({projectId, categoryId, entryType: type, limit: ENTRY_PAGE_SIZE, offset: start}),
                db_count_entries({projectId, categoryId, entryType: type}),
            ])
            setEntries(result)
            setTotal(count)
        } catch (e) {
            logger.error('加载词条失败', e)
            setLoadError(formatApiError(toApiError(e)))
        } finally {
            setLoading(false)
        }
    }, [projectId, categoryId, uncategorizedOnly])

    // 与桌面 CategoryView 同一套：页数由总数推导，越界的页码由 effect 拉回。
    const pageCount = Math.max(1, Math.ceil((total ?? 0) / ENTRY_PAGE_SIZE))

    useEffect(() => {
        void load(appliedQuery, typeFilter, currentPage)
    }, [appliedQuery, currentPage, load, typeFilter])

    // 总数回来之前不收敛页码，否则会把 pageMemory 恢复的页码在首帧压回第 1 页。
    useEffect(() => {
        if (total === null) return
        setPageState(state => ({...state, page: Math.min(state.page, pageCount)}))
    }, [pageCount, total])

    useEffect(() => {
        if (!memoryKey) return
        pageMemory.set(memoryKey, currentPage)
    }, [currentPage, memoryKey])

    // 翻页后回到顶部；滚动记忆只在进入页面时生效，不会和这里打架。
    const firstPageRenderRef = useRef(true)
    useEffect(() => {
        if (firstPageRenderRef.current) {
            firstPageRenderRef.current = false
            return
        }
        scrollRef.current?.scrollTo({top: 0})
    }, [currentPage, scrollRef])

    const loadEntryTypes = useCallback(async () => {
        setEntryTypesError(null)
        try {
            setEntryTypes(await db_list_all_entry_types(projectId))
        } catch (error) {
            logger.error('加载词条类型失败', error)
            setEntryTypesError(formatApiError(toApiError(error)))
        }
    }, [projectId])

    useEffect(() => {
        void loadEntryTypes()
    }, [loadEntryTypes])

    const onSearch = useCallback((value: string) => {
        setSearchText(value)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            setAppliedQuery(value)
            setPageState(state => ({...state, page: 1}))
        }, 300)
    }, [])

    const reload = useCallback(() => {
        void load(appliedQuery, typeFilter, currentPage)
    }, [appliedQuery, currentPage, load, typeFilter])

    const retry = useCallback(() => {
        reload()
        void loadEntryTypes()
    }, [loadEntryTypes, reload])

    const onPageChange = useCallback((next: number) => {
        setPageState({filterKey, page: next})
    }, [filterKey])

    return {
        entries,
        entryTypes,
        total,
        currentPage,
        pageCount,
        loading,
        loadError,
        entryTypesError,
        searchText,
        typeFilter,
        onSearch,
        onTypeFilter: setTypeFilter,
        onPageChange,
        retry,
        reload,
    }
}
