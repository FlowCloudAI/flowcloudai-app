import {openFileDialog} from '../../../../api/dialog'
import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useState} from 'react'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_fill_image_prompt,
    ai_list_plugins,
    ai_text_to_image,
    db_list_entries,
    ErrorCode,
    formatApiError,
    type EntryBrief,
    type ImageData,
    import_entry_images,
    import_remote_images,
    type PluginInfo,
    setting_has_api_key,
    toApiError,
} from '../../../../api'
import type {EntryImage} from '../../../entries/lib/entryImage'
import {toEntryImageSrc} from '../../../entries/lib/entryImage'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../../../shared/ui/AiPluginMissingOverlay'
import FloatingPanel from '../../../../shared/ui/overlay/FloatingPanel'
import '../../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectCoverPickerModal.css'

type Tab = 'existing' | 'local' | 'ai'
type GenerateState = 'idle' | 'generating' | 'success' | 'error'

interface CoverLibraryItem {
    key: string
    entryId: string
    entryTitle: string
    image: EntryImage
    src: string
}

export interface ProjectCoverPickerFormProps {
    /** 浮层用它做打开时重置；独立页面每次挂载都是新的，固定传 true。 */
    open: boolean
    projectId: string
    projectName?: string | null
    currentCoverPath?: string | null
    aiPluginId?: string | null
    aiModel?: string | null
    onClose: () => void
    onSelectCover: (coverPath: string | null) => Promise<void> | void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenAiSettings?: (pluginId: string) => void
    /** 应用中状态回传给外壳：浮层据此禁用点背板关闭，页面据此禁用返回。 */
    onBusyChange?: (busy: boolean) => void
}

function extractEntryCoverImage(entry: EntryBrief): CoverLibraryItem | null {
    if (!entry.cover) return null
    const image: EntryImage = {
        path: entry.cover,
        is_cover: true,
    }
    const src = toEntryImageSrc(image)
    if (!src) return null

    return {
        key: `${entry.id}:${entry.cover}`,
        entryId: entry.id,
        entryTitle: entry.title ?? '未命名词条',
        image,
        src,
    }
}

/**
 * 项目封面选择的表单本体，不含浮层/页面外壳。
 * 桌面端包在 FloatingPanel 里（本文件默认导出），移动端包在独立页面里
 * （见 app/mobile/pages/MobileProjectCoverPicker）——AI 提示词是输入型重操作。
 */
export function ProjectCoverPickerForm({
                                                    open,
                                                    projectId,
                                                    projectName = null,
                                                    currentCoverPath,
                                                    aiPluginId = null,
                                                    aiModel = null,
                                                    onClose,
                                                    onSelectCover,
                                                    onOpenPluginManagement,
                                                    onOpenAiSettings,
                                                    onBusyChange,
                                                }: ProjectCoverPickerFormProps) {
    const [activeTab, setActiveTab] = useState<Tab>('existing')
    const [loadingLibrary, setLoadingLibrary] = useState(false)
    const [libraryItems, setLibraryItems] = useState<CoverLibraryItem[]>([])
    const [libraryQuery, setLibraryQuery] = useState('')
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [pluginsLoaded, setPluginsLoaded] = useState(false)
    const [pluginLoadError, setPluginLoadError] = useState('')
    const [selectedPlugin, setSelectedPlugin] = useState('')
    const [selectedModel, setSelectedModel] = useState('')
    const [selectedSize, setSelectedSize] = useState('')
    const [prompt, setPrompt] = useState('')
    const [fillingPrompt, setFillingPrompt] = useState(false)
    const [generateState, setGenerateState] = useState<GenerateState>('idle')
    const [results, setResults] = useState<ImageData[]>([])
    const [selectedResultIndex, setSelectedResultIndex] = useState(0)
    const [errorMessage, setErrorMessage] = useState('')
    const [missingApiKeyPluginId, setMissingApiKeyPluginId] = useState('')
    const [applying, setApplying] = useState(false)

    useEffect(() => {
        onBusyChange?.(applying)
    }, [applying, onBusyChange])
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!open) return

        let cancelled = false
        setActiveTab('existing')
        setLoadingLibrary(true)
        setLibraryItems([])
        setLibraryQuery('')
        setPlugins([])
        setPluginsLoaded(false)
        setPluginLoadError('')
        setSelectedPlugin('')
        setSelectedModel('')
        setSelectedSize('')
        setPrompt('')
        setFillingPrompt(false)
        setGenerateState('idle')
        setResults([])
        setSelectedResultIndex(0)
        setErrorMessage('')
        setMissingApiKeyPluginId('')
        setApplying(false)

        void (async () => {
            try {
                const [briefs, imagePlugins] = await Promise.all([
                    db_list_entries({projectId, limit: 1000, offset: 0}),
                    ai_list_plugins('image'),
                ])
                if (cancelled) return

                setPlugins(imagePlugins)
                setPluginsLoaded(true)
                if (imagePlugins.length === 0) {
                    setActiveTab('ai')
                }
                const defaultPlugin = imagePlugins[0]
                setSelectedPlugin(defaultPlugin?.id ?? '')
                setSelectedModel(defaultPlugin?.default_model ?? defaultPlugin?.models[0] ?? '')
                setSelectedSize(defaultPlugin?.supported_sizes[0] ?? '')

                const images = briefs
                    .map(extractEntryCoverImage)
                    .filter((item): item is CoverLibraryItem => Boolean(item))
                setLibraryItems(images)
            } catch (error) {
                if (!cancelled) {
                    setPluginsLoaded(true)
                    const message = formatApiError(toApiError(error))
                    setPluginLoadError(message)
                    setErrorMessage(message)
                    void showAlert(message, 'error', 'nonInvasive', 3000)
                }
            } finally {
                if (!cancelled) {
                    setLoadingLibrary(false)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [open, projectId, showAlert])

    const selectedPluginInfo = useMemo(
        () => plugins.find((plugin) => plugin.id === selectedPlugin) ?? null,
        [plugins, selectedPlugin],
    )

    useEffect(() => {
        if (!selectedPluginInfo) return
        setSelectedModel((current) => (
            current && selectedPluginInfo.models.includes(current)
                ? current
                : selectedPluginInfo.default_model || selectedPluginInfo.models[0] || ''
        ))
        setSelectedSize((current) => (
            current && selectedPluginInfo.supported_sizes.includes(current)
                ? current
                : selectedPluginInfo.supported_sizes[0] || ''
        ))
    }, [selectedPluginInfo])

    const filteredLibraryItems = useMemo(() => {
        const keyword = libraryQuery.trim().toLowerCase()
        if (!keyword) return libraryItems
        return libraryItems.filter((item) => {
            const title = item.entryTitle.toLowerCase()
            const alt = String(item.image.alt ?? '').toLowerCase()
            const caption = String(item.image.caption ?? '').toLowerCase()
            return title.includes(keyword) || alt.includes(keyword) || caption.includes(keyword)
        })
    }, [libraryItems, libraryQuery])

    const canGenerate = useMemo(
        () => prompt.trim().length > 0 && selectedPlugin.length > 0 && selectedModel.length > 0,
        [prompt, selectedPlugin, selectedModel],
    )

    const handleApplyCover = async (coverPath: string | null) => {
        if (applying) return
        setApplying(true)
        try {
            await onSelectCover(coverPath)
            onClose()
        } catch (error) {
            const message = formatApiError(toApiError(error))
            void showAlert(message, 'error', 'nonInvasive', 3000)
        } finally {
            setApplying(false)
        }
    }

    const handleLocalUpload = async () => {
        try {
            const selected = await openFileDialog({
                multiple: false,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                }],
            })
            const paths = selected ? [String(selected)] : []
            if (!paths.length) return

            const importedImages = await import_entry_images(projectId, paths)
            const firstImage = importedImages[0]
            if (!firstImage?.path) {
                throw new Error('导入图片后未获得有效路径')
            }
            await handleApplyCover(firstImage.path)
        } catch (error) {
            const message = formatApiError(toApiError(error))
            void showAlert(message, 'error', 'nonInvasive', 3000)
        }
    }

    const handleGenerate = async () => {
        if (!canGenerate) return

        setGenerateState('generating')
        setErrorMessage('')
        setMissingApiKeyPluginId('')
        try {
            if (!await setting_has_api_key(selectedPlugin)) {
                const message = `${selectedPluginInfo?.name ?? selectedPlugin} 未配置访问密钥`
                setMissingApiKeyPluginId(selectedPlugin)
                setErrorMessage(message)
                setGenerateState('error')
                void showAlert(message, 'warning', 'nonInvasive', 2200)
                return
            }
            const images = await ai_text_to_image({
                pluginId: selectedPlugin,
                model: selectedModel,
                prompt: prompt.trim(),
                size: selectedSize || null,
            })
            setResults(images)
            setSelectedResultIndex(0)
            setGenerateState('success')
        } catch (error) {
            const apiError = toApiError(error)
            const message = formatApiError(apiError)
            if (apiError.code === ErrorCode.AuthApiKeyMissing) {
                setMissingApiKeyPluginId(selectedPlugin)
            }
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'nonInvasive', 3000)
        }
    }

    const handleFillPrompt = async () => {
        if (fillingPrompt || generateState === 'generating' || applying) return
        if (!aiPluginId) {
            void showAlert('当前还没有可用的 AI 对话插件，请先在 AI 面板选择或配置模型。', 'warning', 'nonInvasive', 2200)
            return
        }

        setFillingPrompt(true)
        setErrorMessage('')
        setMissingApiKeyPluginId('')
        try {
            const result = await ai_fill_image_prompt({
                pluginId: aiPluginId,
                model: aiModel || null,
                currentPrompt: prompt.trim() || null,
                usage: 'project_cover',
                projectName,
            })
            setPrompt(result.prompt)
            void showAlert('已填充绘图提示词', 'success', 'nonInvasive', 1500)
        } catch (error) {
            const apiError = toApiError(error)
            const message = formatApiError(apiError)
            if (apiError.code === ErrorCode.AuthApiKeyMissing) {
                setMissingApiKeyPluginId(aiPluginId)
            }
            setErrorMessage(message)
            void showAlert(message, 'error', 'nonInvasive', 3000)
        } finally {
            setFillingPrompt(false)
        }
    }

    const handleAddAiCover = async () => {
        const target = results[selectedResultIndex]
        if (!target?.url) return

        try {
            const importedImages = await import_remote_images(projectId, [target.url])
            const firstImage = importedImages[0]
            if (!firstImage?.path) {
                throw new Error('下载图片后未获得有效路径')
            }
            await handleApplyCover(firstImage.path)
        } catch (error) {
            const message = formatApiError(toApiError(error))
            setErrorMessage(message)
            setGenerateState('error')
            void showAlert(message, 'error', 'nonInvasive', 3000)
        }
    }

    const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void handleGenerate()
        }
    }

    const handleOpenPluginManagement = () => {
        onClose()
        onOpenPluginManagement?.('image')
    }

    const handleOpenAiSettings = () => {
        if (!missingApiKeyPluginId) return
        onClose()
        onOpenAiSettings?.(missingApiKeyPluginId)
    }

    return (
        <>
                <div className="pe-cover-picker__tabs">
                    {([
                        {key: 'existing', label: '词条图片'},
                        {key: 'local', label: '本地上传'},
                        {key: 'ai', label: 'AI 生成'},
                    ] as Array<{ key: Tab; label: string }>).map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className={`pe-cover-picker__tab${activeTab === tab.key ? ' active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === 'existing' && (
                    <div className="pe-cover-picker__toolbar">
                        <input
                            className="pe-cover-picker__search"
                            value={libraryQuery}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setLibraryQuery(event.target.value)}
                            placeholder="按词条标题或图片说明筛选"
                        />
                        <span className="pe-cover-picker__count">共 {filteredLibraryItems.length} 张</span>
                    </div>
                )}

                <div className="pe-cover-picker__body">
                    {activeTab === 'existing' && (
                        <div className="pe-cover-picker__panel">
                            {loadingLibrary ? (
                                <div className="pe-cover-picker__empty">正在加载词条图片…</div>
                            ) : filteredLibraryItems.length === 0 ? (
                                <div className="pe-cover-picker__empty">当前项目还没有可用图片。</div>
                            ) : (
                                <div className="pe-cover-picker__grid">
                                    {filteredLibraryItems.map((item) => {
                                        const isCurrent = item.image.path === currentCoverPath
                                        return (
                                            <button
                                                key={item.key}
                                                type="button"
                                                className={`pe-cover-picker__card${isCurrent ? ' is-current' : ''}`}
                                                onClick={() => void handleApplyCover(item.image.path ?? null)}
                                                disabled={applying}
                                            >
                                                <img
                                                    src={item.src}
                                                    alt={item.image.alt || item.entryTitle}
                                                    className="pe-cover-picker__card-image"
                                                />
                                                <span className="pe-cover-picker__card-body">
                                                    <span
                                                        className="pe-cover-picker__card-title">{item.entryTitle}</span>
                                                    <span className="pe-cover-picker__card-meta">
                                                        {item.image.alt || item.image.caption || '词条图片'}
                                                    </span>
                                                    {isCurrent && (
                                                        <span className="pe-cover-picker__card-badge">当前封面</span>
                                                    )}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'local' && (
                        <div className="pe-cover-picker__panel pe-cover-picker__panel--center">
                            <p className="pe-cover-picker__hint">
                                从本地文件系统导入一张图片，导入后会直接设为项目封面。
                            </p>
                            <Button type="button" size="sm" radius="full" onClick={() => void handleLocalUpload()} disabled={applying}>
                                选择本地图片
                            </Button>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="pe-cover-picker__panel pe-cover-picker__panel--ai">
                            {pluginLoadError ? (
                                <div className="pe-cover-picker__error">读取生图所需数据失败：{pluginLoadError}</div>
                            ) : pluginsLoaded && plugins.length === 0 ? (
                                <AiPluginMissingOverlay
                                    kind="image"
                                    variant="panel"
                                    onOpenPluginManagement={handleOpenPluginManagement}
                                />
                            ) : (
                                <>
                            <div className="pe-cover-picker__field-row">
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">插件</label>
                                    <Select
                                        value={selectedPlugin}
                                        onValueChange={(value) => {
                                            setSelectedPlugin(value ? String(value) : '')
                                            setMissingApiKeyPluginId('')
                                        }}
                                        placeholder="选择插件"
                                        options={plugins.map((plugin) => ({value: plugin.id, label: plugin.name}))}
                                    />
                                </div>
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">模型</label>
                                    <Select
                                        value={selectedModel}
                                        onValueChange={(value) => setSelectedModel(value ? String(value) : '')}
                                        placeholder="选择模型"
                                        options={selectedPluginInfo?.models.map((model) => ({
                                            value: model,
                                            label: model
                                        })) ?? []}
                                    />
                                </div>
                                <div className="pe-cover-picker__field">
                                    <label className="pe-cover-picker__label">尺寸</label>
                                    <Select
                                        value={selectedSize}
                                        onValueChange={(value) => setSelectedSize(value ? String(value) : '')}
                                        placeholder="选择尺寸"
                                        options={selectedPluginInfo?.supported_sizes.map((size) => ({
                                            value: size,
                                            label: size
                                        })) ?? []}
                                        disabled={!selectedPluginInfo || selectedPluginInfo.supported_sizes.length === 0}
                                    />
                                </div>
                            </div>
                            {selectedPluginInfo && selectedPluginInfo.supported_sizes.length === 0 && (
                                <span className="pe-cover-picker__hint">当前插件未声明可选尺寸，将使用模型默认尺寸。</span>
                            )}

                            <div className="pe-cover-picker__field">
                                <label className="pe-cover-picker__label">画面描述</label>
                                <textarea
                                    className="pe-cover-picker__textarea"
                                    value={prompt}
                                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
                                    onKeyDown={handlePromptKeyDown}
                                    placeholder="描述你想要生成的图像内容…"
                                    rows={3}
                                    disabled={generateState === 'generating' || fillingPrompt || applying}
                                />
                                <span className="pe-cover-picker__hint">按 Ctrl / Cmd + Enter 可直接生成。</span>
                            </div>

                            <div className="pe-cover-picker__actions">
                                <Button type="button"
                                    size="sm"
                                    radius="full"
                                    onClick={() => void handleFillPrompt()}
                                    disabled={fillingPrompt || generateState === 'generating' || applying}
                                >
                                    {fillingPrompt ? '填充中…' : 'AI 填充描述'}
                                </Button>
                                <Button type="button"
                                    size="sm"
                                    radius="full"
                                    onClick={() => void handleGenerate()}
                                    disabled={!canGenerate || generateState === 'generating' || fillingPrompt || applying}
                                >
                                    {generateState === 'generating' ? '生成中…' : '开始生成'}
                                </Button>
                            </div>

                            {generateState === 'error' && (
                                <div className="pe-cover-picker__error" role="alert">
                                    <span>生成失败：{errorMessage}</span>
                                    {missingApiKeyPluginId && onOpenAiSettings && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            radius="full"
                                            variant="ghost"
                                            className="pe-cover-picker__error-action"
                                            onClick={handleOpenAiSettings}
                                        >
                                            去配置
                                        </Button>
                                    )}
                                </div>
                            )}

                            {results.length > 0 && (
                                <div className="pe-cover-picker__result-section">
                                    <div className="pe-cover-picker__results-header">
                                        <span className="pe-cover-picker__results-title">生成结果</span>
                                        <span className="pe-cover-picker__results-count">共 {results.length} 张</span>
                                    </div>
                                    <div className="pe-cover-picker__results-grid">
                                        {results.map((image, index) => (
                                            <button
                                                key={`${image.url ?? index}`}
                                                type="button"
                                                className={`pe-cover-picker__result-card${selectedResultIndex === index ? ' is-selected' : ''}`}
                                                onClick={() => setSelectedResultIndex(index)}
                                                disabled={!image.url || applying}
                                            >
                                                {image.url ? (
                                                    <img
                                                        src={image.url}
                                                        alt={`AI 生成结果 ${index + 1}`}
                                                        className="pe-cover-picker__result-image"
                                                    />
                                                ) : (
                                                    <div className="pe-cover-picker__result-placeholder">无法显示图片</div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="pe-cover-picker__results-footer">
                                        <Button type="button"
                                            size="sm"
                                            radius="full"
                                            variant="primary"
                                            onClick={() => void handleAddAiCover()}
                                            disabled={!results[selectedResultIndex]?.url || applying}
                                        >
                                            导入并设为封面
                                        </Button>
                                    </div>
                                </div>
                            )}
                                </>
                            )}
                        </div>
                    )}
                </div>
        </>
    )
}

/** 桌面端的浮层外壳。表单本体见 ProjectCoverPickerForm。 */
export default function ProjectCoverPickerModal(props: ProjectCoverPickerFormProps) {
    const [busy, setBusy] = useState(false)
    return (
        <FloatingPanel
            open={props.open}
            onClose={props.onClose}
            dismissible={!busy}
            title={(
                <div className="pe-cover-picker__heading">
                    <span className="pe-cover-picker__title fc-section-title">设置项目封面</span>
                    <span className="pe-cover-picker__desc">可以从已有词条图片中选择，也可以上传或 AI 生成。</span>
                </div>
            )}
            className="pe-cover-picker-dialog"
        >
            <ProjectCoverPickerForm {...props} onBusyChange={setBusy}/>
        </FloatingPanel>
    )
}
