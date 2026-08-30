import {logger} from '../../../shared/logger'
import {type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Select, useAlert} from 'flowcloudai-ui'
import {
    ai_fill_image_prompt,
    ai_list_plugins,
    ai_text_to_image,
    ErrorCode,
    formatApiError,
    type FCImage,
    type ImageData,
    import_remote_images,
    type PluginInfo,
    setting_has_api_key,
    toApiError,
} from '../../../api'
import {buildEntryImageMarkdownRef, type EntryImage, toEntryImageSrc} from '../lib/entryImage'
import AiPluginMissingOverlay, {type AiMissingPluginKind} from '../../../shared/ui/AiPluginMissingOverlay'
import {FloatingPanel} from '../../../shared/ui/overlay'
import './EntryImageAddModal.css'

type Tab = 'existing' | 'local' | 'ai'
type GenerateState = 'idle' | 'generating' | 'success' | 'error'
type ModalMode = 'add' | 'insert'

export interface EntryImageAddFormProps {
    /** 浮层用它做打开时重置；独立页面每次挂载都是新的，固定传 true。 */
    open: boolean
    projectId: string
    projectName?: string | null
    entryTitle?: string | null
    entrySummary?: string | null
    entryType?: string | null
    aiPluginId?: string | null
    aiModel?: string | null
    mode?: ModalMode
    existingImages?: EntryImage[]
    onClose: () => void
    onUploadLocal: () => void | EntryImage[] | Promise<void | EntryImage[]>
    onCapturePhoto?: () => void | EntryImage[] | Promise<void | EntryImage[]>
    onAddAiImages: (images: EntryImage[]) => void
    onInsertImage?: (image: EntryImage) => void
    onOpenPluginManagement?: (kind: AiMissingPluginKind) => void
    onOpenAiSettings?: (pluginId: string) => void
    /** 提交中状态回传给外壳：浮层据此禁用点背板关闭，页面据此禁用返回。 */
    onBusyChange?: (busy: boolean) => void
}

/**
 * 添加图片的表单本体，不含浮层/页面外壳。
 * 桌面端包在 FloatingPanel 里（本文件默认导出），移动端包在独立页面里
 * （见 app/mobile/pages/MobileEntryImageAdd）——AI 提示词是输入型重操作。
 */
export function EntryImageAddForm({
                                               open,
                                               projectId,
                                               projectName = null,
                                               entryTitle = null,
                                               entrySummary = null,
                                               entryType = null,
                                               aiPluginId = null,
                                               aiModel = null,
                                               mode = 'add',
                                               existingImages = [],
                                               onClose,
                                               onUploadLocal,
                                               onCapturePhoto,
                                               onAddAiImages,
                                               onInsertImage,
                                               onOpenPluginManagement,
                                               onOpenAiSettings,
                                               onBusyChange,
                                           }: EntryImageAddFormProps) {
    const insertMode = mode === 'insert'
    const [activeTab, setActiveTab] = useState<Tab>(insertMode ? 'existing' : 'local')

    // ── AI 生成相关状态 ──
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
    const [errorMessage, setErrorMessage] = useState('')
    const [missingApiKeyPluginId, setMissingApiKeyPluginId] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const [submitSource, setSubmitSource] = useState<'local' | 'camera' | null>(null)
    const submittingRef = useRef(false)

    useEffect(() => {
        onBusyChange?.(submitting)
    }, [onBusyChange, submitting])
    const {showAlert} = useAlert()

    useEffect(() => {
        if (!open) return
        queueMicrotask(() => {
            setActiveTab(insertMode ? 'existing' : 'local')
            setPrompt('')
            setFillingPrompt(false)
            setGenerateState('idle')
            setResults([])
            setErrorMessage('')
            setMissingApiKeyPluginId('')
            setSubmitting(false)
            setSubmitSource(null)
            submittingRef.current = false
            setPlugins([])
            setPluginLoadError('')
            setSelectedPlugin('')
            setSelectedModel('')
            setSelectedSize('')
            setPluginsLoaded(false)
        })

        ai_list_plugins('image')
            .then((data) => {
                setPlugins(data)
                setPluginsLoaded(true)
                if (data.length > 0) {
                    queueMicrotask(() => {
                        setSelectedPlugin(data[0].id)
                    })
                }
            })
            .catch((err) => {
                logger.error('[EntryImageAddModal] 插件加载失败:', err)
                setPluginLoadError(formatApiError(toApiError(err)))
                setPluginsLoaded(true)
            })
    }, [open, insertMode])

    useEffect(() => {
        const plugin = plugins.find((p) => p.id === selectedPlugin)
        if (plugin) {
            const defaultModel = plugin.default_model ?? plugin.models[0] ?? ''
            const defaultSize = plugin.supported_sizes[0] ?? ''
            queueMicrotask(() => {
                setSelectedModel(defaultModel)
                setSelectedSize(defaultSize)
            })
        } else {
            queueMicrotask(() => {
                setSelectedModel('')
                setSelectedSize('')
            })
        }
    }, [selectedPlugin, plugins])

    const selectedPluginInfo = useMemo(
        () => plugins.find((p) => p.id === selectedPlugin),
        [plugins, selectedPlugin]
    )

    const canGenerate = useMemo(() => {
        return prompt.trim().length > 0 && selectedPlugin.length > 0 && selectedModel.length > 0
    }, [prompt, selectedPlugin, selectedModel])

    const handleFillPrompt = async () => {
        if (fillingPrompt || generateState === 'generating' || submittingRef.current) return
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
                usage: 'entry_image',
                projectName,
                entryTitle,
                entrySummary,
                entryType,
            })
            setPrompt(result.prompt)
            void showAlert('已填充绘图提示词', 'success', 'nonInvasive', 1500)
        } catch (error) {
            const apiError = toApiError(error)
            const msg = formatApiError(apiError)
            if (apiError.code === ErrorCode.AuthApiKeyMissing) {
                setMissingApiKeyPluginId(aiPluginId)
            }
            setErrorMessage(msg)
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        } finally {
            setFillingPrompt(false)
        }
    }

    const handleGenerate = async () => {
        if (!canGenerate || submittingRef.current) return

        setGenerateState('generating')
        setErrorMessage('')
        setMissingApiKeyPluginId('')

        try {
            if (!await setting_has_api_key(selectedPlugin)) {
                const msg = `${selectedPluginInfo?.name ?? selectedPlugin} 未配置访问密钥`
                setMissingApiKeyPluginId(selectedPlugin)
                setErrorMessage(msg)
                setGenerateState('error')
                void showAlert(msg, 'warning', 'nonInvasive', 2200)
                return
            }
            const images = await ai_text_to_image({
                pluginId: selectedPlugin,
                model: selectedModel,
                prompt: prompt.trim(),
                size: selectedSize || null,
            })
            setResults(images)
            setGenerateState('success')
        } catch (e) {
            const apiError = toApiError(e)
            const msg = formatApiError(apiError)
            if (apiError.code === ErrorCode.AuthApiKeyMissing) {
                setMissingApiKeyPluginId(selectedPlugin)
            }
            setErrorMessage(msg)
            setGenerateState('error')
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void handleGenerate()
        }
    }

    const handleAddToEntry = async () => {
        if (results.length === 0 || submittingRef.current) return
        submittingRef.current = true
        setSubmitting(true)

        try {
            const remoteUrls = results
                .filter((img) => img.url)
                .map((img) => img.url!)

            const localImages: FCImage[] = await import_remote_images(projectId, remoteUrls)

            const entryImages: EntryImage[] = localImages.map((img: FCImage) => ({
                ...img,
                path: img.path,
                url: null,
                alt: prompt.trim().slice(0, 50),
                is_cover: false,
            }))

            onAddAiImages(entryImages)
            if (insertMode && entryImages[0]) {
                onInsertImage?.(entryImages[0])
            }
            onClose()
        } catch (e) {
            const msg = formatApiError(toApiError(e))
            setErrorMessage(`下载图片失败: ${msg}`)
            setGenerateState('error')
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        } finally {
            submittingRef.current = false
            setSubmitting(false)
        }
    }

    const handleLocalUpload = async () => {
        if (submittingRef.current) return
        submittingRef.current = true
        setSubmitSource('local')
        setSubmitting(true)
        try {
            const uploadedImages = await onUploadLocal()
            if (insertMode && Array.isArray(uploadedImages) && uploadedImages[0]) {
                onInsertImage?.(uploadedImages[0])
            }
            onClose()
        } catch (e) {
            const msg = formatApiError(toApiError(e))
            setErrorMessage(`上传图片失败: ${msg}`)
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        } finally {
            submittingRef.current = false
            setSubmitting(false)
            setSubmitSource(null)
        }
    }

    const handleCapturePhoto = async () => {
        if (!onCapturePhoto || submittingRef.current) return
        submittingRef.current = true
        setSubmitSource('camera')
        setSubmitting(true)
        try {
            const capturedImages = await onCapturePhoto()
            if (!Array.isArray(capturedImages) || !capturedImages[0]) return
            if (insertMode) {
                onInsertImage?.(capturedImages[0])
            }
            onClose()
        } catch (e) {
            const msg = formatApiError(toApiError(e))
            setErrorMessage(`拍照失败: ${msg}`)
            void showAlert(msg, 'error', 'nonInvasive', 3000)
        } finally {
            submittingRef.current = false
            setSubmitting(false)
            setSubmitSource(null)
        }
    }

    const handleInsertExisting = (image: EntryImage) => {
        if (!buildEntryImageMarkdownRef(image)) {
            void showAlert('当前图片没有可插入的 uuid 引用。', 'warning', 'nonInvasive', 1800)
            return
        }
        onInsertImage?.(image)
        onClose()
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
            <div className="entry-image-add-tabs">
                    {insertMode && (
                        <button
                            type="button"
                            className={`entry-image-add-tab${activeTab === 'existing' ? ' active' : ''}`}
                            disabled={submitting}
                            onClick={() => setActiveTab('existing')}
                        >
                            设定集
                        </button>
                    )}
                    <button
                        type="button"
                        className={`entry-image-add-tab${activeTab === 'local' ? ' active' : ''}`}
                        disabled={submitting}
                        onClick={() => setActiveTab('local')}
                    >
                        本地上传
                    </button>
                    <button
                        type="button"
                        className={`entry-image-add-tab${activeTab === 'ai' ? ' active' : ''}`}
                        disabled={submitting}
                        onClick={() => setActiveTab('ai')}
                    >
                        AI 生成
                    </button>
                </div>

                <div className="entry-image-add-body">
                    {activeTab === 'existing' ? (
                        <div className="entry-image-add-existing">
                            {existingImages.length > 0 ? (
                                <div className="entry-image-add-existing__grid">
                                    {existingImages.map((image, index) => {
                                        const src = toEntryImageSrc(image)
                                        const canInsert = Boolean(buildEntryImageMarkdownRef(image))
                                        return (
                                            <button
                                                key={`${image.path ?? image.url ?? index}`}
                                                type="button"
                                                className="entry-image-add-existing__item"
                                                onClick={() => handleInsertExisting(image)}
                                                disabled={!canInsert}
                                            >
                                                <div className="entry-image-add-existing__media">
                                                    {src ? (
                                                        <img src={src} alt={image.alt || image.caption || `图片 ${index + 1}`}/>
                                                    ) : (
                                                        <span>无预览</span>
                                                    )}
                                                </div>
                                                <div className="entry-image-add-existing__meta">
                                                    <span>{image.alt || image.caption || `图片 ${index + 1}`}</span>
                                                    {!canInsert && <small>缺少 uuid 引用</small>}
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="entry-image-add-existing__empty">
                                    当前设定集还没有图片，可上传本地图片或使用 AI 生成后插入。
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'local' ? (
                        <div className="entry-image-add-local">
                            <p className="entry-image-add-local-desc">
                                {onCapturePhoto
                                    ? '选择本地图片，或调用系统相机拍摄一张照片。支持 PNG、JPG、JPEG、GIF、WebP、BMP 格式。'
                                    : '从本地文件系统选择图片文件，支持 PNG、JPG、JPEG、GIF、WebP、BMP 格式。'}
                            </p>
                            <div className="entry-image-add-local-actions">
                                <Button type="button" size="sm" radius="full" disabled={submitting} onClick={handleLocalUpload}>
                                    {submitting && submitSource === 'local' ? '导入中…' : '选择本地图片'}
                                </Button>
                                {onCapturePhoto && (
                                    <Button type="button" size="sm" radius="full" variant="outline" disabled={submitting} onClick={handleCapturePhoto}>
                                        {submitting && submitSource === 'camera' ? '处理中…' : '拍照'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="entry-image-add-ai">
                            {pluginLoadError ? (
                                <div className="entry-image-add-ai__error">
                                    读取 AI 绘图插件失败：{pluginLoadError}
                                </div>
                            ) : pluginsLoaded && plugins.length === 0 ? (
                                <AiPluginMissingOverlay
                                    kind="image"
                                    variant="panel"
                                    onOpenPluginManagement={handleOpenPluginManagement}
                                />
                            ) : (
                                <>
                            <div className="entry-image-add-ai__field-row">
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">插件</label>
                                    <Select
                                        className="entry-image-add-ai__select"
                                        value={selectedPlugin}
                                        disabled={submitting}
                                        onValueChange={(v) => {
                                            setSelectedPlugin(String(v))
                                            setMissingApiKeyPluginId('')
                                        }}
                                        placeholder="选择插件"
                                        options={plugins.map((p) => ({value: p.id, label: p.name}))}
                                    />
                                </div>
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">模型</label>
                                    <Select
                                        className="entry-image-add-ai__select"
                                        value={selectedModel}
                                        disabled={submitting}
                                        onValueChange={(v) => setSelectedModel(String(v))}
                                        placeholder="选择模型"
                                        options={selectedPluginInfo?.models.map((m) => ({value: m, label: m})) ?? []}
                                    />
                                </div>
                                <div className="entry-image-add-ai__field">
                                    <label className="entry-image-add-ai__label">尺寸</label>
                                    <Select
                                        className="entry-image-add-ai__select"
                                        value={selectedSize}
                                        onValueChange={(v) => setSelectedSize(String(v))}
                                        placeholder="选择尺寸"
                                        options={selectedPluginInfo?.supported_sizes.map((size) => ({
                                            value: size,
                                            label: size
                                        })) ?? []}
                                        disabled={submitting || !selectedPluginInfo || selectedPluginInfo.supported_sizes.length === 0}
                                    />
                                </div>
                            </div>
                            {selectedPluginInfo && selectedPluginInfo.supported_sizes.length === 0 && (
                                <span
                                    className="entry-image-add-ai__hint">当前插件未声明可选尺寸，将使用模型默认尺寸。</span>
                            )}

                            <div className="entry-image-add-ai__field">
                                <label className="entry-image-add-ai__label">画面描述</label>
                                <textarea
                                    className="entry-image-add-ai__textarea"
                                    value={prompt}
                                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="描述你想要生成的图像内容…"
                                    rows={3}
                                    disabled={submitting || generateState === 'generating' || fillingPrompt}
                                />
                                <span className="entry-image-add-ai__hint">按 Cmd / Ctrl + Enter 快速生成</span>
                            </div>

                            <div className="entry-image-add-ai__actions">
                                <Button type="button"
                                    size="sm"
                                    radius="full"
                                    disabled={submitting || fillingPrompt || generateState === 'generating'}
                                    onClick={() => void handleFillPrompt()}
                                >
                                    {fillingPrompt ? '填充中…' : 'AI 填充描述'}
                                </Button>
                                <Button type="button"
                                    size="sm"
                                    radius="full"
                                    disabled={submitting || !canGenerate || generateState === 'generating' || fillingPrompt}
                                    onClick={() => void handleGenerate()}
                                >
                                    {generateState === 'generating' ? '生成中…' : '开始生成'}
                                </Button>
                            </div>

                            {generateState === 'error' && (
                                <div className="entry-image-add-ai__error" role="alert">
                                    <span>生成失败：{errorMessage}</span>
                                    {missingApiKeyPluginId && onOpenAiSettings && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            radius="full"
                                            variant="ghost"
                                            className="entry-image-add-ai__error-action"
                                            onClick={handleOpenAiSettings}
                                        >
                                            去配置
                                        </Button>
                                    )}
                                </div>
                            )}

                            {results.length > 0 && (
                                <div className="entry-image-add-ai__results">
                                    <div className="entry-image-add-ai__results-header">
                                        <span className="entry-image-add-ai__results-title">生成结果</span>
                                        <span
                                            className="entry-image-add-ai__results-count">共 {results.length} 张</span>
                                    </div>
                                    <div className="entry-image-add-ai__result-grid">
                                        {results.map((img, idx) => (
                                            <div key={`${img.url ?? idx}`} className="entry-image-add-ai__result-card">
                                                {img.url ? (
                                                    <img
                                                        src={img.url}
                                                        alt={`生成结果 ${idx + 1}`}
                                                        className="entry-image-add-ai__result-image"
                                                    />
                                                ) : (
                                                    <div className="entry-image-add-ai__result-placeholder">
                                                        无法显示图片
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="entry-image-add-ai__results-footer">
                                        <Button type="button"
                                            size="sm"
                                            radius="full"
                                            variant="primary"
                                            disabled={submitting}
                                            onClick={handleAddToEntry}
                                        >
                                            {submitting ? '添加中…' : insertMode ? '添加并插入' : '添加到词条'}
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

/** 桌面端的浮层外壳。表单本体见 EntryImageAddForm。 */
export default function EntryImageAddModal(props: EntryImageAddFormProps) {
    const [busy, setBusy] = useState(false)
    return (
        <FloatingPanel
            open={props.open}
            onClose={props.onClose}
            dismissible={!busy}
            title={props.mode === 'insert' ? '插入图片' : '添加图片'}
            ariaLabel="添加图片"
            className="entry-image-add-dialog"
        >
            <EntryImageAddForm {...props} onBusyChange={setBusy}/>
        </FloatingPanel>
    )
}
