import {logger} from '../../../shared/logger'
import {type CSSProperties, useCallback, useEffect, useRef, useState} from 'react'
import {Button, Card, Input} from 'flowcloudai-ui'
import {
    db_count_entries,
    db_create_entry,
    db_list_all_entry_types,
    db_list_entries,
    db_search_entries,
    type EntryBrief,
    entryTypeKey,
    type EntryTypeView,
    formatApiError,
    toApiError,
} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {type MobileEntryListPageParams, type MobilePage} from '../usePageStack'
import {type AiFocus} from '../../../features/ai-chat/hooks/useAiController'
import EntryCoverImage from '../../../features/entries/components/EntryCoverImage'
import {getMeaningfulCoverMark} from '../../../shared/lib/defaultCover'
import MobilePagination from '../components/MobilePagination'
import {MobileAddIcon, MobileBackIcon, MobileMenuIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {useMobilePageScrollMemory} from '../useMobilePageScrollMemory'
import {formatMobileEntryListDate} from './MobileEntryDate'
import './MobileEntryList.css'

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    setAiFocus: (focus: AiFocus) => void
    pageKey: string
    categoryDrawerOpen?: boolean
    onOpenCategoryDrawer?: () => void
    params: MobileEntryListPageParams
}

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
 * 记住每个列表页停在第几页。pop 回来时回到同一页，
 * 否则翻到第 5 页进词条再返回会被打回第 1 页。
 */
const pageMemory = new Map<string, number>()

export default function MobileEntryList({push, pop, setAiFocus, pageKey, categoryDrawerOpen = false, onOpenCategoryDrawer, params}: Props) {
    const pageRef = useRef<HTMLDivElement>(null)
    useMobilePageScrollMemory(pageKey, pageRef)
    const projectId = params.projectId
    const uncategorizedOnly = Boolean(params.uncategorizedOnly)
    const categoryId = params.categoryId || null
    const listTitle = params.displayName || '全部词条'

    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [total, setTotal] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [entryTypesError, setEntryTypesError] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
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
    const [pageState, setPageState] = useState(() => ({filterKey, page: pageMemory.get(pageKey) ?? 1}))
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

    // 记住停在第几页，供下次回到本页时恢复（见 pageMemory 注释）。
    useEffect(() => {
        if (!pageKey) return
        pageMemory.set(pageKey, currentPage)
    }, [currentPage, pageKey])

    // 翻页后回到顶部；滚动记忆只在进入页面时生效，不会和这里打架。
    const firstPageRenderRef = useRef(true)
    useEffect(() => {
        if (firstPageRenderRef.current) {
            firstPageRenderRef.current = false
            return
        }
        pageRef.current?.scrollTo({top: 0})
    }, [currentPage])

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

    const handleSearch = (value: string) => {
        setSearchText(value)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            setAppliedQuery(value)
            setPageState(state => ({...state, page: 1}))
        }, 300)
    }

    const handleCreateEntry = async () => {
        setActionError(null)
        try {
            const created = await db_create_entry({projectId, categoryId, title: '未命名词条'})
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit', isPlaceholder: true}})
        } catch (e) {
            logger.error('新建词条失败', e)
            setActionError(formatApiError(toApiError(e)))
        }
    }

    const retryLoad = useCallback(() => {
        void load(appliedQuery, typeFilter, currentPage)
        void loadEntryTypes()
    }, [appliedQuery, currentPage, load, loadEntryTypes, typeFilter])

    const handleOpenEntry = (entry: EntryBrief) => {
        setAiFocus({projectId, entryId: entry.id})
        push({type: 'entryDetail', params: {projectId, entryId: entry.id, displayName: entry.title}})
    }

    return (
        <div ref={pageRef} className="mobile-page mobile-entry-list">
            <MobilePageTopBar
                className="mobile-entry-list__topbar"
                sticky
                edgeToEdge
                ariaLabel="词条列表操作"
                left={<MobileTopActionPill
                    actions={[
                        {
                            key: 'back',
                            label: '返回',
                            icon: <MobileBackIcon/>,
                            onClick: pop,
                        },
                        {
                            key: 'categories',
                            label: '打开分类树',
                            icon: <MobileMenuIcon/>,
                            ariaExpanded: categoryDrawerOpen,
                            onClick: () => onOpenCategoryDrawer?.(),
                        },
                    ]}
                />}
                right={<MobileTopActionPill
                    actions={[
                        {
                            key: 'create',
                            label: '新建词条',
                            icon: <MobileAddIcon/>,
                            kind: 'add',
                            onClick: () => void handleCreateEntry(),
                        },
                    ]}
                />}
            />

            {(actionError || (loadError && entries.length > 0) || entryTypesError) && (
                <div className="mobile-page__error-banner" role="alert">
                    <span>
                        {actionError
                            ? `新建词条失败：${actionError}`
                            : loadError
                                ? `词条列表刷新失败：${loadError}`
                                : `词条类型加载失败：${entryTypesError}`}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => actionError ? void handleCreateEntry() : retryLoad()}
                    >
                        重试
                    </Button>
                </div>
            )}

            <div className="mobile-entry-list__hero">
                {/*
                  * 显示后端 count 的真实总数，而不是本页条数——分页后两者不相等，
                  * 拿 entries.length 当总数会在大项目里直接谎报。
                  */}
                <span className="mobile-page__eyebrow mobile-entry-list__eyebrow">
                    {loading
                        ? '正在同步'
                        : pageCount > 1
                            ? `${total ?? entries.length} 个词条 · 第 ${currentPage} / ${pageCount} 页`
                            : `${total ?? entries.length} 个词条`}
                </span>
                <h2 className="mobile-page__hero-title">{listTitle}</h2>
            </div>

            <div className="mobile-entry-list__toolbar">
                <Input
                    placeholder="搜索词条…"
                    aria-label="搜索词条"
                    value={searchText}
                    onValueChange={handleSearch}
                    className="mobile-page__search mobile-entry-list__search"
                    radius="full"
                    size="lg"
                    allowClear
                />
            </div>

            {/* 类型筛选 */}
            {entryTypes.length > 0 && (
                <div className="mobile-entry-list__filters" data-mobile-horizontal-scroll="true">
                    <button
                        type="button"
                        className={`mobile-entry-list__filter${typeFilter === null ? ' active' : ''}`}
                        onClick={() => setTypeFilter(null)}
                    >
                        全部
                    </button>
                    {entryTypes.map(et => {
                        const key = entryTypeKey(et)
                        const active = typeFilter === key
                        return (
                            <button
                                key={key}
                                type="button"
                                className={`mobile-entry-list__filter${active ? ' active' : ''}`}
                                onClick={() => setTypeFilter(active ? null : key)}
                                style={{'--mobile-entry-type-color': et.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                            >
                                <EntryTypeIcon entryType={et} className=""/>
                                {et.name}
                            </button>
                        )
                    })}
                </div>
            )}

            {loading && entries.length === 0 ? (
                <div className="mobile-page__loading">加载中…</div>
            ) : loadError && entries.length === 0 ? (
                <div className="mobile-page__error" role="alert">
                    <span>词条加载失败：{loadError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={retryLoad}>重试</Button>
                </div>
            ) : entries.length === 0 ? (
                <div className="mobile-page__empty">
                    <p>暂无词条</p>
                    <Button type="button" size="sm" radius="full" onClick={handleCreateEntry}>新建第一个词条</Button>
                </div>
            ) : (
                <div className="mobile-entry-list__grid">
                    {/*
                      * 不在这里排序：db_list_entries / db_search_entries 的 SQL 都是
                      * `ORDER BY updated_at DESC`，后端已按同一个键排好。原先这里每次 render
                      * 都 [...entries].sort() 复制并重排，比较器里还对每个元素 new Date()，
                      * 纯属把后端做过的事再做一遍。
                      */}
                    {entries.map(entry => {
                            const et = entry.type ? entryTypes.find(t => entryTypeKey(t) === entry.type) : null
                            const coverMark = getMeaningfulCoverMark(entry.title)
                            const coverFallback = (
                                <span className="mobile-entry-card__placeholder">
                                    <span className="mobile-entry-card__placeholder-mark">{coverMark}</span>
                                </span>
                            )
                            return (
                                <Card
                                    className="mobile-page__card mobile-entry-card"
                                    key={entry.id}
                                    style={{'--mobile-entry-card-color': et?.color ?? 'var(--fc-color-primary)'} as CSSProperties}
                                    imageSlot={entry.cover ? (
                                        <EntryCoverImage
                                            projectId={projectId}
                                            entryId={entry.id}
                                            cover={entry.cover}
                                            alt={entry.title}
                                            className="mobile-entry-card__cover"
                                            loading="lazy"
                                            decoding="async"
                                            fallback={coverFallback}
                                        />
                                    ) : (
                                        coverFallback
                                    )}
                                    title={entry.title}
                                    description={entry.summary || '这个词条还没有摘要，点击后可继续补充设定内容。'}
                                    extraInfo={<div className="mobile-entry-date">更新于 {formatMobileEntryListDate(entry.updated_at)}</div>}
                                    tag={et ? (
                                        <span className="mobile-entry-card__tag">
                                            <EntryTypeIcon entryType={et} className="mobile-entry-card__tag-icon"/> {et.name}
                                        </span>
                                    ) : undefined}
                                    variant="shadow"
                                    hoverable
                                    imageHeight="100%"
                                    overlayStartOpacity={0}
                                    overlayEndOpacity={0.94}
                                    onClick={() => handleOpenEntry(entry)}
                                />
                            )
                        })}
                </div>
            )}

            <MobilePagination
                className="mobile-entry-list__pagination"
                page={currentPage}
                pageCount={pageCount}
                ariaLabel="词条列表分页"
                onPageChange={next => setPageState({filterKey, page: next})}
            />
        </div>
    )
}
