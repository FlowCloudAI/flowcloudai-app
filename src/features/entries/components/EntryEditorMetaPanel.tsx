import {type CSSProperties, useState} from 'react'
import {Button, Select} from 'flowcloudai-ui'
import type {Category, Entry, EntryTypeView, PluginInfo, TagSchema} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import HighLightTagItem from './HighLightTagItem'
import EntryTypeIcon from '../../project-editor/components/EntryTypeIcon'
import {
    buildEntryPath,
    formatDate,
    getCategoryName,
    normalizeComparableText,
    normalizeComparableType,
} from '../lib/entryCommon'
import {getComparableTagValue} from '../lib/entryTag'
import type {EntryImage} from '../lib/entryImage'
import {getCoverImage, toEntryImageSrc} from '../lib/entryImage'
import {
    CHARACTER_VOICE_AUTO_PLAY_TAG,
    CHARACTER_VOICE_AUTO_PLAY_TAG_ID,
    CHARACTER_VOICE_ID_TAG,
    CHARACTER_VOICE_ID_TAG_ID,
    CHARACTER_VOICE_MODEL_TAG,
    CHARACTER_VOICE_MODEL_TAG_ID,
    CHARACTER_VOICE_PLUGIN_ID_TAG,
    CHARACTER_VOICE_PLUGIN_ID_TAG_ID,
    readCharacterVoiceConfigFromDraftTags,
    writeCharacterVoiceDraftTag,
} from '../lib/characterVoice'
import {buildTtsVoiceOptions, resolvePreferredTtsPlugin} from '../../plugins/ttsVoice'

interface EntryEditorMetaPanelProps {
    showTitle?: boolean
    entryId: string
    entry: Entry | null
    draft: {
        title: string
        summary: string
        content: string
        type: string | null
        categoryId: string | null
        tags: Record<string, string | number | boolean | null>
        images: EntryImage[]
    }
    status: {
        editorMode: 'edit' | 'browse'
        loading: boolean
        saving: boolean
        generatingSummary: boolean
    }
    projectContext: {
        projectName: string
        categories: Category[]
        entryTypes: EntryTypeView[]
    }
    tagUi: {
        localTagSchemas: TagSchema[]
        visibleTagSchemas: TagSchema[]
        browseVisibleTagSchemas: TagSchema[]
        implantedTagSchemaIdSet: Set<string>
        availableTagSchemaOptions: { value: string; label: string }[]
        tagSchemaPickerValue: string | undefined
    }
    ttsVoice: {
        plugins: PluginInfo[]
        defaultPluginId: string | null
        defaultModel: string | null
        hint: string
    }
    actions: {
        onDraftChange: (updater: (prev: EntryEditorMetaPanelProps['draft']) => EntryEditorMetaPanelProps['draft']) => void
        onOpenImageAddModal: () => void
        onViewImageSet: () => void
        onGenerateSummary: () => void
        onAddVisibleTagSchema: (schemaId: string) => void
        onRemoveVisibleTagSchema: (schema: TagSchema) => void
        onOpenTagCreator: () => void
    }
}

export default function EntryEditorMetaPanel({
                                                 showTitle = true,
                                                 entryId,
                                                 entry,
                                                 draft,
                                                 status,
                                                 projectContext,
                                                 tagUi,
                                                 ttsVoice,
                                                 actions,
                                             }: EntryEditorMetaPanelProps) {
    const {editorMode, loading, saving, generatingSummary} = status
    const {projectName, categories, entryTypes} = projectContext
    const {
        localTagSchemas,
        visibleTagSchemas,
        browseVisibleTagSchemas,
        implantedTagSchemaIdSet,
        availableTagSchemaOptions,
        tagSchemaPickerValue,
    } = tagUi
    const {
        plugins: ttsPlugins,
        defaultPluginId: defaultTtsPluginId,
        defaultModel: defaultTtsModel,
        hint: ttsVoiceHint,
    } = ttsVoice
    const {
        onDraftChange,
        onOpenImageAddModal,
        onViewImageSet,
        onGenerateSummary,
        onAddVisibleTagSchema,
        onRemoveVisibleTagSchema,
        onOpenTagCreator,
    } = actions
    const [voicePanelOpen, setVoicePanelOpen] = useState(false)
    const isBrowseMode = editorMode === 'browse'
    const trimmedTitle = normalizeComparableText(draft.title)
    const trimmedSummary = normalizeComparableText(draft.summary)
    const infoTitle = trimmedTitle || entry?.title || '未命名词条'
    const coverImage = getCoverImage(draft.images)
    const coverSrc = toEntryImageSrc(coverImage)
    const coverHintText = isBrowseMode ? '暂无主图' : '点击添加图片'
    const entryPathLabel = buildEntryPath(projectName, categories, draft.categoryId, infoTitle)
    const entryCreatedAtText = formatDate(entry?.['created_at'] as string | null | undefined)
    const entryUpdatedAtText = formatDate(entry?.updated_at as string | null | undefined)
    const isCharacterEntry = normalizeComparableType(draft.type) === 'character'
    const characterVoiceConfig = readCharacterVoiceConfigFromDraftTags(draft.tags, localTagSchemas)
    const globalTtsPlugin = resolvePreferredTtsPlugin(ttsPlugins, defaultTtsPluginId)
    const selectedTtsPlugin = characterVoiceConfig.pluginId
        ? ttsPlugins.find((plugin) => plugin.id === characterVoiceConfig.pluginId) ?? null
        : globalTtsPlugin
    const selectedTtsModel = characterVoiceConfig.model
        && selectedTtsPlugin?.models.includes(characterVoiceConfig.model)
        ? characterVoiceConfig.model
        : (!characterVoiceConfig.pluginId
        && defaultTtsModel
        && selectedTtsPlugin?.models.includes(defaultTtsModel)
            ? defaultTtsModel
            : selectedTtsPlugin?.default_model ?? selectedTtsPlugin?.models[0] ?? '')
    const ttsPluginOptions = [
        {value: '', label: globalTtsPlugin ? `跟随全局默认 · ${globalTtsPlugin.name}` : '跟随全局默认'},
        ...ttsPlugins.map((plugin) => ({value: plugin.id, label: plugin.name})),
    ]
    const ttsModelOptions = (selectedTtsPlugin?.models ?? []).map((model) => ({value: model, label: model}))
    const ttsVoiceOptions = buildTtsVoiceOptions(selectedTtsPlugin, '使用插件默认音色')
    const ttsVoiceSelectable = Boolean(selectedTtsPlugin && selectedTtsPlugin.supported_voices.length > 0)
    const characterVoiceHint = ttsVoiceHint || (selectedTtsPlugin
        ? selectedTtsPlugin.supported_voices.length > 0
            ? `音色由「${selectedTtsPlugin.name}」提供`
            : `插件「${selectedTtsPlugin.name}」未声明可选音色`
        : '请先安装 AI 语音插件')
    const hasCharacterVoiceOverride = Boolean(
        characterVoiceConfig.pluginId
        || characterVoiceConfig.model
        || characterVoiceConfig.voiceId
        || characterVoiceConfig.autoPlay != null,
    )
    const characterVoiceSummary = hasCharacterVoiceOverride
        ? `${characterVoiceConfig.voiceId || '默认音色'} · ${selectedTtsPlugin?.name || '未配置插件'}`
        : '跟随全局设置'

    const typeOptions = entryTypes.map((entryType) => {
        const kind = entryType.kind
        const name = entryType.name
        const color = entryType.color
        const key = kind === 'builtin' ? (entryType as { key: string }).key : (entryType as { id: string }).id
        return {key, entryType: {...entryType, kind, name, color} as EntryTypeView}
    })
    const builtinTypeOptions = typeOptions.filter(({entryType}) => entryType.kind === 'builtin')
    const customTypeOptions = typeOptions
        .filter(({entryType}) => entryType.kind === 'custom')
        .map(({key, entryType}) => ({value: key, label: entryType.name}))
    const selectedCustomType = customTypeOptions.some((option) => option.value === draft.type)
    const titleInputId = `entry-editor-title-${entryId}`
    const summaryInputId = `entry-editor-summary-${entryId}`

    return (
        <div className="entry-editor-meta-layout">
            <div className="entry-editor-cover-panel">
                <button
                    type="button"
                    className={`entry-editor-cover ${coverSrc ? 'has-image' : ''}`}
                    aria-label={draft.images.length
                        ? `查看${infoTitle}的图片设定集`
                        : (isBrowseMode ? `${infoTitle}暂无主图` : `为${infoTitle}添加图片`)}
                    onClick={() => {
                        if (draft.images.length) {
                            onViewImageSet()
                        } else if (!isBrowseMode) {
                            onOpenImageAddModal()
                        }
                    }}
                >
                    {coverSrc ? (
                        <img src={coverSrc} alt={coverImage?.alt || infoTitle} className="entry-editor-cover__image"/>
                    ) : (
                        <div className="entry-editor-cover__placeholder">
                            <span className="entry-editor-cover__mark">{infoTitle[0] ?? '词'}</span>
                            <span className="entry-editor-cover__hint">{coverHintText}</span>
                        </div>
                    )}
                </button>

                <div className="entry-editor-cover__toolbar">
                    {!isBrowseMode && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            radius="full"
                            onClick={() => onOpenImageAddModal()}
                        >
                            添加图片
                        </Button>
                    )}
                    {coverImage && (
                        <Button type="button" variant="ghost" size="sm" radius="full" onClick={onViewImageSet}>
                            查看设定集
                        </Button>
                    )}
                </div>
            </div>

            <div className="entry-editor-meta-panel entry-editor-meta-panel--primary">
                {showTitle && <div className="entry-editor-meta-panel__section">
                    <label className="entry-editor-field-label" htmlFor={titleInputId}>
                        标题
                        {!isBrowseMode && (
                            <span className="entry-editor-required" aria-hidden="true"> *</span>
                        )}
                    </label>
                    {isBrowseMode ? (
                        <div className="entry-editor-readonly-title">{infoTitle}</div>
                    ) : (
                        <>
                            <input
                                id={titleInputId}
                                className={`entry-editor-title-input${trimmedTitle ? '' : ' is-missing'}`}
                                value={draft.title}
                                onChange={(event) => onDraftChange((current) => (
                                    current.title === event.target.value
                                        ? current
                                        : {...current, title: event.target.value}
                                ))}
                                placeholder="输入词条标题"
                                disabled={saving || loading}
                                autoFocus={!trimmedTitle}
                            />
                            {!trimmedTitle && (
                                <div className="entry-editor-field-hint entry-editor-field-hint--required">
                                    请填写标题，标题不能为空。
                                </div>
                            )}
                        </>
                    )}
                </div>}

                <div className="entry-editor-meta-panel__section">
                    <div className="entry-editor-field-label-row">
                        <label className="entry-editor-field-label" htmlFor={summaryInputId}>摘要</label>
                        {!isBrowseMode && (
                            <Button
                                variant="outline"
                                size="sm"
                                radius="full"
                                type="button"
                                disabled={saving || loading || generatingSummary}
                                onClick={onGenerateSummary}
                            >
                                {generatingSummary ? '总结中…' : 'AI总结'}
                            </Button>
                        )}
                    </div>
                    {isBrowseMode ? (
                        <div className={`entry-editor-readonly-summary${trimmedSummary ? '' : ' is-empty'}`}>
                            {trimmedSummary || '暂无摘要'}
                        </div>
                    ) : (
                        <textarea
                            id={summaryInputId}
                            className="entry-editor-summary-input"
                            value={draft.summary}
                            onChange={(event) => onDraftChange((current) => (
                                current.summary === event.target.value
                                    ? current
                                    : {...current, summary: event.target.value}
                            ))}
                            placeholder="用一两句话概括这个词条的核心信息"
                            rows={2}
                            disabled={saving || loading}
                        />
                    )}
                </div>

                <div
                    className={`entry-editor-meta-panel__section entry-editor-type-section${isBrowseMode ? ' is-browse' : ''}`}
                >
                    <div className="entry-editor-field-label-row">
                        <span className="entry-editor-field-label">词条类型</span>
                        {!isBrowseMode && (
                            <span className="entry-editor-field-note">类型会影响植入标签的重点显示</span>
                        )}
                    </div>
                    {isBrowseMode ? (
                        <div className="entry-editor-type-grid">
                            {draft.type ? (
                                (() => {
                                    const selectedType = typeOptions.find(({key}) => key === draft.type)
                                    return selectedType ? (
                                        <span
                                            className="entry-editor-type-chip active is-readonly"
                                            style={{'--entry-editor-chip-color': selectedType.entryType.color} as CSSProperties}
                                        >
                                            <EntryTypeIcon
                                                entryType={selectedType.entryType}
                                                className="entry-editor-type-chip__icon"
                                            />
                                            <span>{selectedType.entryType.name}</span>
                                        </span>
                                    ) : (
                                        <span className="entry-editor-type-chip is-readonly">未设置</span>
                                    )
                                })()
                            ) : (
                                <span className="entry-editor-type-chip is-readonly">未设置</span>
                            )}
                        </div>
                    ) : (
                        <div className="entry-editor-type-grid">
                            <button
                                type="button"
                                className={`entry-editor-type-chip${draft.type === null ? ' active' : ''}`}
                                aria-pressed={draft.type === null}
                                onClick={() => onDraftChange((current) => (
                                    normalizeComparableType(current.type) === null
                                        ? current
                                        : {...current, type: null}
                                ))}
                            >
                                不设置
                            </button>
                            {builtinTypeOptions.map(({key, entryType}) => (
                                <button
                                    key={key}
                                    type="button"
                                    className={`entry-editor-type-chip${draft.type === key ? ' active' : ''}`}
                                    style={{'--entry-editor-chip-color': entryType.color} as CSSProperties}
                                    aria-pressed={draft.type === key}
                                    onClick={() => onDraftChange((current) => ({
                                        ...current,
                                        type: normalizeComparableType(current.type) === key ? null : key,
                                    }))}
                                >
                                    <EntryTypeIcon entryType={entryType} className="entry-editor-type-chip__icon"/>
                                    <span>{entryType.name}</span>
                                </button>
                            ))}
                            {customTypeOptions.length > 0 && (
                                <Select
                                    className={`entry-editor-select entry-editor-more-type${selectedCustomType ? ' is-active' : ''}`}
                                    options={customTypeOptions}
                                    value={selectedCustomType ? draft.type ?? undefined : undefined}
                                    onValueChange={(value) => onDraftChange((current) => {
                                        const nextType = normalizeComparableType(typeof value === 'string' ? value : null)
                                        return normalizeComparableType(current.type) === nextType
                                            ? current
                                            : {...current, type: nextType}
                                    })}
                                    placeholder="更多类型"
                                    aria-label="选择自定义词条类型"
                                    searchable
                                />
                            )}
                        </div>
                    )}
                </div>

            </div>

            <aside className="entry-editor-auxiliary-panel" aria-labelledby={`entry-editor-auxiliary-${entryId}`}>
                <h2 id={`entry-editor-auxiliary-${entryId}`} className="entry-editor-auxiliary-title">
                    辅助信息
                </h2>
                <div className="entry-editor-auxiliary-section">
                    <span className="entry-editor-field-label">所属分类</span>
                    {isBrowseMode ? (
                        <div className="entry-editor-auxiliary-value">
                            {getCategoryName(categories, draft.categoryId)}
                        </div>
                    ) : (
                        <Select
                            className="entry-editor-select entry-editor-category-select"
                            options={[
                                {value: '', label: '无分类'},
                                ...categories.map((category) => ({value: category.id, label: category.name})),
                            ]}
                            value={draft.categoryId ?? ''}
                            onValueChange={(value) => onDraftChange((current) => {
                                const nextCategoryId = typeof value === 'string' && value ? value : null
                                return current.categoryId === nextCategoryId
                                    ? current
                                    : {...current, categoryId: nextCategoryId}
                            })}
                            placeholder="选择分类"
                            aria-label="所属分类"
                            searchable
                        />
                    )}
                </div>
                <div className="entry-editor-auxiliary-section">
                    <span className="entry-editor-field-label">系统信息</span>
                    <dl className="entry-editor-system-meta">
                        <div>
                            <dt>路径</dt>
                            <dd title={entryPathLabel}>{entryPathLabel}</dd>
                        </div>
                        <div>
                            <dt>创建</dt>
                            <dd>{entryCreatedAtText}</dd>
                        </div>
                        <div>
                            <dt>更新</dt>
                            <dd>{entryUpdatedAtText}</dd>
                        </div>
                    </dl>
                </div>
            </aside>

            <div className="entry-editor-meta-panel entry-editor-meta-panel--secondary">
                {!isBrowseMode && isCharacterEntry && (
                    <div className="entry-editor-meta-panel__section">
                        <div className="entry-editor-field-label-row">
                            <div className="entry-editor-character-voice-summary">
                                <span className="entry-editor-field-label">角色语音</span>
                                <span className="entry-editor-character-voice-summary__value">
                                    {characterVoiceSummary}
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                radius="full"
                                type="button"
                                onClick={() => setVoicePanelOpen(true)}
                            >
                                配置
                            </Button>
                        </div>
                        <FloatingPanel
                            open={voicePanelOpen}
                            onClose={() => setVoicePanelOpen(false)}
                            dismissible={!saving && !loading}
                            title="角色语音"
                            ariaLabel="配置角色语音"
                            className="entry-editor-character-voice-dialog"
                        >
                            <div className="entry-editor-character-voice">
                                <div className="entry-editor-character-voice__field">
                                    <span className="entry-editor-field-label">语音插件</span>
                                    <Select
                                        aria-label="语音插件"
                                        options={ttsPluginOptions}
                                        value={characterVoiceConfig.pluginId ?? ''}
                                        onValueChange={(value) => onDraftChange((current) => {
                                            const pluginId = value ? normalizeComparableText(String(value)) : ''
                                            const plugin = ttsPlugins.find((item) => item.id === pluginId) ?? null
                                            let nextTags = writeCharacterVoiceDraftTag(
                                                current.tags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
                                                pluginId || null,
                                            )
                                            nextTags = writeCharacterVoiceDraftTag(
                                                nextTags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_MODEL_TAG, id: CHARACTER_VOICE_MODEL_TAG_ID},
                                                plugin ? (plugin.default_model ?? plugin.models[0] ?? null) : null,
                                            )
                                            nextTags = writeCharacterVoiceDraftTag(
                                                nextTags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_ID_TAG, id: CHARACTER_VOICE_ID_TAG_ID},
                                                null,
                                            )
                                            return {...current, tags: nextTags}
                                        })}
                                        disabled={saving || loading || ttsPlugins.length === 0}
                                    />
                                </div>
                                <div className="entry-editor-character-voice__field">
                                    <span className="entry-editor-field-label">模型</span>
                                    <Select
                                        aria-label="语音模型"
                                        options={ttsModelOptions}
                                        value={selectedTtsModel}
                                        onValueChange={(value) => onDraftChange((current) => {
                                            if (!selectedTtsPlugin) return current
                                            let nextTags = writeCharacterVoiceDraftTag(
                                                current.tags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
                                                selectedTtsPlugin.id,
                                            )
                                            nextTags = writeCharacterVoiceDraftTag(
                                                nextTags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_MODEL_TAG, id: CHARACTER_VOICE_MODEL_TAG_ID},
                                                value ? normalizeComparableText(String(value)) : null,
                                            )
                                            return {...current, tags: nextTags}
                                        })}
                                        disabled={saving || loading || !selectedTtsPlugin || ttsModelOptions.length === 0}
                                    />
                                </div>
                                <div className="entry-editor-character-voice__field">
                                    <span className="entry-editor-field-label">音色</span>
                                    <Select
                                        aria-label="角色音色"
                                        options={ttsVoiceOptions}
                                        value={characterVoiceConfig.voiceId ?? ''}
                                        onValueChange={(value) => onDraftChange((current) => {
                                            const nextVoiceId = value ? normalizeComparableText(String(value)) : ''
                                            if (!selectedTtsPlugin) return current
                                            let nextTags = writeCharacterVoiceDraftTag(
                                                current.tags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_PLUGIN_ID_TAG, id: CHARACTER_VOICE_PLUGIN_ID_TAG_ID},
                                                selectedTtsPlugin.id,
                                            )
                                            nextTags = writeCharacterVoiceDraftTag(
                                                nextTags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_MODEL_TAG, id: CHARACTER_VOICE_MODEL_TAG_ID},
                                                selectedTtsModel || null,
                                            )
                                            nextTags = writeCharacterVoiceDraftTag(
                                                nextTags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_ID_TAG, id: CHARACTER_VOICE_ID_TAG_ID},
                                                nextVoiceId || null,
                                            )
                                            return {...current, tags: nextTags}
                                        })}
                                        disabled={saving || loading || !ttsVoiceSelectable}
                                    />
                                </div>
                                <div className="entry-editor-field-note">{characterVoiceHint}</div>
                                <div className="entry-editor-character-voice__field">
                                    <span className="entry-editor-field-label">自动播放</span>
                                    <Select
                                        aria-label="自动播放角色回复"
                                        options={[
                                            {value: 'inherit', label: '跟随全局设置'},
                                            {value: 'on', label: '开启'},
                                            {value: 'off', label: '关闭'},
                                        ]}
                                        value={characterVoiceConfig.autoPlay == null
                                            ? 'inherit'
                                            : (characterVoiceConfig.autoPlay ? 'on' : 'off')}
                                        onValueChange={(value) => onDraftChange((current) => ({
                                            ...current,
                                            tags: writeCharacterVoiceDraftTag(
                                                current.tags,
                                                localTagSchemas,
                                                {name: CHARACTER_VOICE_AUTO_PLAY_TAG, id: CHARACTER_VOICE_AUTO_PLAY_TAG_ID},
                                                value === 'inherit' ? null : value === 'on',
                                            ),
                                        }))}
                                        disabled={saving || loading}
                                    />
                                </div>
                            </div>
                        </FloatingPanel>
                    </div>
                )}

                <div className="entry-editor-meta-panel__section entry-editor-tags-section">
                    <div className="entry-editor-field-label-row">
                        <div className="entry-editor-tags-heading">
                            <span className="entry-editor-field-label">标签</span>
                            {!isBrowseMode && (
                                <span className="entry-editor-field-note">切换类型不会删除已有值</span>
                            )}
                        </div>
                        {!isBrowseMode && (
                            <div className="entry-editor-tag-actions">
                                {availableTagSchemaOptions.length > 0 && (
                                    <div className="entry-editor-tag-picker">
                                        <Select
                                            className="entry-editor-select"
                                            options={availableTagSchemaOptions}
                                            value={tagSchemaPickerValue}
                                            onValueChange={(value) => {
                                                if (typeof value !== 'string') return
                                                onAddVisibleTagSchema(value)
                                            }}
                                            placeholder="添加已有标签"
                                            searchable
                                        />
                                    </div>
                                )}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    radius="full"
                                    onClick={onOpenTagCreator}
                                >
                                    + 新建标签
                                </Button>
                            </div>
                        )}
                    </div>
                    {localTagSchemas.length === 0 ? (
                        <div className="entry-editor-empty-tip">当前项目还没有标签定义，先创建一个再给词条填写。</div>
                    ) : isBrowseMode ? (
                        browseVisibleTagSchemas.length > 0 ? (
                            <div className="entry-editor-tags-grid entry-editor-tags-grid--browse">
                                {browseVisibleTagSchemas.map((schema) => {
                                    const value = getComparableTagValue(draft.tags, schema)
                                    const isImplanted = implantedTagSchemaIdSet.has(schema.id)
                                    return (
                                        <div
                                            key={`${entryId}-${schema.id}`}
                                            className="entry-editor-tag-card"
                                        >
                                            <HighLightTagItem
                                                schema={{
                                                    id: schema.id,
                                                    name: schema.name,
                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                    range_min: schema.range_min ?? null,
                                                    range_max: schema.range_max ?? null,
                                                }}
                                                value={value}
                                                implanted={isImplanted}
                                                mode="show"
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="entry-editor-empty-tip">当前词条还没有标签值。</div>
                        )
                    ) : (
                        visibleTagSchemas.length > 0 ? (
                            <div className="entry-editor-tags-grid entry-editor-tags-grid--edit">
                                {visibleTagSchemas.map((schema) => {
                                    const isImplanted = implantedTagSchemaIdSet.has(schema.id)
                                    return (
                                        <div
                                            key={`${entryId}-${schema.id}`}
                                            className="entry-editor-tag-card"
                                        >
                                            <HighLightTagItem
                                                schema={{
                                                    id: schema.id,
                                                    name: schema.name,
                                                    type: schema.type as 'number' | 'string' | 'boolean',
                                                    range_min: schema.range_min ?? null,
                                                    range_max: schema.range_max ?? null,
                                                }}
                                                value={draft.tags[schema.id] ?? draft.tags[schema.name] ?? null}
                                                implanted={isImplanted}
                                                mode="edit"
                                                onRemove={isImplanted ? undefined : () => onRemoveVisibleTagSchema(schema)}
                                                onChange={(value) => onDraftChange((current) => {
                                                    const currentValue = current.tags[schema.id] ?? current.tags[schema.name] ?? null
                                                    if (currentValue === value) return current
                                                    return {
                                                        ...current,
                                                        tags: {
                                                            ...current.tags,
                                                            [schema.id]: value,
                                                        },
                                                    }
                                                })}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div
                                className="entry-editor-empty-tip">当前词条还没有已添加标签，可从已有标签中选择，或新建一个标签。</div>
                        )
                    )}
                </div>
            </div>
        </div>
    )
}
