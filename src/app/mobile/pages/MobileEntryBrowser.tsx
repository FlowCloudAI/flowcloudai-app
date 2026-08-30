/**
 * 词条浏览的展示层：搜索框、类型筛选条、卡片网格与分页条。
 * 状态在 useMobileEntryBrowser；宿主是词条列表页与项目主页底部的「全部词条」。
 *
 * 渲染为 Fragment 而不是包一层容器：词条列表页的空态样式依赖
 * `.mobile-entry-list:has(> .mobile-page__empty)` 这种直接子元素关系。
 */
import {type CSSProperties} from 'react'
import {Button, Card, Input} from 'flowcloudai-ui'
import {type EntryBrief, entryTypeKey} from '../../../api'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import EntryCoverImage from '../../../features/entries/components/EntryCoverImage'
import {getMeaningfulCoverMark} from '../../../shared/lib/defaultCover'
import MobilePagination from '../components/MobilePagination'
import {formatMobileEntryListDate} from './MobileEntryDate'
import {type MobileEntryBrowserState} from './useMobileEntryBrowser'
import './MobileEntryBrowser.css'

interface Props {
    projectId: string
    state: MobileEntryBrowserState
    onOpenEntry: (entry: EntryBrief) => void
    onCreateEntry: () => void
}

export default function MobileEntryBrowser({projectId, state, onOpenEntry, onCreateEntry}: Props) {
    const {entries, entryTypes, currentPage, pageCount, loading, loadError, searchText, typeFilter} = state
    return (
        <>
            <div className="mobile-entry-list__toolbar">
                <Input
                    placeholder="搜索词条…"
                    aria-label="搜索词条"
                    value={searchText}
                    onValueChange={state.onSearch}
                    className="mobile-page__search mobile-entry-list__search"
                    radius="full"
                    size="lg"
                    allowClear
                />
            </div>

            {entryTypes.length > 0 && (
                <div className="mobile-entry-list__filters" data-mobile-horizontal-scroll="true">
                    <button
                        type="button"
                        className={`mobile-entry-list__filter${typeFilter === null ? ' active' : ''}`}
                        onClick={() => state.onTypeFilter(null)}
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
                                onClick={() => state.onTypeFilter(active ? null : key)}
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
                    <Button type="button" size="sm" variant="outline" onClick={state.retry}>重试</Button>
                </div>
            ) : entries.length === 0 ? (
                <div className="mobile-page__empty">
                    <p>暂无词条</p>
                    <Button type="button" size="sm" radius="full" onClick={onCreateEntry}>新建第一个词条</Button>
                </div>
            ) : (
                <div className="mobile-entry-list__grid">
                    {/*
                      * 不在这里排序：db_list_entries / db_search_entries 的 SQL 都是
                      * `ORDER BY updated_at DESC`，后端已按同一个键排好。
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
                                onClick={() => onOpenEntry(entry)}
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
                onPageChange={state.onPageChange}
            />
        </>
    )
}
