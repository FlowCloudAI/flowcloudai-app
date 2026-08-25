/** 移动端词条编辑主页：身份与附件位于正文之前，正文聚焦时两者平滑折叠。 */
import {type ComponentProps, type MouseEvent as ReactMouseEvent, type RefObject, useState} from 'react'
import {Input, Select} from 'flowcloudai-ui'
import {MarkdownEditor, type MarkdownEditorRef} from '../../../features/entries/components/MarkdownEditor/MarkdownEditor'
import EntryImageAddModal from '../../../features/entries/components/EntryImageAddModal'
import {type EntryImage} from '../../../features/entries/lib/entryImage'
import {
    MobilePageTopBar,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import MobileImageViewer from '../components/MobileImageViewer'
import {MobileEntryImmersiveEditor} from './MobileEntryImmersiveEditor'
import {MobileEntryDetailActionIcon} from './MobileEntryDetailActionIcon'
import {MobileEntryImagesSection} from './MobileEntryImagesSection'
import {MOBILE_MARKDOWN_TOOLS, type MobileMarkdownTool} from './MobileEntryMarkdownToolModel'
import {MobileMarkdownToolIcon} from './MobileEntryMarkdownTools'

export type MobileWikiDraft = {start: number; end: number; query: string}
export type MobileWikiOption = {kind: 'entry'; id: string; title: string; categoryId: string | null} | {kind: 'create'; title: string}

type MarkdownTextareaProps = NonNullable<ComponentProps<typeof MarkdownEditor>['textareaProps']>

interface Props {
    saving: boolean
    isDirty: boolean
    error: string | null
    onCancel: () => void
    onSave: () => void
    title: string
    onTitle: (value: string) => void
    summary: string
    onSummary: (value: string) => void
    entryTypeValue: string
    entryTypeOptions: Array<{value: string; label: string}>
    onEntryType: (value: string) => void
    categoryValue: string
    categoryOptions: Array<{value: string; label: string}>
    onCategory: (value: string) => void
    content: string
    previewContent: string
    onContentChange: (value: string) => void
    editorRef: RefObject<MarkdownEditorRef | null>
    textareaProps: MarkdownTextareaProps
    onMarkdownTool: (tool: MobileMarkdownTool) => void
    /** 内联预览里的链接点击。缺了它 WebView 会直接导航到 fc:// 并把应用换成错误页。 */
    onPreviewMarkdownClick: (event: ReactMouseEvent<HTMLDivElement>) => void
    tagCount: number
    imageCount: number
    relationCount: number
    images: EntryImage[]
    onAddImage: () => void
    onOpenImage: (index: number) => void
    onOpenProperties: () => void
    immersiveOpen: boolean
    onOpenImmersive: () => void
    wikiDraft: MobileWikiDraft | null
    wikiOptions: MobileWikiOption[]
    activeWikiIndex: number
    categoryNameById: Map<string, string>
    creatingLinkedEntry: boolean
    onWikiIndex: (index: number) => void
    onWikiCommit: (option: MobileWikiOption) => void
    immersiveProps: Omit<ComponentProps<typeof MobileEntryImmersiveEditor>, 'wikiPanel'>
    imageViewerProps: ComponentProps<typeof MobileImageViewer>
    imageAddProps: ComponentProps<typeof EntryImageAddModal>
}

export default function MobileEntryDetailEditView({editorRef, immersiveProps, imageViewerProps, imageAddProps, ...p}: Props) {
    const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>('edit')
    const [bodyFocused, setBodyFocused] = useState(false)
    const wikiPanel = p.wikiDraft ? (
        <div className="mobile-entry-detail__wiki-panel" role="listbox" aria-label="词条链接候选">
            <div className="mobile-entry-detail__wiki-panel-title">插入词条链接</div>
            {p.wikiOptions.length > 0 ? (
                <div className="mobile-entry-detail__wiki-options">
                    {p.wikiOptions.map((option, index) => {
                        const active = index === p.activeWikiIndex
                        const creating = option.kind === 'create'
                        const categoryName = option.kind === 'entry' && option.categoryId
                            ? p.categoryNameById.get(option.categoryId)
                            : null
                        return (
                            <button
                                type="button"
                                key={option.kind === 'entry' ? `entry-${option.id}` : `create-${option.title}`}
                                role="option"
                                aria-selected={active}
                                className={`mobile-entry-detail__wiki-option${active ? ' is-active' : ''}${creating ? ' mobile-entry-detail__wiki-option--create' : ''}`}
                                disabled={creating && p.creatingLinkedEntry}
                                onMouseDown={event => event.preventDefault()}
                                onMouseEnter={() => p.onWikiIndex(index)}
                                onFocus={() => p.onWikiIndex(index)}
                                onClick={() => p.onWikiCommit(option)}
                            >
                                <span className="mobile-entry-detail__wiki-option-title">{option.kind === 'entry' ? option.title : `创建「${option.title}」`}</span>
                                <span className="mobile-entry-detail__wiki-option-meta">{option.kind === 'entry' ? (categoryName ?? '未分类') : (p.creatingLinkedEntry ? '创建中…' : '新词条')}</span>
                            </button>
                        )
                    })}
                </div>
            ) : <div className="mobile-entry-detail__wiki-empty">没有匹配词条</div>}
        </div>
    ) : null

    const inlineTextareaProps: MarkdownTextareaProps = {
        ...p.textareaProps,
        onFocus: event => {
            setBodyFocused(true)
            p.textareaProps.onFocus?.(event)
        },
        onBlur: event => {
            setBodyFocused(false)
            p.textareaProps.onBlur?.(event)
        },
    }
    return (
        <div
            className="mobile-page mobile-nav-safe-fixed mobile-entry-detail mobile-entry-detail--edit"
            data-mobile-editing="true"
            data-immersive-open={p.immersiveOpen || undefined}
            data-body-focused={bodyFocused || undefined}
            inert={p.immersiveOpen}
        >
            <MobilePageTopBar
                className="mobile-entry-detail__edit-topbar"
                sticky
                edgeToEdge
                ariaLabel="词条编辑操作"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'cancel',
                        label: '取消编辑',
                        icon: <span className="mobile-top-action-pill__text">取消</span>,
                        kind: 'text',
                        disabled: p.saving,
                        onClick: p.onCancel,
                    }]}
                />}
                center={<div className="mobile-entry-detail__edit-heading">
                    <span>{bodyFocused ? (p.title || '未命名词条') : '编辑词条'}</span>
                    <small>{p.saving ? '保存中…' : p.isDirty ? '有未保存修改' : '已同步'}</small>
                </div>}
                right={<MobileTopActionPill
                    actions={[{
                        key: 'save',
                        label: p.saving ? '保存中' : '保存词条',
                        icon: <span className="mobile-top-action-pill__text">{p.saving ? '保存中…' : '保存'}</span>,
                        kind: 'text',
                        disabled: p.saving,
                        onClick: p.onSave,
                    }]}
                />}
            />

            {p.error && <div className="mobile-page__error-banner" role="alert"><span>{p.error}</span></div>}

            <div className="mobile-entry-detail__edit-meta">
                <div className="mobile-entry-detail__edit-meta-inner">
                    <section className="mobile-entry-detail__identity" aria-label="词条身份">
                        <div className="mobile-entry-detail__identity-inner">
                            <Input placeholder="未命名词条" value={p.title} onValueChange={p.onTitle} className="mobile-entry-detail__title-input"/>
                            <div className="mobile-entry-detail__identity-selects">
                                <Select value={p.entryTypeValue} onValueChange={value => p.onEntryType(String(value ?? ''))} options={p.entryTypeOptions} placeholder="词条类型" className="mobile-entry-detail__identity-select"/>
                                <Select value={p.categoryValue} onValueChange={value => p.onCategory(String(value ?? ''))} options={p.categoryOptions} placeholder="所属分类" className="mobile-entry-detail__identity-select"/>
                            </div>
                            <div className="mobile-entry-detail__field-heading"><span>摘要</span><small>{p.summary.length} 字</small></div>
                            <textarea placeholder="用一两句话概括词条" value={p.summary} onChange={event => p.onSummary(event.target.value)} className="mobile-entry-detail__summary-input" rows={3}/>
                        </div>
                    </section>

                    <section className="mobile-entry-detail__attachments" aria-label="词条附件与属性">
                        <MobileEntryImagesSection images={p.images} onAddImage={p.onAddImage} onOpenImage={p.onOpenImage} addFirst compact/>
                        <button type="button" className="mobile-entry-detail__properties-entry" onClick={p.onOpenProperties} aria-label="打开词条属性页">
                            <span className="mobile-entry-detail__properties-chips">
                                <span className="mobile-entry-detail__property-pill">{p.tagCount} 标签</span>
                                <span className="mobile-entry-detail__property-pill">{p.relationCount} 关系</span>
                                <span className="mobile-entry-detail__property-pill">{p.imageCount} 图片</span>
                            </span>
                            <span className="mobile-entry-detail__properties-more">属性 ›</span>
                        </button>
                    </section>
                </div>
            </div>

            <section className="mobile-entry-detail__body-pane" aria-label="正文">
                <div className="mobile-entry-detail__body-head">
                    <span className="mobile-entry-detail__body-label">正文</span>
                    <span className="mobile-entry-detail__body-count">{p.content.trim().length.toLocaleString()} 字</span>
                    <span className="mobile-entry-detail__body-spacer"/>
                    <div className="mobile-entry-detail__body-mode" role="group" aria-label="正文显示方式">
                        <button type="button" aria-pressed={bodyMode === 'edit'} onClick={() => setBodyMode('edit')}>编辑</button>
                        <button type="button" aria-pressed={bodyMode === 'preview'} onClick={() => { setBodyFocused(false); setBodyMode('preview') }}>预览</button>
                    </div>
                    <button type="button" className="mobile-entry-detail__expand-button" aria-label="全屏专注编辑" title="全屏专注编辑" onClick={p.onOpenImmersive}><MobileEntryDetailActionIcon type="expand"/></button>
                </div>
                <div className="mobile-entry-detail__inline-editor-wrap" onClick={p.onPreviewMarkdownClick}>
                    <MarkdownEditor
                        ref={editorRef}
                        value={p.content}
                        previewValue={p.previewContent}
                        onValueChange={p.onContentChange}
                        mode={bodyMode}
                        placeholder="正文内容…输入 [[ 插入词条双链"
                        autoHeight={false}
                        height="100%"
                        minHeight={120}
                        hideToolbar
                        hideFullscreen
                        showSplitToggle={false}
                        textareaProps={inlineTextareaProps}
                        tokens={{
                            background: 'transparent',
                            toolbarBackground: 'transparent',
                            borderColor: 'transparent',
                            editorTextBackground: 'transparent',
                            previewBackground: 'transparent',
                            textColor: 'var(--fc-color-text)',
                            mutedTextColor: 'var(--fc-color-text-secondary)',
                        }}
                        className="mobile-entry-detail__inline-editor"
                    />
                    {wikiPanel}
                </div>
            </section>

            <div className="mobile-entry-detail__markdown-toolbar mobile-entry-detail__markdown-toolbar--inline" role="toolbar" aria-label="Markdown 常用工具" data-mobile-horizontal-scroll="true">
                {MOBILE_MARKDOWN_TOOLS.map(item => (
                    <button key={item.tool} type="button" className="mobile-entry-detail__markdown-tool" aria-label={item.label} title={item.label} onMouseDown={event => event.preventDefault()} onClick={() => p.onMarkdownTool(item.tool)}>
                        <MobileMarkdownToolIcon tool={item.tool}/>
                    </button>
                ))}
            </div>

            {p.immersiveOpen && <MobileEntryImmersiveEditor {...immersiveProps} wikiPanel={wikiPanel}/>}
            <MobileImageViewer {...imageViewerProps}/>
            <EntryImageAddModal {...imageAddProps}/>
        </div>
    )
}
