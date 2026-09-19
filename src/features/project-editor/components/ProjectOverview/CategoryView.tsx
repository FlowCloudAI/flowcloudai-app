import {logger} from '../../../../shared/logger'
import {
    type CSSProperties,
    memo,
    type MouseEvent,
    type SyntheticEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {Button, Card, Input, RollingBox, Select, useAlert, useContextMenu} from 'flowcloudai-ui'
import {
    type Category,
    db_delete_entry,
    db_list_entries,
    db_search_entries,
    db_update_entry,
    type EntryBrief,
    entryTypeKey,
    type EntryTypeView,
    setting_get_settings,
} from '../../../../api'
import {saveAppSettings} from '../../../settings/appSettingsStore'
import EntryCoverImage from '../../../entries/components/EntryCoverImage'
import {buildInternalEntryMarkdown} from '../../../entries/lib/entryMarkdown'
import {RenameDialog} from '../../../../shared/ui/overlay'
import {getMeaningfulCoverMark} from '../../../../shared/lib/defaultCover'
import EntryTypeIcon from '../EntryTypeIcon'
import {PROJECT_HOME_PERF_LOG_ENABLED, projectHomePerfInfo, projectHomePerfWarn} from './projectHomePerfDebug'
import {
    pageDocumentSearchDescription,
    pageDocumentSearchOpenTarget,
} from '../../../page-document/application/searchResultNavigation.ts'

type SortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc'
type EntryPageRows = 2 | 5 | 10

const SORT_OPTIONS: Array<{ key: Exclude<SortMode, 'name-asc' | 'name-desc'>; label: string }> = [
    {key: 'updated-desc', label: '更新时间'},
    {key: 'updated-asc', label: '创建时间'},
]
const ENTRY_PAGE_ROW_OPTIONS: Array<{ value: EntryPageRows; label: string }> = [
    {value: 2, label: '每页 2 行'},
    {value: 5, label: '每页 5 行'},
    {value: 10, label: '每页 10 行'},
]
const ENTRY_GRID_GAP = 16
const ENTRY_GRID_MIN_COLUMN_WIDTH = 248
const ENTRY_GRID_DEFAULT_WIDTH = 960
const ENTRY_GRID_FALLBACK_VIEWPORT_HEIGHT = 900
const ENTRY_GRID_OVERSCAN_ROWS = 1

function isThumbnailCover(cover?: string | null): boolean {
    if (!cover) return false
    const normalized = String(cover).replace(/\\/g, '/').toLowerCase()
    return normalized.includes('/thumbs/') || normalized.includes('%2fthumbs%2f')
}

function summarizeEntryCovers(entries: EntryBrief[]) {
    let withCover = 0
    let thumbnail = 0
    for (const entry of entries) {
        if (!entry.cover) continue
        withCover += 1
        if (isThumbnailCover(entry.cover)) thumbnail += 1
    }
    return {
        total: entries.length,
        withCover,
        thumbnail,
        nonThumbnail: withCover - thumbnail,
        withoutCover: entries.length - withCover,
    }
}

function parseDateMs(s?: string | null): number {
    if (!s) return 0
    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const t = new Date(withTimezone).getTime()
    return Number.isNaN(t) ? 0 : t
}

function formatDate(s?: string | null): string {
    const ms = parseDateMs(s)
    if (!ms) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(ms)
}

function normalizeStarredEntryIds(entryIds: string[] | null | undefined) {
    return Array.from(new Set((entryIds ?? []).filter(Boolean)))
}

function EntryStarTag() {
    return (
        <span className="pe-entry-star-tag" aria-label="已标星">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3.3 14.8 9l6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.9 9.2 9 12 3.3Z" />
            </svg>
        </span>
    )
}

function sortEntries(entries: EntryBrief[], mode: SortMode, starredEntryIdSet: Set<string>): EntryBrief[] {
    return [...entries].sort((a, b) => {
        const starOrder = Number(starredEntryIdSet.has(b.id)) - Number(starredEntryIdSet.has(a.id))
        if (starOrder !== 0) return starOrder
        const nameOrder = a.title.localeCompare(b.title, 'zh-CN')

        switch (mode) {
            case 'updated-asc':
                return parseDateMs(a.updated_at) - parseDateMs(b.updated_at) || nameOrder
            case 'name-asc':
                return nameOrder
            case 'name-desc':
                return -nameOrder
            case 'updated-desc':
            default:
                return parseDateMs(b.updated_at) - parseDateMs(a.updated_at) || nameOrder
        }
    })
}

interface EntryCardItemProps {
    projectId: string
    entry: EntryBrief
    entryTypes: EntryTypeView[]
    isStarred: boolean
    onContextMenu?: (event: MouseEvent<HTMLDivElement>, entry: EntryBrief) => void
    onOpenEntry?: (entry: { id: string; title: string; pageDocumentNodeId?: string }) => void
}

function EntryCardItem({projectId, entry, entryTypes, isStarred, onContextMenu, onOpenEntry}: EntryCardItemProps) {
    const entryType = entry.type
        ? entryTypes.find((et) => entryTypeKey(et) === entry.type)
        : null
    const imageDebugProps = PROJECT_HOME_PERF_LOG_ENABLED
        ? {
            onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
                const image = event.currentTarget
                projectHomePerfInfo('词条封面加载成功', {
                    entryId: entry.id,
                    title: entry.title,
                    isThumbnail: isThumbnailCover(entry.cover),
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    cover: entry.cover,
                })
            },
            onError: () => {
                projectHomePerfWarn('词条封面加载失败', {
                    entryId: entry.id,
                    title: entry.title,
                    isThumbnail: isThumbnailCover(entry.cover),
                    cover: entry.cover,
                })
            },
        }
        : undefined
    const coverMark = getMeaningfulCoverMark(entry.title)
    const coverFallback = (
        <div
            className="pe-entry-placeholder"
            style={{'--entry-accent-color': entryType?.color ?? 'var(--fc-color-primary)'} as CSSProperties}
        >
            <span className="pe-entry-placeholder__mark">{coverMark}</span>
        </div>
    )
    const cardTag = isStarred || entryType ? (
        <span className="pe-entry-card-tags">
            {isStarred ? <EntryStarTag /> : null}
            {entryType ? (
                <span className="pe-entry-type-badge"
                      style={{'--badge-color': entryType.color} as CSSProperties}>
                    <EntryTypeIcon entryType={entryType} className="pe-entry-type-badge-icon"/>
                    {entryType.name}
                </span>
            ) : null}
        </span>
    ) : undefined

    return (
        <Card
            className="pe-entry-card"
            imageSlot={(
                entry.cover ? (
                    <EntryCoverImage
                        projectId={projectId}
                        entryId={entry.id}
                        cover={entry.cover}
                        alt={entry.title}
                        className="pe-entry-cover"
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        fallback={coverFallback}
                        {...imageDebugProps}
                    />
                ) : (
                    coverFallback
                )
            )}
            title={entry.title}
            description={pageDocumentSearchDescription(entry)}
            extraInfo={<div className="pe-entry-date">更新于 {formatDate(entry.updated_at)}</div>}
            tag={cardTag}
            variant="shadow"
            hoverable
            expandContentOnHover
            imageHeight="100%"
            contentAreaRatio={0.5}
            hoverContentAreaRatio={0.8}
            onContextMenu={event => onContextMenu?.(event, entry)}
            onClick={() => onOpenEntry?.(pageDocumentSearchOpenTarget(entry))}
        />
    )
}

function CreateEntryCard({
                              categoryId,
                              creating,
                              onRequestCreateEntry,
                          }: {
    categoryId: string | null
    creating: boolean
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
}) {
    return (
        <button
            type="button"
            className="pe-entry-create-card"
            onClick={() => void onRequestCreateEntry?.(categoryId)}
            disabled={creating}
        >
            <span className="pe-entry-create-card__plus">+</span>
            <span className="pe-entry-create-card__label">{creating ? '创建中…' : '新建词条'}</span>
        </button>
    )
}

interface VirtualEntryGridProps {
    projectId: string
    entries: EntryBrief[]
    entryTypes: EntryTypeView[]
    categoryId: string | null
    creatingEntry: boolean
    starredEntryIdSet: Set<string>
    scrollElement?: HTMLElement | null
    onColumnCountChange?: (columnCount: number) => void
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
    onEntryContextMenu?: (event: MouseEvent<HTMLDivElement>, entry: EntryBrief) => void
    onOpenEntry?: (entry: { id: string; title: string; pageDocumentNodeId?: string }) => void
}

interface VirtualGridViewport {
    width: number
    top: number
    bottom: number
}

function VirtualEntryGrid({
                              projectId,
                               entries,
                               entryTypes,
                               categoryId,
                               creatingEntry,
                               starredEntryIdSet,
                               scrollElement,
                               onColumnCountChange,
                               onRequestCreateEntry,
                               onEntryContextMenu,
                               onOpenEntry,
                           }: VirtualEntryGridProps) {
    const rootRef = useRef<HTMLDivElement | null>(null)
    const measureFrameRef = useRef<number | null>(null)
    const [viewport, setViewport] = useState<VirtualGridViewport>({
        width: ENTRY_GRID_DEFAULT_WIDTH,
        top: 0,
        bottom: ENTRY_GRID_FALLBACK_VIEWPORT_HEIGHT,
    })

    const measureViewport = useCallback(() => {
        const root = rootRef.current
        if (!root) return

        const rootRect = root.getBoundingClientRect()
        const scrollRect = scrollElement?.getBoundingClientRect()
        const nextWidth = rootRect.width || ENTRY_GRID_DEFAULT_WIDTH
        const nextTop = scrollRect ? scrollRect.top - rootRect.top : 0
        const nextBottom = scrollRect ? scrollRect.bottom - rootRect.top : window.innerHeight - rootRect.top

        setViewport(current => {
            if (
                Math.abs(current.width - nextWidth) < 1 &&
                Math.abs(current.top - nextTop) < 1 &&
                Math.abs(current.bottom - nextBottom) < 1
            ) {
                return current
            }
            return {
                width: nextWidth,
                top: nextTop,
                bottom: nextBottom,
            }
        })
    }, [scrollElement])

    const scheduleMeasure = useCallback(() => {
        if (measureFrameRef.current !== null) return
        measureFrameRef.current = window.requestAnimationFrame(() => {
            measureFrameRef.current = null
            measureViewport()
        })
    }, [measureViewport])

    useLayoutEffect(() => {
        measureViewport()

        const scrollTarget: HTMLElement | Window = scrollElement ?? window
        scrollTarget.addEventListener('scroll', scheduleMeasure, {passive: true})
        window.addEventListener('resize', scheduleMeasure)

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(scheduleMeasure)
            : null
        if (rootRef.current) resizeObserver?.observe(rootRef.current)
        if (scrollElement) resizeObserver?.observe(scrollElement)

        return () => {
            scrollTarget.removeEventListener('scroll', scheduleMeasure)
            window.removeEventListener('resize', scheduleMeasure)
            resizeObserver?.disconnect()
            if (measureFrameRef.current !== null) {
                window.cancelAnimationFrame(measureFrameRef.current)
                measureFrameRef.current = null
            }
        }
    }, [measureViewport, scheduleMeasure, scrollElement])

    const gridWidth = Math.max(1, viewport.width)
    const columnCount = Math.max(1, Math.floor((gridWidth + ENTRY_GRID_GAP) / (ENTRY_GRID_MIN_COLUMN_WIDTH + ENTRY_GRID_GAP)))
    const columnWidth = Math.max(1, Math.floor((gridWidth - ENTRY_GRID_GAP * (columnCount - 1)) / columnCount))
    const rowHeight = Math.round(columnWidth * 4 / 3)
    const rowPitch = rowHeight + ENTRY_GRID_GAP
    const itemCount = entries.length + 1
    const rowCount = Math.ceil(itemCount / columnCount)
    const gridHeight = rowCount > 0
        ? rowCount * rowHeight + Math.max(0, rowCount - 1) * ENTRY_GRID_GAP
        : rowHeight
    const visibleTop = Math.max(0, Math.min(gridHeight, viewport.top))
    const visibleBottom = Math.max(visibleTop, Math.min(gridHeight, viewport.bottom))
    const startRow = Math.max(0, Math.floor(visibleTop / rowPitch) - ENTRY_GRID_OVERSCAN_ROWS)
    const endRow = Math.min(rowCount - 1, Math.ceil(visibleBottom / rowPitch) + ENTRY_GRID_OVERSCAN_ROWS)
    const startIndex = startRow * columnCount
    const endIndex = Math.min(entries.length, (endRow + 1) * columnCount)
    const renderedEntryCount = Math.max(0, endIndex - startIndex)
    const renderedCreateCardCount = startIndex <= entries.length && (endRow + 1) * columnCount > entries.length ? 1 : 0
    const renderedCoverStats = useMemo(
        () => PROJECT_HOME_PERF_LOG_ENABLED ? summarizeEntryCovers(entries.slice(startIndex, endIndex)) : null,
        [endIndex, entries, startIndex],
    )
    const cells = []

    useEffect(() => {
        onColumnCountChange?.(columnCount)
    }, [columnCount, onColumnCountChange])

    useEffect(() => {
        if (!PROJECT_HOME_PERF_LOG_ENABLED) return
        projectHomePerfInfo('虚拟词条卡片', {
            totalEntryCards: entries.length,
            renderedEntryCards: renderedEntryCount,
            renderedCreateCards: renderedCreateCardCount,
            renderedCoverStats,
            columnCount,
            rowCount,
            startRow,
            endRow,
            gridWidth: Math.round(gridWidth),
            columnWidth,
            rowHeight,
            gridHeight,
        })
    }, [
        columnCount,
        columnWidth,
        endIndex,
        endRow,
        entries.length,
        gridHeight,
        gridWidth,
        renderedCoverStats,
        renderedCreateCardCount,
        renderedEntryCount,
        rowCount,
        rowHeight,
        startRow,
    ])

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const itemIndex = rowIndex * columnCount + columnIndex
            if (itemIndex >= itemCount) break

            const entry = entries[itemIndex]
            const isCreateCard = itemIndex === entries.length
            cells.push((
                <div
                    key={isCreateCard ? '__create__' : entry.id}
                    className="pe-entry-virtual-cell"
                    style={{
                        left: columnIndex * (columnWidth + ENTRY_GRID_GAP),
                        top: rowIndex * rowPitch,
                        width: columnWidth,
                        height: rowHeight,
                    }}
                >
                    {isCreateCard ? (
                        <CreateEntryCard
                            categoryId={categoryId}
                            creating={creatingEntry}
                            onRequestCreateEntry={onRequestCreateEntry}
                        />
                    ) : (
                        <EntryCardItem
                            projectId={projectId}
                            entry={entry}
                            entryTypes={entryTypes}
                            isStarred={starredEntryIdSet.has(entry.id)}
                            onContextMenu={onEntryContextMenu}
                            onOpenEntry={onOpenEntry}
                        />
                    )}
                </div>
            ))
        }
    }

    return (
        <div
            ref={rootRef}
            className="pe-entry-virtual-grid"
            style={{height: gridHeight}}
        >
            {cells}
        </div>
    )
}

interface CategoryViewProps {
    categoryId: string | null
    categoryName?: string
    projectId: string
    entryTypes: EntryTypeView[]
    prefetchedEntries?: EntryBrief[]
    childCategories?: Category[]
    refreshToken?: number
    noScroll?: boolean
    creatingEntry?: boolean
    virtualScrollElement?: HTMLElement | null
    onDefaultEntriesLoaded?: (categoryId: string | null, entries: EntryBrief[]) => void
    onRequestCreateEntry?: (categoryId: string | null) => void | Promise<void>
    onSelectCategory?: (categoryId: string) => void
    onEntryRenamed?: (entry: { id: string; title: string }) => void
    onEntryDeleted?: (entryId: string) => void
    onOpenEntry?: (entry: { id: string; title: string; pageDocumentNodeId?: string }) => void
}

function CategoryView({
                          categoryId,
                          categoryName = '',
                          projectId,
                          entryTypes,
                          prefetchedEntries,
                          childCategories = [],
                          refreshToken = 0,
                          noScroll = false,
                          creatingEntry = false,
                          virtualScrollElement,
                           onDefaultEntriesLoaded,
                           onRequestCreateEntry,
                           onSelectCategory,
                           onEntryRenamed,
                           onEntryDeleted,
                           onOpenEntry
                       }: CategoryViewProps) {
    const {showAlert} = useAlert()
    const {showContextMenu} = useContextMenu()
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [loading, setLoading] = useState(false)
    const [searchText, setSearchText] = useState('')
    const [typeFilter, setTypeFilter] = useState<string | null>(null)
    const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
    const [entryPageRows, setEntryPageRows] = useState<EntryPageRows>(2)
    const [entryPage, setEntryPage] = useState(1)
    const [entryGridColumnCount, setEntryGridColumnCount] = useState(3)
    const [starredEntryIds, setStarredEntryIds] = useState<string[]>([])
    const [renameEntry, setRenameEntry] = useState<EntryBrief | null>(null)
    const [entryActionBusy, setEntryActionBusy] = useState(false)
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const entryGridRef = useRef<HTMLDivElement | null>(null)
    const entriesScrollRef = useRef<HTMLDivElement | null>(null)

    const loadEntries = useCallback(async (
        query: string,
        type: string | null,
        options?: { silent?: boolean }
    ) => {
        const trimmedQuery = query.trim()
        const requestLabel = trimmedQuery ? 'search' : 'list'
        const silent = options?.silent ?? false
        logger.info('[CategoryView] 开始加载词条', {
            requestLabel,
            projectId,
            categoryId,
            typeFilter: type,
            rawQuery: query,
            trimmedQuery,
            silent,
        })
        if (!silent) setLoading(true)
        try {
            let result: EntryBrief[]
            if (trimmedQuery) {
                result = await db_search_entries({
                    projectId,
                    query: trimmedQuery,
                    categoryId,
                    entryType: type,
                    limit: 200,
                })
            } else {
                result = await db_list_entries({
                    projectId,
                    categoryId,
                    entryType: type,
                    limit: 200,
                    offset: 0,
                })
            }
            logger.info('[CategoryView] 词条加载完成', {
                requestLabel,
                resultCount: result.length,
                resultPreview: result.slice(0, 5).map((entry) => ({
                    id: entry.id,
                    title: entry.title,
                    type: entry.type,
                    categoryId: entry.category_id,
                })),
            })
            setEntries(result)
            if (!trimmedQuery && type === null) {
                onDefaultEntriesLoaded?.(categoryId, result)
            }
        } catch (e) {
            logger.error('[CategoryView] 词条加载失败', {
                requestLabel,
                projectId,
                categoryId,
                typeFilter: type,
                rawQuery: query,
                error: e,
            })
        } finally {
            if (!silent) setLoading(false)
        }
    }, [projectId, categoryId, onDefaultEntriesLoaded])

    useEffect(() => {
        let cancelled = false
        setting_get_settings()
            .then(settings => {
                if (!cancelled) setStarredEntryIds(normalizeStarredEntryIds(settings.starred_entry_ids))
            })
            .catch(error => {
                if (!cancelled) void showAlert(`加载星标词条失败：${String(error)}`, 'error', 'nonInvasive', 3000)
            })
        return () => {
            cancelled = true
        }
    }, [showAlert])

    useEffect(() => {
        if (!searchText.trim() && typeFilter === null && prefetchedEntries !== undefined) {
            setEntries(prefetchedEntries)
            setLoading(false)
            void loadEntries(searchText, typeFilter, {silent: true})
            return
        }
        void loadEntries(searchText, typeFilter)
        // searchText 变更由 handleSearchChange 的防抖处理
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, typeFilter, refreshToken, loadEntries, prefetchedEntries])

    useEffect(() => () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
    }, [])

    const handleSearchChange = (value: string) => {
        logger.info('[CategoryView] 搜索框输入变化', {
            value,
            trimmedValue: value.trim(),
            categoryId,
            typeFilter,
        })
        setSearchText(value)
        setEntryPage(1)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => {
            logger.info('[CategoryView] 触发防抖搜索', {
                value,
                trimmedValue: value.trim(),
                categoryId,
                typeFilter,
            })
            void loadEntries(value, typeFilter)
        }, 300)
    }

    const saveStarredEntryIds = useCallback(async (entryIds: string[]) => {
        const nextIds = normalizeStarredEntryIds(entryIds)
        const settings = await setting_get_settings()
        const nextSettings = {...settings, starred_entry_ids: nextIds}
        await saveAppSettings(nextSettings)
        return nextIds
    }, [])

    const toggleEntryStar = useCallback(async (entry: EntryBrief) => {
        const previousIds = starredEntryIds
        const nextIds = previousIds.includes(entry.id)
            ? previousIds.filter(id => id !== entry.id)
            : [...previousIds, entry.id]

        setStarredEntryIds(nextIds)
        try {
            setStarredEntryIds(await saveStarredEntryIds(nextIds))
        } catch (error) {
            setStarredEntryIds(previousIds)
            await showAlert(`保存星标失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [saveStarredEntryIds, showAlert, starredEntryIds])

    const handleRenameEntry = useCallback(async (title: string) => {
        if (!renameEntry) return
        if (title === renameEntry.title) {
            setRenameEntry(null)
            return
        }

        setEntryActionBusy(true)
        try {
            const updated = await db_update_entry({id: renameEntry.id, projectId, title})
            setEntries(current => current.map(entry => entry.id === updated.id
                ? {...entry, title: updated.title, updated_at: updated.updated_at ?? new Date().toISOString()}
                : entry
            ))
            setRenameEntry(null)
            onEntryRenamed?.({id: updated.id, title: updated.title})
            await showAlert('词条已重命名', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`重命名词条失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setEntryActionBusy(false)
        }
    }, [onEntryRenamed, projectId, renameEntry, showAlert])

    const handleDeleteEntry = useCallback(async (entry: EntryBrief) => {
        const confirmed = await showAlert(
            `确定删除词条「${entry.title}」吗？此操作不可撤销。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        try {
            await db_delete_entry(entry.id, projectId)
            setEntries(current => current.filter(item => item.id !== entry.id))
            if (starredEntryIds.includes(entry.id)) {
                const nextIds = starredEntryIds.filter(id => id !== entry.id)
                setStarredEntryIds(nextIds)
                await saveStarredEntryIds(nextIds)
            }
            onEntryDeleted?.(entry.id)
            await showAlert('词条已删除', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`删除词条失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [onEntryDeleted, projectId, saveStarredEntryIds, showAlert, starredEntryIds])

    const copyEntryLink = useCallback(async (entry: EntryBrief) => {
        try {
            await navigator.clipboard.writeText(buildInternalEntryMarkdown(entry.title, entry.id, projectId))
            await showAlert('链接已复制', 'success', 'nonInvasive', 1500)
        } catch (error) {
            await showAlert(`复制链接失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        }
    }, [projectId, showAlert])

    const starredEntryIdSet = useMemo(() => new Set(starredEntryIds), [starredEntryIds])

    const handleEntryContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, entry: EntryBrief) => {
        showContextMenu(event, [
            {
                label: starredEntryIdSet.has(entry.id) ? '取消标星' : '标星',
                onClick: () => void toggleEntryStar(entry),
            },
            {label: '复制链接', onClick: () => void copyEntryLink(entry)},
            {label: '重命名', onClick: () => setRenameEntry(entry)},
            {label: '删除', danger: true, onClick: () => void handleDeleteEntry(entry)},
        ])
    }, [copyEntryLink, handleDeleteEntry, showContextMenu, starredEntryIdSet, toggleEntryStar])

    const handleEntriesContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (
            event.target instanceof Element
            && event.target.closest('button, a, input, textarea, select, [role="button"], .pe-entry-card, .pe-entry-create-card, .pe-subcategory-card')
        ) {
            return
        }

        showContextMenu(event, [
            {label: '刷新', disabled: loading, onClick: () => void loadEntries(searchText, typeFilter)},
            {label: '新建词条', disabled: creatingEntry, onClick: () => void onRequestCreateEntry?.(categoryId)},
        ])
    }, [categoryId, creatingEntry, loadEntries, loading, onRequestCreateEntry, searchText, showContextMenu, typeFilter])

    const displayed = useMemo(() => sortEntries(entries, sortMode, starredEntryIdSet), [entries, sortMode, starredEntryIdSet])
    const entryPageSize = Math.max(1, entryGridColumnCount * entryPageRows - 1)
    const entryPageCount = Math.max(1, Math.ceil(displayed.length / entryPageSize))
    const currentEntryPage = Math.min(entryPage, entryPageCount)
    const paginatedEntries = useMemo(() => {
        const start = (currentEntryPage - 1) * entryPageSize
        return displayed.slice(start, start + entryPageSize)
    }, [currentEntryPage, displayed, entryPageSize])
    const coverStats = useMemo(
        () => PROJECT_HOME_PERF_LOG_ENABLED ? summarizeEntryCovers(paginatedEntries) : null,
        [paginatedEntries],
    )
    const hasVisibleEntries = displayed.length > 0
    const showLoadingOverlay = loading && hasVisibleEntries

    useEffect(() => {
        setEntryPage(page => Math.min(page, entryPageCount))
    }, [entryPageCount])

    useEffect(() => {
        entriesScrollRef.current?.scrollTo({top: 0})
    }, [currentEntryPage])

    useEffect(() => {
        if (noScroll) return undefined
        const grid = entryGridRef.current
        if (!grid) return undefined

        const updateColumnCount = () => {
            const columns = window.getComputedStyle(grid).gridTemplateColumns
                .split(' ')
                .filter(Boolean)
                .length
            setEntryGridColumnCount(Math.max(1, columns))
        }
        updateColumnCount()

        const observer = new ResizeObserver(updateColumnCount)
        observer.observe(grid)
        return () => observer.disconnect()
    }, [loading, noScroll])

    useEffect(() => {
        if (!PROJECT_HOME_PERF_LOG_ENABLED) return
        projectHomePerfInfo('词条卡片数据', {
            projectId,
            categoryId,
            categoryName,
            mode: noScroll ? '项目主页内联虚拟网格' : '独立滚动网格',
            loadedEntryCards: entries.length,
            displayedEntryCards: displayed.length,
            renderedEntryCards: paginatedEntries.length,
            page: currentEntryPage,
            pageCount: entryPageCount,
            createCards: 1,
            coverStats,
            entryTypeCount: entryTypes.length,
            typeFilter,
            sortMode,
            searchText: searchText.trim(),
            usingPrefetchedEntries: prefetchedEntries !== undefined,
        })
    }, [
        categoryId,
        categoryName,
        coverStats,
        displayed.length,
        currentEntryPage,
        entries.length,
        entryPageCount,
        entryTypes.length,
        noScroll,
        paginatedEntries.length,
        prefetchedEntries,
        projectId,
        searchText,
        sortMode,
        typeFilter,
    ])

    const renderEntryGrid = () => (
        <div ref={entryGridRef} className="pe-entry-grid">
            {paginatedEntries.map((entry) => (
                <EntryCardItem
                    key={entry.id}
                    projectId={projectId}
                    entry={entry}
                    entryTypes={entryTypes}
                    isStarred={starredEntryIdSet.has(entry.id)}
                    onContextMenu={handleEntryContextMenu}
                    onOpenEntry={onOpenEntry}
                />
            ))}
            <CreateEntryCard
                categoryId={categoryId}
                creating={creatingEntry}
                onRequestCreateEntry={onRequestCreateEntry}
            />
        </div>
    )

    const renderEntryContent = () => noScroll ? (
        <VirtualEntryGrid
            projectId={projectId}
            entries={paginatedEntries}
            entryTypes={entryTypes}
            categoryId={categoryId}
            creatingEntry={creatingEntry}
            starredEntryIdSet={starredEntryIdSet}
            scrollElement={virtualScrollElement}
            onColumnCountChange={setEntryGridColumnCount}
            onRequestCreateEntry={onRequestCreateEntry}
            onEntryContextMenu={handleEntryContextMenu}
            onOpenEntry={onOpenEntry}
        />
    ) : (
        <RollingBox ref={entriesScrollRef} axis="y" className="pe-entries-scroll" thumbSize="thin">
            {renderEntryGrid()}
        </RollingBox>
    )

    return (
        <>
            <RenameDialog
                open={Boolean(renameEntry)}
                title="重命名词条"
                initialValue={renameEntry?.title ?? ''}
                placeholder="输入词条标题"
                confirmText="保存"
                busy={entryActionBusy}
                onClose={() => {
                    if (!entryActionBusy) setRenameEntry(null)
                }}
                onConfirm={title => void handleRenameEntry(title)}
            />
            <div className="pe-category-view">
            <div className="pe-category-navigation" data-tour-id={categoryId ? undefined : 'project-overview-entries'}>
                <div className="pe-category-toolbar">
                    <div className="pe-category-title">{categoryId ? categoryName : (categoryName || '全部词条')}</div>
                    <div className="pe-category-toolbar-right">
                        <Input
                            className="pe-search-input"
                            placeholder="搜索词条…"
                            value={searchText}
                            onValueChange={handleSearchChange}
                        />
                        <Select
                            className="pe-entry-page-size"
                            options={ENTRY_PAGE_ROW_OPTIONS}
                            value={entryPageRows}
                            aria-label="每页显示行数"
                            onValueChange={value => {
                                const nextValue = Array.isArray(value) ? value[0] : value
                                setEntryPageRows(Number(nextValue) as EntryPageRows)
                                setEntryPage(1)
                            }}
                        />
                        <div className="pe-category-toolbar-actions">
                            <Button
                                type="button"
                                size="sm"
                                disabled={creatingEntry}
                                onClick={() => void onRequestCreateEntry?.(categoryId)}
                            >
                                {creatingEntry ? '创建中…' : '+ 新建词条'}
                            </Button>
                        </div>
                        <div className="pe-sort-tabs">
                            {SORT_OPTIONS.map((opt) => (
                                <button
                                    key={opt.key}
                                    className={`pe-sort-tab${sortMode === opt.key ? ' active' : ''}`}
                                    onClick={() => {
                                        setSortMode(opt.key)
                                        setEntryPage(1)
                                    }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            <button
                                className={`pe-sort-tab${sortMode === 'name-asc' || sortMode === 'name-desc' ? ' active' : ''}`}
                                onClick={() => {
                                    setSortMode(current => current === 'name-asc' ? 'name-desc' : 'name-asc')
                                    setEntryPage(1)
                                }}
                            >
                                {sortMode === 'name-desc' ? '标题 Z-A' : '标题 A-Z'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="pe-type-filter">
                    <button
                        className={`pe-type-chip${typeFilter === null ? ' active' : ''}`}
                        onClick={() => {
                            setTypeFilter(null)
                            setEntryPage(1)
                        }}
                    >
                        全部
                    </button>
                    {entryTypes.map((et) => {
                        const key = entryTypeKey(et)
                        return (
                            <button
                                key={key}
                                className={`pe-type-chip${typeFilter === key ? ' active' : ''}`}
                                style={{'--chip-color': et.color} as CSSProperties}
                                onClick={() => {
                                    setTypeFilter(typeFilter === key ? null : key)
                                    setEntryPage(1)
                                }}
                            >
                                <EntryTypeIcon entryType={et} className="pe-type-chip-icon"/>
                                {et.name}
                            </button>
                        )
                    })}
                </div>
                {childCategories.length > 0 && (
                    <div className="pe-subcategory-strip" aria-label="子分类">
                        <span className="pe-subcategory-strip__title">子分类</span>
                        <RollingBox axis="x" className="pe-subcategory-list" thumbSize="thin">
                            {childCategories.map((category) => (
                                <button
                                    key={category.id}
                                    type="button"
                                    className="pe-subcategory-card"
                                    title={category.name}
                                    onClick={() => onSelectCategory?.(category.id)}
                                >
                                    <span className="pe-subcategory-card__marker" aria-hidden="true"/>
                                    <span className="pe-subcategory-card__name">{category.name}</span>
                                </button>
                            ))}
                        </RollingBox>
                    </div>
                )}
            </div>

            <div
                className={`pe-entries-region${noScroll ? ' is-inline' : ' is-scrollable'}`}
                onContextMenu={handleEntriesContextMenu}
            >
                {loading && !hasVisibleEntries ? (
                    <div className="pe-entries-status">加载中…</div>
                ) : (
                    renderEntryContent()
                )}
                {showLoadingOverlay && (
                    <div className="pe-entries-overlay" aria-hidden="true">
                        <span className="pe-entries-overlay__label">刷新词条中…</span>
                    </div>
                )}
            </div>
            {entryPageCount > 1 && (
                <nav className="pe-entry-pagination" aria-label="词条列表分页">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={currentEntryPage === 1}
                        onClick={() => setEntryPage(page => Math.max(1, page - 1))}
                    >
                        上一页
                    </Button>
                    <span aria-live="polite">{currentEntryPage} / {entryPageCount}</span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={currentEntryPage === entryPageCount}
                        onClick={() => setEntryPage(page => Math.min(entryPageCount, page + 1))}
                    >
                        下一页
                    </Button>
                </nav>
            )}
            </div>
        </>
    )
}

export default memo(CategoryView)
