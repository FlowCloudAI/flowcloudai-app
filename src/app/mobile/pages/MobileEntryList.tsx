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
import {MobileAddIcon, MobileBackIcon, MobileMenuIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {useMobilePageScrollMemory} from '../useMobilePageScrollMemory'
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

function formatDate(s?: string | null): string {
    if (!s) return '未知'
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? '未知' : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(t)
}

/** 首屏与每次「加载更多」的页大小。 */
const PAGE_SIZE = 30

/**
 * 两个降级路径的一次性上限。它们**无法分页**，原因在后端能力而非前端：
 * - 搜索：`db_search_entries` 只有 limit、没有 offset（SQL 是 `ORDER BY updated_at DESC LIMIT ?`）。
 * - 未分类：`EntryFilter.category_id` 语义是「等于某分类」，没有「IS NULL」，
 *   所以只能全量取回来在客户端筛。
 * 要真正分页需要先改 core_world_data（给 search 加 offset、给 filter 加 uncategorized），
 * 属跨仓改动，不在移动端这轮范围内。
 */
const SEARCH_RESULT_LIMIT = 100
const UNCATEGORIZED_SCAN_LIMIT = 500

/** 距底多少像素开始预取下一页。 */
const LOAD_MORE_THRESHOLD_PX = 320

/**
 * 记住每个列表页已加载多少条。pop 回来时一次取回同样多的内容，
 * 否则用户翻了 3 页再返回，只剩第 1 页，滚动记忆会因内容不够高而放弃恢复。
 */
const loadedCountMemory = new Map<string, number>()

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
    const [hasMore, setHasMore] = useState(false)
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [entryTypesError, setEntryTypesError] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const load = useCallback(async (query: string, type: string | null) => {
        setLoading(true)
        setLoadError(null)
        try {
            // ── 搜索：后端无 offset，一次取上限，不分页 ────────────────────────
            if (query.trim()) {
                const result = await db_search_entries({
                    projectId,
                    query: query.trim(),
                    categoryId: uncategorizedOnly ? null : categoryId,
                    entryType: type,
                    limit: SEARCH_RESULT_LIMIT,
                })
                const visible = uncategorizedOnly ? result.filter(entry => !entry.category_id) : result
                setEntries(visible)
                setTotal(visible.length)
                setHasMore(false)
                return
            }

            // ── 未分类：后端没有「category IS NULL」过滤，只能全取回来客户端筛 ──
            if (uncategorizedOnly) {
                const result = await db_list_entries({
                    projectId,
                    categoryId: null,
                    entryType: type,
                    limit: UNCATEGORIZED_SCAN_LIMIT,
                    offset: 0,
                })
                const visible = result.filter(entry => !entry.category_id)
                setEntries(visible)
                setTotal(visible.length)
                setHasMore(false)
                return
            }

            // ── 常规浏览：真正分页。返回本页时取回上次已加载的条数，别把人打回第一页 ──
            const limit = Math.max(PAGE_SIZE, loadedCountMemory.get(pageKey) ?? 0)
            const [result, count] = await Promise.all([
                db_list_entries({projectId, categoryId, entryType: type, limit, offset: 0}),
                db_count_entries({projectId, categoryId, entryType: type}),
            ])
            setEntries(result)
            setTotal(count)
            setHasMore(result.length < count)
        } catch (e) {
            logger.error('加载词条失败', e)
            setLoadError(formatApiError(toApiError(e)))
        } finally {
            setLoading(false)
        }
    }, [projectId, categoryId, pageKey, uncategorizedOnly])

    const loadMore = useCallback(async () => {
        if (!hasMore || loading || loadingMore) return
        setLoadingMore(true)
        try {
            const next = await db_list_entries({
                projectId,
                categoryId,
                entryType: typeFilter,
                limit: PAGE_SIZE,
                offset: entries.length,
            })
            // 后端是 ORDER BY updated_at DESC + OFFSET：翻页途中若有词条被改动会重排，
            // 可能带回已有的条目。按 id 去重，避免 React key 冲突和重复卡片。
            const seen = new Set(entries.map(entry => entry.id))
            const merged = [...entries, ...next.filter(entry => !seen.has(entry.id))]
            setEntries(merged)
            setHasMore(next.length > 0 && (total === null || merged.length < total))
        } catch (e) {
            logger.error('加载更多词条失败', e)
            setLoadError(formatApiError(toApiError(e)))
            setHasMore(false)
        } finally {
            setLoadingMore(false)
        }
    }, [categoryId, entries, hasMore, loading, loadingMore, projectId, total, typeFilter])

    useEffect(() => {
        void load(searchText, typeFilter)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, typeFilter])

    // 记住已加载条数，供下次回到本页时一次取回（见 loadedCountMemory 注释）。
    useEffect(() => {
        if (!pageKey || entries.length === 0) return
        loadedCountMemory.set(pageKey, entries.length)
    }, [entries.length, pageKey])

    // 滚到接近底部时预取下一页。
    useEffect(() => {
        const element = pageRef.current
        if (!element || !hasMore) return
        const handleScroll = () => {
            const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
            if (remaining <= LOAD_MORE_THRESHOLD_PX) void loadMore()
        }
        element.addEventListener('scroll', handleScroll, {passive: true})
        return () => element.removeEventListener('scroll', handleScroll)
    }, [hasMore, loadMore])

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
        searchTimer.current = setTimeout(() => void load(value, typeFilter), 300)
    }

    const handleCreateEntry = async () => {
        setActionError(null)
        try {
            const created = await db_create_entry({projectId, categoryId, title: '未命名词条'})
            setAiFocus({projectId, entryId: created.id})
            push({type: 'entryDetail', params: {projectId, entryId: created.id, displayName: '未命名词条', mode: 'edit'}})
        } catch (e) {
            logger.error('新建词条失败', e)
            setActionError(formatApiError(toApiError(e)))
        }
    }

    const retryLoad = useCallback(() => {
        void load(searchText, typeFilter)
        void loadEntryTypes()
    }, [load, loadEntryTypes, searchText, typeFilter])

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
                  * 显示后端 count 的真实总数，而不是已加载条数——分页后两者不再相等，
                  * 拿 entries.length 当总数会在大项目里直接谎报（原先固定 limit:200 时同理）。
                  */}
                <span className="mobile-page__eyebrow mobile-entry-list__eyebrow">
                    {loading
                        ? '正在同步'
                        : total !== null && total > entries.length
                            ? `${total} 个词条 · 已加载 ${entries.length}`
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
                                    extraInfo={<div className="mobile-entry-date">更新于 {formatDate(entry.updated_at)}</div>}
                                    tag={et ? (
                                        <span className="mobile-entry-card__tag">
                                            <EntryTypeIcon entryType={et} className="mobile-entry-card__tag-icon"/> {et.name}
                                        </span>
                                    ) : undefined}
                                    variant="shadow"
                                    hoverable
                                    imageHeight="58%"
                                    onClick={() => handleOpenEntry(entry)}
                                />
                            )
                        })}
                </div>
            )}

            {/* 手势是加速器、按钮是基线：滚到底自动预取，同时给一个可点的兜底入口。 */}
            {hasMore && !loading && (
                <div className="mobile-entry-list__more">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                    >
                        {loadingMore ? '加载中…' : '加载更多'}
                    </Button>
                </div>
            )}
        </div>
    )
}
