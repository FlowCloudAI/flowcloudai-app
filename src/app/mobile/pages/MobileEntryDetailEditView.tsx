/* 移动端词条编辑视图：按内容、媒体、属性和关系的业务层级组织表单。 */
import type {ComponentProps} from 'react'
import {Input, Select} from 'flowcloudai-ui'
import type {Category, EntryTypeView} from '../../../api'
import {entryTypeKey} from '../../../api'
import EntryTypeCreator from '../../../features/entries/components/EntryTypeCreator'
import TagCreator from '../../../features/entries/components/TagCreator'
import EntryImageAddModal from '../../../features/entries/components/EntryImageAddModal'
import EntryImageLightbox from '../../../features/entries/components/EntryImageLightbox'
import {MobileAddIcon, MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {MobileEntryImmersiveEditor} from './MobileEntryImmersiveEditor'
import {MobileEntryImagesSection} from './MobileEntryImagesSection'
import {MobileEntryRelationsSection} from './MobileEntryRelationsSection'
import {MobileEntryTagsSection} from './MobileEntryTagsSection'

export type MobileWikiDraft = {start: number; end: number; query: string}
export type MobileWikiOption = {kind: 'entry'; id: string; title: string; categoryId: string | null} | {kind: 'create'; title: string}

interface Props {
    saving: boolean; isDirty: boolean; error: string | null; onCancel: () => void; onSave: () => void
    title: string; onTitle: (value: string) => void; summary: string; onSummary: (value: string) => void
    entryType: string | null; onEntryType: (value: string | null) => void; categoryId: string | null; onCategory: (value: string | null) => void
    categories: Category[]; entryTypes: EntryTypeView[]; onOpenTypeCreator: () => void
    immersiveOpen: boolean; onOpenImmersive: () => void
    wikiDraft: MobileWikiDraft | null; wikiOptions: MobileWikiOption[]; activeWikiIndex: number; categoryNameById: Map<string, string>; creatingLinkedEntry: boolean
    onWikiIndex: (index: number) => void; onWikiCommit: (option: MobileWikiOption) => void
    imagesProps: ComponentProps<typeof MobileEntryImagesSection>
    tagsProps: ComponentProps<typeof MobileEntryTagsSection>
    relationsProps: ComponentProps<typeof MobileEntryRelationsSection>
    immersiveProps: Omit<ComponentProps<typeof MobileEntryImmersiveEditor>, 'wikiPanel'>
    typeCreatorProps: ComponentProps<typeof EntryTypeCreator>
    tagCreatorProps: ComponentProps<typeof TagCreator>
    lightboxProps: ComponentProps<typeof EntryImageLightbox>
    imageAddProps: ComponentProps<typeof EntryImageAddModal>
}

export default function MobileEntryDetailEditView(p: Props) {
    const categoryOptions = [{value: '', label: '无分类'}, ...p.categories.map(category => ({value: category.id, label: category.name}))]
    const wikiPanel = p.wikiDraft ? <div className="mobile-entry-detail__wiki-panel" role="listbox" aria-label="词条链接候选">
        <div className="mobile-entry-detail__wiki-panel-title">插入词条链接</div>
        {p.wikiOptions.length > 0 ? <div className="mobile-entry-detail__wiki-options">{p.wikiOptions.map((option, index) => {
            const active = index === p.activeWikiIndex
            const creating = option.kind === 'create'
            const categoryName = option.kind === 'entry' && option.categoryId ? p.categoryNameById.get(option.categoryId) : null
            return <button type="button" key={option.kind === 'entry' ? `entry-${option.id}` : `create-${option.title}`} role="option" aria-selected={active} className={`mobile-entry-detail__wiki-option${active ? ' is-active' : ''}${creating ? ' mobile-entry-detail__wiki-option--create' : ''}`} disabled={creating && p.creatingLinkedEntry} onMouseDown={event => event.preventDefault()} onMouseEnter={() => p.onWikiIndex(index)} onFocus={() => p.onWikiIndex(index)} onClick={() => p.onWikiCommit(option)}><span className="mobile-entry-detail__wiki-option-title">{option.kind === 'entry' ? option.title : `创建「${option.title}」`}</span><span className="mobile-entry-detail__wiki-option-meta">{option.kind === 'entry' ? (categoryName ?? '未分类') : (p.creatingLinkedEntry ? '创建中…' : '新词条')}</span></button>
        })}</div> : <div className="mobile-entry-detail__wiki-empty">没有匹配词条</div>}
    </div> : null

    return <div
        className="mobile-page mobile-entry-detail mobile-entry-detail--edit"
        data-mobile-editing="true"
        data-immersive-open={p.immersiveOpen || undefined}
        inert={p.immersiveOpen}
    >
        <MobilePageTopBar className="mobile-entry-detail__edit-topbar" sticky edgeToEdge ariaLabel="词条编辑操作"
            left={<MobileTopActionPill actions={[{key: 'cancel', label: '取消编辑', icon: <MobileBackIcon/>, disabled: p.saving, onClick: p.onCancel}]}/>} center={<div className="mobile-entry-detail__edit-heading"><span>编辑词条</span><small>{p.saving ? '保存中…' : p.isDirty ? '有未保存修改' : '已同步'}</small></div>} right={<MobileTopActionPill actions={[{key: 'save', label: p.saving ? '保存中' : '保存词条', icon: <MobileEntryDetailActionIcon type={p.saving ? 'more' : 'save'}/>, kind: 'add', disabled: p.saving, onClick: p.onSave}]}/>}/>
        {p.error && <div className="mobile-page__error-banner" role="alert"><span>{p.error}</span></div>}
        <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--identity">
            <label className="mobile-entry-detail__title-field">
                <span>标题</span>
                <Input placeholder="词条标题" value={p.title} onValueChange={p.onTitle} className="mobile-entry-detail__title-input"/>
            </label>
            <label className="mobile-entry-detail__summary-field">
                <span className="mobile-entry-detail__field-heading">
                    <span>摘要</span>
                    <small>{p.summary.length} 字</small>
                </span>
                <textarea placeholder="用一两句话概括词条" value={p.summary} onChange={event => p.onSummary(event.target.value)} className="mobile-entry-detail__summary-input" rows={3}/>
            </label>
            <div className="mobile-entry-detail__type-field">
                <div className="mobile-entry-detail__field-heading">
                    <span>词条类型</span>
                    <button type="button" className="mobile-entry-detail__add-type" onClick={p.onOpenTypeCreator}>
                        <MobileAddIcon className="mobile-top-control-svg--inline"/>新建类型
                    </button>
                </div>
                <div className="mobile-entry-detail__type-options" data-mobile-horizontal-scroll="true">
                    <button type="button" aria-pressed={p.entryType === null} className={`mobile-entry-detail__type-option${p.entryType === null ? ' is-active' : ''}`} onClick={() => p.onEntryType(null)}>不设置</button>
                    {p.entryTypes.map(type => {
                        const key = entryTypeKey(type)
                        return <button type="button" key={key} aria-pressed={p.entryType === key} className={`mobile-entry-detail__type-option${p.entryType === key ? ' is-active' : ''}`} onClick={() => p.onEntryType(key)}>{type.name}</button>
                    })}
                </div>
            </div>
            <label className="mobile-entry-detail__field">
                <span>所属分类</span>
                <Select value={p.categoryId ?? ''} onValueChange={value => p.onCategory(value ? String(value) : null)} options={categoryOptions} placeholder="分类" className="mobile-entry-detail__meta-select"/>
            </label>
        </section>
        <section className="mobile-entry-detail__form-section mobile-entry-detail__form-section--content">
            <div className="mobile-entry-detail__section-header"><span>正文</span><button type="button" className="mobile-entry-detail__section-action" onClick={p.onOpenImmersive}>沉浸编辑</button></div>
        </section>
        <div className="mobile-entry-detail__edit-disclosures">
            <details className="mobile-entry-detail__edit-disclosure">
                <summary className="mobile-entry-detail__edit-disclosure-summary">
                    <strong>图片</strong>
                    <span>{p.imagesProps.images.length} 张</span>
                    <small aria-hidden="true"/>
                </summary>
                <div className="mobile-entry-detail__edit-disclosure-body">
                    <MobileEntryImagesSection {...p.imagesProps}/>
                </div>
            </details>
            <details className="mobile-entry-detail__edit-disclosure">
                <summary className="mobile-entry-detail__edit-disclosure-summary">
                    <strong>属性与标签</strong>
                    <span>{p.tagsProps.editTagSchemas.length} 项</span>
                    <small aria-hidden="true"/>
                </summary>
                <div className="mobile-entry-detail__edit-disclosure-body">
                    <MobileEntryTagsSection {...p.tagsProps}/>
                </div>
            </details>
            <details className="mobile-entry-detail__edit-disclosure">
                <summary className="mobile-entry-detail__edit-disclosure-summary">
                    <strong>词条关系</strong>
                    <span>{p.relationsProps.relationDrafts.length} 条</span>
                    <small aria-hidden="true"/>
                </summary>
                <div className="mobile-entry-detail__edit-disclosure-body">
                    <MobileEntryRelationsSection {...p.relationsProps}/>
                </div>
            </details>
        </div>
        {p.immersiveOpen && <MobileEntryImmersiveEditor {...p.immersiveProps} wikiPanel={wikiPanel}/>}<EntryTypeCreator {...p.typeCreatorProps}/><TagCreator {...p.tagCreatorProps}/><EntryImageLightbox {...p.lightboxProps}/><EntryImageAddModal {...p.imageAddProps}/>
    </div>
}
