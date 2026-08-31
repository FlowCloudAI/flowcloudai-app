/**
 * 移动端词条属性页：承载类型、分类、图片、标签与关系入口。
 * 这些内容会滚动且包含输入，因此必须是页面栈里的完整页面，不能放进底部面板。
 */
import {type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState} from 'react'
import {Button} from 'flowcloudai-ui'
import {
    db_list_all_entry_types,
    db_list_entries,
    db_list_tag_schemas,
    type CustomEntryType,
    type EntryBrief,
    type EntryTypeView,
    entryTypeKey,
    type TagSchema,
} from '../../../api'
import {type MobileEntryImageAddBridgedProps} from './MobileEntryImageAdd'
import {createMobileEditorToken} from '../stores/mobileEditorHandoff'
import {useProvideMobilePageProps} from './useMobilePageProps'
import {useMobileEditorResult} from './useMobileEditorResult'
import useEntryTags from '../../../features/entries/hooks/useEntryTags'
import type {EntryImage} from '../../../features/entries/lib/entryImage'
import {logger} from '../../../shared/logger'
import {
    MobileAddIcon,
    MobileBackIcon,
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import MobileImageViewer from '../components/MobileImageViewer'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import {
    updateMobileEntryEditDraft,
    useMobileEntryEditDraft,
} from '../stores/mobileEntryEditDraftStore'
import type {MobileEntryEditChildPageParams, MobilePage} from '../usePageStack'
import {MobileEntryImagesSection} from './MobileEntryImagesSection'
import type {TagValueMap} from './MobileEntryDetailUtils'
import {MobileEntryTagsSection} from './MobileEntryTagsSection'
import useMobileEntryEditLeaveGuard from './useMobileEntryEditLeaveGuard'
import useMobileEntryImages from './useMobileEntryImages'

const ENTRY_LOOKUP_LIMIT = 1000

interface Props {
    push: (page: MobilePage) => void
    pop: () => void
    navigateToTab: (tab: 'home' | 'ai' | 'ideas' | 'settings', page?: MobilePage) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    params: MobileEntryEditChildPageParams
}

function relationDirectionLabel(direction: 'outgoing' | 'incoming' | 'two_way'): string {
    if (direction === 'incoming') return '来自对方'
    if (direction === 'two_way') return '双向'
    return '指向对方'
}

export default function MobileEntryProperties({push, pop, navigateToTab, setBeforeLeave, params}: Props) {
    const {projectId, entryId, isPlaceholder} = params
    const draft = useMobileEntryEditDraft(projectId, entryId)
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [tagSchemas, setTagSchemas] = useState<TagSchema[]>([])
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [loading, setLoading] = useState(true)
    /*
     * 新建类型 / 新建标签走独立页面（输入型重操作不进浮层），
     * 新建结果通过 token 回递（见 stores/mobileEditorHandoff）。
     * token 每个页面实例固定一个，用 useState 的惰性初值保证不随 render 变。
     */
    const [typeResultToken] = useState(() => createMobileEditorToken('entryProperties:type'))
    const [tagResultToken] = useState(() => createMobileEditorToken('entryProperties:tag'))
    const [imageAddPropsToken] = useState(() => createMobileEditorToken('entryProperties:imageAdd'))

    const openImageAdd = useCallback(() => {
        push({type: 'entryImageAdd', params: {propsToken: imageAddPropsToken, displayName: '添加图片'}})
    }, [imageAddPropsToken, push])

    useMobileEntryEditLeaveGuard({projectId, entryId, isPlaceholder, setBeforeLeave})

    useEffect(() => {
        let disposed = false
        setLoading(true)
        Promise.all([
            db_list_all_entry_types(projectId),
            db_list_tag_schemas(projectId),
            db_list_entries({projectId, limit: ENTRY_LOOKUP_LIMIT, offset: 0}),
        ]).then(([nextTypes, nextSchemas, nextEntries]) => {
            if (disposed) return
            setEntryTypes(nextTypes)
            setTagSchemas(nextSchemas)
            setEntries(nextEntries)
        }).catch(error => {
            logger.error('加载移动端词条属性失败', error)
        }).finally(() => {
            if (!disposed) setLoading(false)
        })
        return () => { disposed = true }
    }, [projectId])

    const updateDraft = useCallback((patch: Parameters<typeof updateMobileEntryEditDraft>[2]) => {
        updateMobileEntryEditDraft(projectId, entryId, patch)
    }, [entryId, projectId])

    const setImages = useCallback<Dispatch<SetStateAction<EntryImage[]>>>(next => {
        updateDraft(current => ({
            ...current,
            images: typeof next === 'function' ? next(current.images) : next,
        }))
    }, [updateDraft])

    const imageActions = useMobileEntryImages({projectId, images: draft?.images ?? [], setImages, onOpenImageAdd: openImageAdd})
    const handleTagDraftChange = useCallback((nextTags: TagValueMap) => {
        updateDraft({tagDraft: nextTags})
    }, [updateDraft])
    const entryTags = useEntryTags({
        tagSchemas,
        draftTags: draft?.tagDraft ?? {},
        draftType: draft?.entryType ?? null,
        entryId,
        onTagsChange: handleTagDraftChange,
    })

    const entryTitleById = useMemo(() => new Map(entries.map(entry => [entry.id, entry.title])), [entries])

    const handleTypeCreated = useCallback(async (created: CustomEntryType) => {
        try {
            setEntryTypes(await db_list_all_entry_types(projectId))
        } catch (error) {
            logger.error('刷新词条类型失败', error)
        }
        updateDraft({entryType: created.id})
    }, [projectId, updateDraft])

    const handleTagSchemaSaved = useCallback((schema: TagSchema) => {
        setTagSchemas(entryTags.handleTagSchemaSaved(schema))
    }, [entryTags])

    useProvideMobilePageProps<MobileEntryImageAddBridgedProps>(imageAddPropsToken, {
        projectId,
        entryTitle: draft?.title || null,
        entrySummary: draft?.summary || null,
        entryType: draft?.entryType ?? null,
        existingImages: draft?.images ?? [],
        onUploadLocal: imageActions.handleUploadImages,
        onCapturePhoto: imageActions.handleCaptureImage,
        onAddAiImages: imageActions.handleAddAiImages,
        onOpenPluginManagement: () => navigateToTab('settings', {type: 'settingsPlugins'}),
        onOpenAiSettings: pluginId => navigateToTab('settings', {type: 'settingsAi', params: {pluginId}}),
    })

    useMobileEditorResult<CustomEntryType>(typeResultToken, created => void handleTypeCreated(created))
    useMobileEditorResult<TagSchema>(tagResultToken, handleTagSchemaSaved)

    if (!draft) {
        return <div className="mobile-page__error" role="alert"><span>编辑会话已结束，请返回词条重新进入编辑。</span><Button type="button" size="sm" variant="outline" onClick={pop}>返回</Button></div>
    }

    return (
        <div className="mobile-page mobile-entry-properties">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="词条属性操作"
                left={<MobileTopActionPill actions={[{key: 'back', label: '返回编辑', icon: <MobileBackIcon/>, onClick: pop}]}/>}
                center={<div className="mobile-entry-detail__edit-heading"><span>词条属性</span><small>{draft.title || '未命名词条'}</small></div>}
            />

            {loading && <div className="mobile-page__loading">加载属性…</div>}
            {!loading && (
                <div className="mobile-entry-properties__content">
                    <section className="mobile-entry-properties__group mobile-entry-properties__group--types">
                        <div className="mobile-entry-properties__label"><span>词条类型</span><button type="button" onClick={() => push({type: 'typeEditor', params: {projectId, resultToken: typeResultToken, displayName: '新建词条类型'}})}><MobileAddIcon className="mobile-top-control-svg--inline"/>新建类型</button></div>
                        <div className="mobile-entry-detail__type-options">
                            <button type="button" aria-pressed={draft.entryType === null} className={`mobile-entry-detail__type-option${draft.entryType === null ? ' is-active' : ''}`} onClick={() => updateDraft({entryType: null})}>不设置</button>
                            {entryTypes.map(type => {
                                const key = entryTypeKey(type)
                                return <button type="button" key={key} aria-pressed={draft.entryType === key} className={`mobile-entry-detail__type-option${draft.entryType === key ? ' is-active' : ''}`} onClick={() => updateDraft({entryType: key})}>{type.name}</button>
                            })}
                        </div>
                    </section>

                    <section className="mobile-entry-properties__group mobile-entry-properties__group--images">
                        <div className="mobile-entry-properties__label"><span>图片</span><small>{draft.images.length} 张</small></div>
                        <MobileEntryImagesSection images={draft.images} onAddImage={imageActions.openImageAdd} onOpenImage={imageActions.openImage}/>
                    </section>

                    <section className="mobile-entry-properties__group mobile-entry-properties__group--tags">
                        <div className="mobile-entry-properties__label"><span>标签</span><button type="button" onClick={() => push({type: 'tagEditor', params: {projectId, resultToken: tagResultToken, displayName: '新建标签'}})}><MobileAddIcon className="mobile-top-control-svg--inline"/>新建标签</button></div>
                        <MobileEntryTagsSection
                            hasTagDefinitions={entryTags.localTagSchemas.length > 0}
                            availableTagSchemaOptions={entryTags.availableTagSchemaOptions}
                            tagSchemaPickerValue={entryTags.tagSchemaPickerValue}
                            editTagSchemas={entryTags.visibleTagSchemas}
                            implantedTagSchemaIdSet={entryTags.implantedTagSchemaIdSet}
                            tagDraft={draft.tagDraft}
                            onAddVisibleTagSchema={entryTags.handleAddVisibleTagSchema}
                            onTagDraftChange={next => updateDraft(current => ({...current, tagDraft: typeof next === 'function' ? next(current.tagDraft) : next}))}
                        />
                    </section>

                    <section className="mobile-entry-properties__group mobile-entry-properties__group--relations">
                        <div className="mobile-entry-properties__label"><span>词条关系</span><small>{draft.relationDrafts.length} 条</small></div>
                        <div className="mobile-entry-properties__relation-list">
                            {draft.relationDrafts.map((relation, index) => (
                                <button type="button" key={relation.id ?? `relation-${index}`} className="mobile-entry-properties__relation-row" onClick={() => push({type: 'entryRelation', params: {projectId, entryId, relationIndex: index, displayName: draft.title, isPlaceholder}})}>
                                    <span><strong>{relation.otherEntryId ? (entryTitleById.get(relation.otherEntryId) ?? '载入中的词条') : '未选择目标'}</strong><small>{relationDirectionLabel(relation.direction)}{relation.content ? ` · ${relation.content}` : ''}</small></span>
                                    <span aria-hidden="true">›</span>
                                </button>
                            ))}
                        </div>
                        <button type="button" className="mobile-entry-properties__add-row" onClick={() => push({type: 'entryRelation', params: {projectId, entryId, displayName: draft.title, isPlaceholder}})}><MobileAddIcon className="mobile-top-control-svg--inline"/>添加关系</button>
                    </section>
                </div>
            )}

            <MobileImageViewer open={imageActions.lightboxOpen} images={draft.images} currentIndex={imageActions.lightboxIndex} title={draft.title || '未命名词条'} mode="manage" onClose={() => imageActions.setLightboxOpen(false)} onIndexChange={imageActions.setLightboxIndex} onSetCover={imageActions.handleSetCover} onRemove={imageActions.handleRemoveImage} onRemoveMany={imageActions.handleRemoveImages} onAddImage={() => { imageActions.setLightboxOpen(false); imageActions.openImageAdd() }}/>
        </div>
    )
}
