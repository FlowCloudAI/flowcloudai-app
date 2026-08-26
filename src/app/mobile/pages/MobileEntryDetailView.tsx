/**
 * 移动端词条展示页：按主图、身份、摘要、属性、正文、关联的阅读顺序组织只读内容。
 * 图片浏览与词条跳转由上层注入，本组件只维护滚动标题与正反链展开状态。
 */
import MarkdownPreview from '@uiw/react-markdown-preview'
import {
    type CSSProperties,
    type Dispatch,
    type MouseEvent as ReactMouseEvent,
    type RefObject,
    type SetStateAction,
    type UIEvent,
    useEffect,
    useRef,
    useState,
} from 'react'
import {Button} from 'flowcloudai-ui'
import {rehypeSanitizeRawHtml} from '../../../shared/markdown/rehypeSanitizeRawHtml'
import {
    type Entry,
    type EntryBrief,
    type EntryLink,
    type EntryTypeView,
    type TagSchema,
} from '../../../api'
import HighLightTagItem from '../../../features/entries/components/HighLightTagItem'
import EntryTypeIcon from '../../../features/project-editor/components/EntryTypeIcon'
import {getComparableTagValue} from '../../../features/entries/lib/entryTag'
import {type EntryImage, toEntryImageSrc} from '../../../features/entries/lib/entryImage'
import {type EntryRelationDraft} from '../../../features/project-editor/components/EntryRelations/EntryRelationCreator'
import {
    MobileAnchoredActionMenu,
    type MobileAnchoredMenuItem,
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {getImageLabel, type TagValueMap} from './MobileEntryDetailUtils'

interface MobileEntryDetailViewProps {
    pageRef: RefObject<HTMLDivElement | null>
    topActionsRef: RefObject<HTMLDivElement | null>
    entry: Entry
    error: string | null
    entryType: EntryTypeView | null
    categoryName: string | null
    updatedDate: string
    typeBadgeStyle?: CSSProperties
    viewTagSchemas: TagSchema[]
    implantedTagSchemaIdSet: Set<string>
    viewTagMap: TagValueMap
    viewImages: EntryImage[]
    viewMarkdownSource: string
    viewRelationDrafts: EntryRelationDraft[]
    hasConnections: boolean
    outgoingLinks: EntryLink[]
    incomingLinks: EntryLink[]
    entryBriefById: Map<string, EntryBrief>
    /** 关联标题仍在按需载入时，区分“载入中”与“词条已删除”。 */
    connectionsResolving: boolean
    colorMode: 'light' | 'dark'
    menuOpen: boolean
    setMenuOpen: Dispatch<SetStateAction<boolean>>
    onBack: () => void
    onAiDiscuss: () => void
    onEdit: () => void
    onDelete: () => void
    onOpenImage: (index: number) => void
    onOpenLinkedEntry: (entryId: string) => void
    onMarkdownClick: (event: ReactMouseEvent<HTMLDivElement>) => void
}

function getRelationIcon(direction: EntryRelationDraft['direction']) {
    if (direction === 'incoming') return 'relation-incoming' as const
    if (direction === 'two_way') return 'relation-two-way' as const
    return 'relation-outgoing' as const
}

export function MobileEntryDetailView({
    pageRef,
    topActionsRef,
    entry,
    error,
    entryType,
    categoryName,
    updatedDate,
    typeBadgeStyle,
    viewTagSchemas,
    implantedTagSchemaIdSet,
    viewTagMap,
    viewImages,
    viewMarkdownSource,
    viewRelationDrafts,
    hasConnections,
    outgoingLinks,
    incomingLinks,
    entryBriefById,
    connectionsResolving,
    colorMode,
    menuOpen,
    setMenuOpen,
    onBack,
    onAiDiscuss,
    onEdit,
    onDelete,
    onOpenImage,
    onOpenLinkedEntry,
    onMarkdownClick,
}: MobileEntryDetailViewProps) {
    const titleRef = useRef<HTMLHeadingElement>(null)
    const [showStickyTitle, setShowStickyTitle] = useState(false)
    const [linksExpanded, setLinksExpanded] = useState(false)
    const coverIndex = Math.max(0, viewImages.findIndex(image => image.is_cover))
    const coverImage = viewImages[coverIndex]
    const coverSrc = coverImage ? toEntryImageSrc(coverImage) : null

    const entryMenuItems: MobileAnchoredMenuItem[] = [{
        key: 'delete',
        label: '删除词条',
        description: '永久删除当前词条',
        icon: <MobileEntryDetailActionIcon type="delete"/>,
        danger: true,
        onSelect: onDelete,
    }]

    // 滚动事件在 Android WebView 上会连发，直接量 rect 会让长文滚动掉帧；
    // 每帧最多测一次，测完再清标记。
    const scrollFrameRef = useRef(0)
    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        if (scrollFrameRef.current) return
        const page = event.currentTarget
        scrollFrameRef.current = window.requestAnimationFrame(() => {
            scrollFrameRef.current = 0
            const titleElement = titleRef.current
            if (!titleElement) return
            setShowStickyTitle(titleElement.getBoundingClientRect().bottom <= page.getBoundingClientRect().top)
        })
    }

    useEffect(() => () => {
        if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current)
    }, [])

    return (
        <div ref={pageRef} className="mobile-page mobile-entry-detail" onScroll={handleScroll}>
            <MobilePageTopBar
                className="mobile-entry-detail__view-topbar"
                sticky
                edgeToEdge
                ariaLabel="词条查看操作"
                left={<MobileTopActionPill actions={[{
                    key: 'back',
                    label: '返回',
                    icon: <MobileBackIcon/>,
                    onClick: onBack,
                }]}/>}
                center={showStickyTitle ? <div className="mobile-entry-detail__sticky-title">{entry.title}</div> : undefined}
                right={<MobileTopActionPill
                    ref={topActionsRef}
                    className="mobile-entry-detail__view-actions"
                    actions={[
                        {
                            key: 'ai',
                            label: 'AI 讨论',
                            icon: <MobileEntryDetailActionIcon type="ai"/>,
                            onClick: onAiDiscuss,
                        },
                        {
                            key: 'edit',
                            label: '编辑词条',
                            icon: <MobileEntryDetailActionIcon type="edit"/>,
                            onClick: onEdit,
                        },
                        {
                            key: 'menu',
                            label: '更多操作',
                            icon: <MobileEntryDetailActionIcon type="more"/>,
                            kind: 'more',
                            ariaHasPopup: 'menu',
                            ariaExpanded: menuOpen,
                            onClick: () => setMenuOpen(open => !open),
                        },
                    ]}
                />}
            />

            {error && <div className="mobile-page__error-banner" role="alert"><span>词条刷新失败：{error}</span></div>}

            {coverImage && coverSrc && (
                <button
                    type="button"
                    className="mobile-entry-detail__hero"
                    aria-label={`查看${entry.title}的图片设定集，共 ${viewImages.length} 张`}
                    onClick={() => onOpenImage(coverIndex)}
                >
                    <img src={coverSrc} alt={getImageLabel(coverImage, coverIndex)}/>
                    {viewImages.length > 1 && <span className="mobile-entry-detail__hero-count">{viewImages.length} 张</span>}
                </button>
            )}

            <h1 ref={titleRef} className="mobile-entry-detail__title">{entry.title}</h1>

            <div className="mobile-entry-detail__identity-line">
                {entryType && (
                    <span className="mobile-entry-detail__type-badge" style={typeBadgeStyle}>
                        <EntryTypeIcon entryType={entryType} className=""/> {entryType.name}
                    </span>
                )}
                {/* 分类与类型同名时只显示徽章：两个一模一样的词并排不提供任何信息。 */}
                {categoryName && categoryName !== entryType?.name && (
                    <span className="mobile-entry-detail__category-name">{categoryName}</span>
                )}
                <span className="mobile-entry-detail__updated-date">更新于 {updatedDate}</span>
            </div>

            {entry.summary && <p className="mobile-entry-detail__summary">{entry.summary}</p>}

            {viewTagSchemas.length > 0 && (
                <div className="mobile-entry-detail__meta-chips" aria-label="词条属性">
                    {viewTagSchemas.map(schema => {
                        const value = getComparableTagValue(viewTagMap, schema)
                        return (
                            <div key={schema.id} className="mobile-entry-detail__tag-chip">
                                <HighLightTagItem
                                    schema={{
                                        id: schema.id,
                                        name: schema.name,
                                        type: schema.type as 'number' | 'string' | 'boolean',
                                        range_min: schema.range_min ?? null,
                                        range_max: schema.range_max ?? null,
                                    }}
                                    value={value}
                                    implanted={implantedTagSchemaIdSet.has(schema.id)}
                                    mode="show"
                                    layout="row"
                                />
                            </div>
                        )
                    })}
                </div>
            )}

            <section className="mobile-entry-detail__reading-section" aria-labelledby="mobile-entry-body-heading">
                <div className="mobile-entry-detail__section-heading">
                    <h2 id="mobile-entry-body-heading">正文</h2>
                    {entry.content && <span>{entry.content.trim().length.toLocaleString()} 字</span>}
                </div>
                {entry.content ? (
                    <div className="mobile-entry-detail__markdown" data-color-mode={colorMode} onClick={onMarkdownClick}>
                        <MarkdownPreview
                            source={viewMarkdownSource}
                            className="mobile-entry-detail__markdown-preview"
                            wrapperElement={{'data-color-mode': colorMode}}
                            rehypePlugins={[rehypeSanitizeRawHtml]}
                        />
                    </div>
                ) : (
                    <div className="mobile-entry-detail__empty">
                        <p>这条词条还只有一个名字。<br/>写点什么，或者让 AI 先起个草稿。</p>
                        <div className="mobile-entry-detail__empty-actions">
                            <Button type="button" variant="primary" onClick={onEdit}>开始写正文</Button>
                            <Button type="button" variant="ghost" onClick={onAiDiscuss}>让 AI 起草</Button>
                        </div>
                    </div>
                )}
            </section>

            {hasConnections && (
                <section className="mobile-entry-detail__connections" aria-labelledby="mobile-entry-connections-heading">
                    <div className="mobile-entry-detail__section-heading">
                        <h2 id="mobile-entry-connections-heading">关联</h2>
                    </div>

                    {viewRelationDrafts.length > 0 && (
                        <div className="mobile-entry-detail__connection-list">
                            {viewRelationDrafts.map((relation, index) => {
                                const target = relation.otherEntryId ? entryBriefById.get(relation.otherEntryId) : null
                                return (
                                    <button
                                        type="button"
                                        className="mobile-entry-detail__connection-row"
                                        key={relation.id ?? `relation-${index}`}
                                        disabled={!target}
                                        onClick={() => relation.otherEntryId && onOpenLinkedEntry(relation.otherEntryId)}
                                    >
                                        <span className="mobile-entry-detail__connection-icon" aria-hidden="true">
                                            <MobileEntryDetailActionIcon type={getRelationIcon(relation.direction)}/>
                                        </span>
                                        <span className="mobile-entry-detail__connection-title">
                                            {target?.title ?? (connectionsResolving ? '载入中…' : '词条不存在或已删除')}
                                        </span>
                                        {relation.content && <span className="mobile-entry-detail__connection-meta">{relation.content}</span>}
                                    </button>
                                )
                            })}
                        </div>
                    )}

                    {(outgoingLinks.length > 0 || incomingLinks.length > 0) && (
                        <button
                            type="button"
                            className="mobile-entry-detail__link-summary"
                            aria-expanded={linksExpanded}
                            onClick={() => setLinksExpanded(expanded => !expanded)}
                        >
                            <span>正文提到 {outgoingLinks.length} · 被提到 {incomingLinks.length}</span>
                            <span className="mobile-entry-detail__link-summary-icon" aria-hidden="true"><MobileEntryDetailActionIcon type="chevron"/></span>
                        </button>
                    )}

                    {linksExpanded && (
                        <div className="mobile-entry-detail__connection-list mobile-entry-detail__connection-list--links">
                            {outgoingLinks.map(link => {
                                const target = entryBriefById.get(link.b_id)
                                return (
                                    <button type="button" className="mobile-entry-detail__connection-row" key={link.id} disabled={!target} onClick={() => onOpenLinkedEntry(link.b_id)}>
                                        <span className="mobile-entry-detail__connection-icon is-muted" aria-hidden="true"><MobileEntryDetailActionIcon type="link-outgoing"/></span>
                                        <span className="mobile-entry-detail__connection-title">{target?.title ?? (connectionsResolving ? '载入中…' : '词条不存在或已删除')}</span>
                                        <span className="mobile-entry-detail__connection-meta">正文提到</span>
                                    </button>
                                )
                            })}
                            {incomingLinks.map(link => {
                                const source = entryBriefById.get(link.a_id)
                                return (
                                    <button type="button" className="mobile-entry-detail__connection-row" key={link.id} disabled={!source} onClick={() => onOpenLinkedEntry(link.a_id)}>
                                        <span className="mobile-entry-detail__connection-icon is-muted" aria-hidden="true"><MobileEntryDetailActionIcon type="link-incoming"/></span>
                                        <span className="mobile-entry-detail__connection-title">{source?.title ?? (connectionsResolving ? '载入中…' : '词条不存在或已删除')}</span>
                                        <span className="mobile-entry-detail__connection-meta">被提到</span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </section>
            )}

            <MobileAnchoredActionMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorRef={topActionsRef}
                containerRef={pageRef}
                ariaLabel="词条操作"
                items={entryMenuItems}
            />
        </div>
    )
}
