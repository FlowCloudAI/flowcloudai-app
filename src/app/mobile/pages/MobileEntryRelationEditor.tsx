/** 移动端关系编辑页：以搜索列表、方向分段和关系说明替代桌面关系表单的纵向压缩版。 */
import {useCallback, useEffect, useMemo, useState} from 'react'
import {Button, Input, useAlert} from 'flowcloudai-ui'
import {db_list_categories, db_list_entries, type Category, type EntryBrief} from '../../../api'
import type {EntryRelationDraftDirection} from '../../../features/project-editor/components/EntryRelations/EntryRelationCreator'
import {logger} from '../../../shared/logger'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import {
    getMobileEntryEditDraft,
    updateMobileEntryEditDraft,
    useMobileEntryEditDraft,
} from '../stores/mobileEntryEditDraftStore'
import type {MobileEntryRelationPageParams} from '../usePageStack'
import useMobileEntryEditLeaveGuard from './useMobileEntryEditLeaveGuard'

const ENTRY_LOOKUP_LIMIT = 1000
/** 搜索结果一次最多渲染的条数；超出时提示继续输入，不静默截断。 */
const SEARCH_RESULT_LIMIT = 12

interface Props {
    pop: () => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    params: MobileEntryRelationPageParams
}

const DIRECTIONS: Array<{value: EntryRelationDraftDirection; label: string}> = [
    {value: 'outgoing', label: '指向对方'},
    {value: 'incoming', label: '来自对方'},
    {value: 'two_way', label: '双向'},
]

function categoryName(categories: Category[], categoryId: string | null | undefined): string {
    if (!categoryId) return '未分类'
    return categories.find(category => category.id === categoryId)?.name ?? '未分类'
}

export default function MobileEntryRelationEditor({pop, setBeforeLeave, params}: Props) {
    const {projectId, entryId, isPlaceholder} = params
    const initialSession = getMobileEntryEditDraft(projectId, entryId)
    const [relationIndex] = useState(() => params.relationIndex ?? initialSession?.relationDrafts.length ?? 0)
    const isNewRelation = params.relationIndex === undefined
    const draft = useMobileEntryEditDraft(projectId, entryId)
    const [entries, setEntries] = useState<EntryBrief[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [search, setSearch] = useState('')
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!isNewRelation) return
        updateMobileEntryEditDraft(projectId, entryId, current => {
            if (current.relationDrafts[relationIndex]) return current
            return {
                ...current,
                relationDrafts: [...current.relationDrafts, {
                    otherEntryId: null,
                    direction: 'outgoing',
                    content: '',
                }],
            }
        })
    }, [entryId, isNewRelation, projectId, relationIndex])

    useEffect(() => {
        let disposed = false
        Promise.all([
            db_list_entries({projectId, limit: ENTRY_LOOKUP_LIMIT, offset: 0}),
            db_list_categories(projectId),
        ]).then(([nextEntries, nextCategories]) => {
            if (disposed) return
            setEntries(nextEntries)
            setCategories(nextCategories)
        }).catch(error => logger.error('加载关系目标词条失败', error))
        return () => { disposed = true }
    }, [projectId])

    const currentRelation = draft?.relationDrafts[relationIndex] ?? null
    const cleanupBlankRelation = useCallback(() => {
        updateMobileEntryEditDraft(projectId, entryId, current => {
            const target = current.relationDrafts[relationIndex]
            if (!target || target.otherEntryId || target.content.trim()) return current
            return {
                ...current,
                relationDrafts: current.relationDrafts.filter((_, index) => index !== relationIndex),
            }
        })
    }, [entryId, projectId, relationIndex])

    useMobileEntryEditLeaveGuard({projectId, entryId, isPlaceholder, setBeforeLeave, beforeBack: cleanupBlankRelation})

    const updateRelation = useCallback((patch: Partial<NonNullable<typeof currentRelation>>) => {
        updateMobileEntryEditDraft(projectId, entryId, current => ({
            ...current,
            relationDrafts: current.relationDrafts.map((relation, index) => (
                index === relationIndex ? {...relation, ...patch} : relation
            )),
        }))
    }, [entryId, projectId, relationIndex])

    const matchedEntries = useMemo(() => {
        const normalized = search.trim().toLocaleLowerCase()
        return entries
            .filter(entry => entry.id !== entryId)
            .filter(entry => !normalized || entry.title.toLocaleLowerCase().includes(normalized))
    }, [entries, entryId, search])
    const filteredEntries = useMemo(() => matchedEntries.slice(0, SEARCH_RESULT_LIMIT), [matchedEntries])
    const hiddenMatchCount = matchedEntries.length - filteredEntries.length

    const handleBack = useCallback(() => {
        cleanupBlankRelation()
        pop()
    }, [cleanupBlankRelation, pop])

    const handleDelete = useCallback(async () => {
        const result = await showAlert('确定删除这条关系吗？', 'warning', 'confirm')
        if (result !== 'yes') return
        updateMobileEntryEditDraft(projectId, entryId, current => ({
            ...current,
            relationDrafts: current.relationDrafts.filter((_, index) => index !== relationIndex),
        }))
        pop()
    }, [entryId, pop, projectId, relationIndex, showAlert])

    if (draft && !currentRelation && isNewRelation) {
        return <div className="mobile-page__loading">准备关系草稿…</div>
    }

    if (!draft || !currentRelation) {
        return <div className="mobile-page__error" role="alert"><span>关系草稿不可用，请返回词条属性页重试。</span><Button type="button" size="sm" variant="outline" onClick={pop}>返回</Button></div>
    }

    const selectedEntry = entries.find(entry => entry.id === currentRelation.otherEntryId)
    // 刚新建、既没选目标也没写说明的关系，退出等于放弃，不该叫「删除」。
    const isBlankNewRelation = isNewRelation && !currentRelation.otherEntryId && !currentRelation.content.trim()

    return (
        <div className="mobile-page mobile-entry-relation-editor">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="编辑关系操作"
                left={<MobileTopActionPill actions={[{key: 'back', label: '返回属性', icon: <MobileBackIcon/>, onClick: handleBack}]}/>}
                center={<div className="mobile-entry-detail__edit-heading"><span>编辑关系</span><small>{draft.title || '未命名词条'}{selectedEntry ? ` → ${selectedEntry.title}` : ''}</small></div>}
            />

            <div className="mobile-entry-relation-editor__content">
                <section className="mobile-entry-properties__group">
                    <div className="mobile-entry-properties__label"><span>目标词条</span><small>项目内 {Math.max(0, entries.length - 1)} 条</small></div>
                    <Input value={search} onValueChange={setSearch} placeholder="搜索词条标题" className="mobile-entry-relation-editor__search"/>
                    <div className="mobile-entry-relation-editor__results">
                        {filteredEntries.map(entry => {
                            const selected = entry.id === currentRelation.otherEntryId
                            return (
                                <button type="button" key={entry.id} aria-pressed={selected} className={`mobile-entry-relation-editor__result${selected ? ' is-selected' : ''}`} onClick={() => updateRelation({otherEntryId: entry.id})}>
                                    <span><strong>{entry.title}</strong><small>{categoryName(categories, entry.category_id)}</small></span>
                                    <span>{selected ? '已选择' : '选择'}</span>
                                </button>
                            )
                        })}
                        {filteredEntries.length === 0 && <div className="mobile-page__empty">没有匹配词条</div>}
                        {hiddenMatchCount > 0 && (
                            <div className="mobile-entry-relation-editor__result-more">还有 {hiddenMatchCount} 条匹配，继续输入以缩小范围</div>
                        )}
                    </div>
                </section>

                <section className="mobile-entry-properties__group">
                    <div className="mobile-entry-properties__label"><span>关系方向</span></div>
                    <div className="mobile-entry-relation-editor__directions" role="group" aria-label="关系方向">
                        {DIRECTIONS.map(direction => (
                            <button type="button" key={direction.value} aria-pressed={currentRelation.direction === direction.value} onClick={() => updateRelation({direction: direction.value})}>{direction.label}</button>
                        ))}
                    </div>
                </section>

                <section className="mobile-entry-properties__group">
                    <div className="mobile-entry-properties__label"><span>关系说明</span><small>选填</small></div>
                    <Input value={currentRelation.content} onValueChange={value => updateRelation({content: value})} placeholder="例如：师徒、同伴、敌对"/>
                </section>

                {isBlankNewRelation ? (
                    <button type="button" className="mobile-entry-relation-editor__discard" onClick={handleBack}>放弃这条关系</button>
                ) : (
                    <button type="button" className="mobile-entry-relation-editor__delete" onClick={() => void handleDelete()}>删除这条关系</button>
                )}
            </div>
        </div>
    )
}
