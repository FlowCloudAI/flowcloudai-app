import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button, RollingBox} from 'flowcloudai-ui'
import {db_list_timeline_events, type ProjectTimelineData, type TagSchema,} from '../../../api'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectTimeline.css'
import {Timeline, type TimelineEvent} from './Timeline'

interface ProjectTimelineProps {
    projectId: string
    tagSchemas: TagSchema[]
    onBack?: () => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
    sidebarContainer?: HTMLElement | null
    scrollableRows?: boolean
    compact?: boolean
}

interface TimelineTagHintGroup {
    label: string
    examples: string[]
}

type TimelineTagRole = 'start' | 'end' | 'parent' | 'show'

const TIMELINE_TAG_HINTS: TimelineTagHintGroup[] = [
    {label: '开始时间', examples: ['开始年份', '开始时间', 'year', 'start_year']},
    {label: '结束时间', examples: ['结束年份', '结束时间', 'end_year']},
    {label: '上级事件', examples: ['上级事件', '父级事件', 'parent_id']},
    {label: '是否显示', examples: ['时间线', '纳入时间线', 'show_timeline']},
]

function normalizeTagName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '')
}

function getTimelineRole(name: string): TimelineTagRole | null {
    switch (normalizeTagName(name)) {
        case 'start':
        case 'startyear':
        case 'starttime':
        case 'year':
        case '年份':
        case '开始':
        case '开始年':
        case '开始年份':
        case '开始时间':
        case '起始':
        case '起始年':
        case '起始年份':
        case '起始时间':
            return 'start'
        case 'end':
        case 'endyear':
        case 'endtime':
        case '结束':
        case '结束年':
        case '结束年份':
        case '结束时间':
        case '终止':
        case '终止年':
        case '终止年份':
        case '终止时间':
            return 'end'
        case 'parent':
        case 'parentid':
        case '父事件':
        case '父级事件':
        case '父事件id':
        case '父级事件id':
        case '上级事件':
        case '上级事件id':
            return 'parent'
        case 'timeline':
        case 'ontimeline':
        case 'showtimeline':
        case '时间线':
        case '纳入时间线':
        case '显示在时间线':
        case '显示时间线':
            return 'show'
        default:
            return null
    }
}

function formatYear(year: number) {
    if (year < 0) return `公元前 ${Math.abs(year)} 年`
    return `公元 ${year} 年`
}

function formatRange(event: { startTime: number; endTime?: number | null }) {
    if (typeof event.endTime === 'number') {
        return `${formatYear(event.startTime)} - ${formatYear(event.endTime)}`
    }
    return formatYear(event.startTime)
}

function buildRangeText(data: ProjectTimelineData) {
    if (typeof data.yearStart !== 'number' || typeof data.yearEnd !== 'number') {
        return '暂无'
    }
    return `${formatYear(data.yearStart)} - ${formatYear(data.yearEnd)}`
}

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : '未知错误')
}

// 时间线用左右方向键切换事件；焦点落在可编辑元素时必须让行，否则会吞掉光标移动
function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tagName = target.tagName
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

function BackArrow() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 16, height: 16}}>
            <path
                d="M8.6 3.25L4.1 7.75L8.6 12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M4.5 7.75H12.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
}

export default function ProjectTimeline({
    projectId,
    tagSchemas,
    onBack,
    onOpenEntry,
    sidebarContainer,
    scrollableRows = false,
    compact = false,
}: ProjectTimelineProps) {
    const [data, setData] = useState<ProjectTimelineData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
    const [timelineControlsContainer, setTimelineControlsContainer] = useState<HTMLDivElement | null>(null)
    const selectedEventIdRef = useRef<string | null>(null)
    const eventStripRef = useRef<HTMLDivElement | null>(null)
    const eventItemRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const shouldSyncEventStripRef = useRef(false)

    useEffect(() => {
        selectedEventIdRef.current = selectedEventId
    }, [selectedEventId])

    const matchedSchemaNames = useMemo(() => {
        const groups: Record<TimelineTagRole, string[]> = {
            start: [] as string[],
            end: [] as string[],
            parent: [] as string[],
            show: [] as string[],
        }

        tagSchemas.forEach((schema) => {
            const role = getTimelineRole(schema.name)
            if (!role) return
            groups[role].push(schema.name)
        })

        return groups
    }, [tagSchemas])

    const events = useMemo(() => data?.events ?? [], [data])
    const eventsRef = useRef(events)
    useEffect(() => {
        eventsRef.current = events
    }, [events])
    const selectedEvent = useMemo(
        () => events.find((event) => event.id === selectedEventId) ?? null,
        [events, selectedEventId],
    )

    const eventStats = useMemo(() => {
        const rangeEvents = events.filter((event) => typeof event.endTime === 'number').length
        const pointEvents = events.length - rangeEvents
        const hierarchyEvents = events.filter((event) => event.parentId).length
        return {rangeEvents, pointEvents, hierarchyEvents}
    }, [events])

    const loadTimeline = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const nextData = await db_list_timeline_events(projectId)
            setData(nextData)
            setSelectedEventId((current) => {
                if (current && nextData.events.some((event) => event.id === current)) return current
                return nextData.events[0]?.id ?? null
            })
        } catch (nextError) {
            setError(normalizeError(nextError))
            setData(null)
            setSelectedEventId(null)
        } finally {
            setLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        void loadTimeline()
    }, [loadTimeline])

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            if (isEditableTarget(event.target)) return

            const currentEvents = eventsRef.current
            const activeId = selectedEventIdRef.current
            if (currentEvents.length === 0 || !activeId) return

            const currentIndex = currentEvents.findIndex((item) => item.id === activeId)
            if (currentIndex < 0) return

            event.preventDefault()
            const nextIndex = event.key === 'ArrowLeft'
                ? Math.max(0, currentIndex - 1)
                : Math.min(currentEvents.length - 1, currentIndex + 1)

            if (nextIndex !== currentIndex) {
                shouldSyncEventStripRef.current = false
                setSelectedEventId(currentEvents[nextIndex].id)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    useEffect(() => {
        if (!selectedEventId) return
        if (!shouldSyncEventStripRef.current) return
        const container = eventStripRef.current
        const target = eventItemRefs.current[selectedEventId]
        shouldSyncEventStripRef.current = false
        if (!container || !target) return
        const frameId = requestAnimationFrame(() => {
            const targetLeft = target.offsetLeft
            const targetRight = targetLeft + target.offsetWidth
            const visibleLeft = container.scrollLeft
            const visibleRight = visibleLeft + container.clientWidth

            if (targetLeft >= visibleLeft && targetRight <= visibleRight) {
                return
            }

            const containerWidth = container.clientWidth
            const maxScrollLeft = Math.max(0, container.scrollWidth - containerWidth)
            const targetCenter = targetLeft + target.offsetWidth / 2
            const nextScrollLeft = Math.min(
                maxScrollLeft,
                Math.max(0, targetCenter - containerWidth / 2),
            )

            if (Math.abs(container.scrollLeft - nextScrollLeft) < 1) return

            container.scrollTo({
                left: nextScrollLeft,
                behavior: 'smooth',
            })
        })
        return () => cancelAnimationFrame(frameId)
    }, [selectedEventId, events])

    const handleTimelineSelect = useCallback((eventId: string | null) => {
        if (!eventId || eventId === selectedEventIdRef.current) return
        shouldSyncEventStripRef.current = true
        setSelectedEventId(eventId)
    }, [])

    const timelineEvents = useMemo<TimelineEvent[]>(
        () => events.map((event) => ({
            id: event.id,
            title: event.title,
            startTime: event.startTime,
            endTime: event.endTime ?? undefined,
            description: formatRange(event),
            parentId: event.parentId ?? undefined,
        })),
        [events],
    )

    const matchedTagCount = Object.values(matchedSchemaNames).reduce((sum, names) => sum + names.length, 0)
    const timelineStats = data ? (
        <div className="project-timeline__stats-sidebar">
            <div className="project-timeline__stats-title">统计数据</div>
            <div className="project-timeline__stats-grid">
                <div className="project-timeline__stat-card">
                    <span>时间线事件</span>
                    <strong>{data.matchedEntryCount}</strong>
                </div>
                <div className="project-timeline__stat-card">
                    <span>持续区间</span>
                    <strong>{eventStats.rangeEvents}</strong>
                </div>
                <div className="project-timeline__stat-card">
                    <span>单点事件</span>
                    <strong>{eventStats.pointEvents}</strong>
                </div>
                <div className="project-timeline__stat-card">
                    <span>层级事件</span>
                    <strong>{eventStats.hierarchyEvents}</strong>
                </div>
            </div>
            <div className="project-timeline__stats-block">
                <span className="project-timeline__stats-label">范围</span>
                <span className="project-timeline__stats-value">{buildRangeText(data)}</span>
            </div>
            {matchedTagCount > 0 && (
                <details className="project-timeline__stats-block project-timeline__stats-details">
                    <summary className="project-timeline__stats-label">
                        识别规则
                        <span>{matchedTagCount}</span>
                    </summary>
                    <span className="project-timeline__stats-value">
                        {[
                            matchedSchemaNames.start.length > 0 ? `开始 ${matchedSchemaNames.start.join('、')}` : '',
                            matchedSchemaNames.end.length > 0 ? `结束 ${matchedSchemaNames.end.join('、')}` : '',
                            matchedSchemaNames.parent.length > 0 ? `上级事件 ${matchedSchemaNames.parent.join('、')}` : '',
                            matchedSchemaNames.show.length > 0 ? `显示 ${matchedSchemaNames.show.join('、')}` : '',
                        ].filter(Boolean).join('；')}
                    </span>
                </details>
            )}
        </div>
    ) : (
        <div className="project-timeline__stats-sidebar">
            <div className="project-timeline__stats-title">统计数据</div>
            <div className="project-timeline__stats-empty">
                {loading ? '正在加载时间线数据…' : '暂无统计数据。'}
            </div>
        </div>
    )

    return (
        <div className="project-timeline fc-op-panel">
            {sidebarContainer ? createPortal(timelineStats, sidebarContainer) : null}

            {/* 移动端把操作收进内容卡片，避免额外占用一整行首屏高度。 */}
            {!compact && (
                <div className="fc-op-header">
                    {onBack && (
                        <Button type="button" className="fc-op-back-btn" variant="ghost" size="sm" onClick={onBack}>
                            <BackArrow/>返回
                        </Button>
                    )}
                    <div className="fc-op-header__title-block">
                        <h2 className="fc-op-header__title">时间线</h2>
                    </div>
                    <div className="fc-op-header__actions">
                        {selectedEvent && onOpenEntry && (
                            <Button type="button"
                                size="sm"
                                variant="primary"
                                onClick={() => onOpenEntry({id: selectedEvent.id, title: selectedEvent.title})}
                            >
                                打开当前词条
                            </Button>
                        )}
                        <Button type="button" size="sm" variant="ghost" onClick={() => void loadTimeline()} disabled={loading}>
                            {loading ? '刷新中' : '刷新'}
                        </Button>
                    </div>
                </div>
            )}

            {/* ── 工具栏（统计标签） ── */}
            {!compact && !sidebarContainer && data && events.length > 0 && (
                <div className="fc-op-toolbar" data-mobile-horizontal-scroll="true">
                    <span className="fc-op-chip">时间线事件 {data.matchedEntryCount}</span>
                    <span className="fc-op-chip">持续区间 {eventStats.rangeEvents}</span>
                    <span className="fc-op-chip">单点事件 {eventStats.pointEvents}</span>
                    <span className="fc-op-chip">层级事件 {eventStats.hierarchyEvents}</span>
                    <div className="fc-op-toolbar__sep" />
                    <span className="fc-op-status">范围：{buildRangeText(data)}</span>
                    {matchedTagCount > 0 && (
                        <span className="fc-op-status">
                            标签：{[
                                matchedSchemaNames.start.length > 0 ? `开始 ${matchedSchemaNames.start.join('、')}` : '',
                                matchedSchemaNames.end.length > 0 ? `结束 ${matchedSchemaNames.end.join('、')}` : '',
                                matchedSchemaNames.parent.length > 0 ? `上级事件 ${matchedSchemaNames.parent.join('、')}` : '',
                                matchedSchemaNames.show.length > 0 ? `显示 ${matchedSchemaNames.show.join('、')}` : '',
                            ].filter(Boolean).join('；')}
                        </span>
                    )}
                </div>
            )}

            {/* ── 错误提示 ── */}
            {error && (
                <div className="fc-status-banner fc-status-banner--error">
                    时间线数据加载失败：{error.message}
                </div>
            )}

            {/* ── 主体 ── */}
            {loading && !data ? (
                <div className="fc-op-viewport-empty">
                    <div className="fc-op-hint-block">
                        <div className="fc-op-hint">正在加载时间线数据…</div>
                    </div>
                </div>
            ) : events.length === 0 ? (
                <div className="fc-op-viewport-empty">
                    <div className="fc-op-hint-block">
                        <div className="fc-op-hint">当前项目还没有可渲染的时间线事件。</div>
                        <div className="fc-op-hint">至少需要在某些词条上设置一个可识别的“开始时间”标签。</div>
                        {TIMELINE_TAG_HINTS.map((group) => (
                            <div key={group.label} className="fc-op-hint">
                                {group.label}：{group.examples.join(' / ')}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="project-timeline__layout">
                    <section className="project-timeline__event-panel">
                        <div className="project-timeline__section-header">
                            <div className="project-timeline__section-heading">
                                <span className="project-timeline__section-title">事件列表</span>
                            </div>
                            <div className="project-timeline__event-header-actions">
                                <span className="fc-op-count">
                                    {selectedEvent
                                        ? `${events.findIndex((event) => event.id === selectedEvent.id) + 1} / ${events.length}`
                                        : `0 / ${events.length}`}
                                </span>
                                {compact && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => void loadTimeline()}
                                        disabled={loading}
                                    >
                                        {loading ? '刷新中' : '刷新'}
                                    </Button>
                                )}
                            </div>
                        </div>
                        <RollingBox
                            ref={eventStripRef}
                            className="project-timeline__event-strip"
                            data-mobile-horizontal-scroll="true"
                            axis="x"
                            thumbSize="thin"
                            showThumb="show"
                            showTrack
                            role="list"
                            aria-label="时间线事件列表"
                        >
                            {events.map((event, index) => {
                                const isSelected = event.id === selectedEventId
                                return (
                                    <div
                                        key={event.id}
                                        ref={(node) => {
                                            eventItemRefs.current[event.id] = node
                                        }}
                                        className={`project-timeline__event-item fc-op-item${isSelected ? ' is-active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={isSelected}
                                        aria-label={`选择事件：${event.title}`}
                                        onClick={() => {
                                            shouldSyncEventStripRef.current = false
                                            setSelectedEventId(event.id)
                                        }}
                                        onKeyDown={(keyboardEvent) => {
                                            if (keyboardEvent.target !== keyboardEvent.currentTarget) return
                                            if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
                                            keyboardEvent.preventDefault()
                                            shouldSyncEventStripRef.current = false
                                            setSelectedEventId(event.id)
                                        }}
                                    >
                                        <span className="project-timeline__event-order">{index + 1}</span>
                                        <div className="fc-op-item__content">
                                            <span className="fc-op-item__title">{event.title}</span>
                                            <span className="fc-op-item__meta">{formatRange(event)}</span>
                                            {event.description?.trim() ? (
                                                <span className="fc-op-item__excerpt">
                                                    {event.description.trim()}
                                                </span>
                                            ) : (
                                                <span className="fc-op-item__excerpt">
                                                    该词条未填写摘要，时间线将直接使用标题展示。
                                                </span>
                                            )}
                                        </div>
                                        {compact && onOpenEntry && (
                                            <Button
                                                type="button"
                                                className="project-timeline__event-open"
                                                size="sm"
                                                variant="outline"
                                                onClick={(clickEvent) => {
                                                    clickEvent.stopPropagation()
                                                    onOpenEntry({id: event.id, title: event.title})
                                                }}
                                            >
                                                打开
                                            </Button>
                                        )}
                                    </div>
                                )
                            })}
                        </RollingBox>
                    </section>

                    <section className="project-timeline__timeline-panel">
                        <div className="project-timeline__section-header project-timeline__section-header--timeline">
                            <div className="project-timeline__section-heading">
                                <span className="project-timeline__section-title">时间线视图</span>
                                <span className="project-timeline__section-copy">滚轮平移 · Ctrl/⌘ + 滚轮缩放 · ←/→ 切换事件</span>
                            </div>
                            <div className="project-timeline__timeline-header-actions">
                                {selectedEvent && (
                                    <div
                                        className="project-timeline__selected-meta"
                                        title={`${selectedEvent.title} · ${formatRange(selectedEvent)}${selectedEvent.description?.trim() ? ` · ${selectedEvent.description.trim()}` : ''}`}
                                    >
                                        <span className="project-timeline__selected-title">
                                            {selectedEvent.title} · {formatRange(selectedEvent)}
                                        </span>
                                        {selectedEvent.description?.trim() && (
                                            <span className="project-timeline__selected-summary">
                                                {selectedEvent.description.trim()}
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div
                                    ref={setTimelineControlsContainer}
                                    className="project-timeline__zoom-host"
                                />
                            </div>
                        </div>
                        <div className="project-timeline__timeline-shell">
                            <Timeline
                                events={timelineEvents}
                                yearStart={data?.yearStart ?? Math.min(...timelineEvents.map((event) => event.startTime))}
                                yearEnd={data?.yearEnd ?? Math.max(...timelineEvents.map((event) => event.endTime ?? event.startTime))}
                                selectedKey={selectedEventId}
                                onSelectedKeyChange={handleTimelineSelect}
                                controlsContainer={timelineControlsContainer}
                                scrollableRows={scrollableRows}
                            />
                        </div>
                    </section>
                </div>
            )}
        </div>
    )
}
