import {Button, Input, Select, useAlert} from 'flowcloudai-ui'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {
    template_get,
    template_get_default,
    template_list,
    template_save,
    type SearchSourceSettings,
    type TemplateDocument,
    type TemplateMeta,
    type TemplateValidationError,
} from '../../../api'
import {FeedbackSection} from '../../../features/about/AboutSection'
import {logger} from '../../../shared/logger'

interface StorageProps {
    autoBackupSecs: number
    maxBackupCount: number
    onAutoBackupSecsChange: (value: number) => void
    onMaxBackupCountChange: (value: number) => void
    onSave: () => void | Promise<void>
}

interface PermissionsProps {
    writerModeEnabled: boolean
    searchEngine: string
    searchSources: SearchSourceSettings
    onWriterModeChange: (enabled: boolean) => void
    onSearchEngineChange: (value: string) => void
    onSearchSourceChange: (key: keyof SearchSourceSettings, enabled: boolean) => void
    onSave: () => void | Promise<void>
}

interface TemplatesProps {
    defaultPrompt: string
    editorFontSize: number
    onDefaultPromptChange: (value: string) => void
    onSaveSettings: () => void | Promise<void>
}

const SEARCH_SOURCE_OPTIONS: Array<{
    key: keyof SearchSourceSettings
    label: string
    hint: string
}> = [
    {key: 'wikimedia', label: '维基媒体', hint: '维基百科、维基词典、维基文库等。'},
    {key: 'technical_wiki', label: '专业参考', hint: '专业资料源。'},
    {key: 'game_wiki', label: '游戏 wiki', hint: '常用游戏资料站。'},
    {key: 'fandom_wiki', label: '作品设定 wiki', hint: '作品世界观与设定资料站。'},
    {key: 'esports_wiki', label: '电竞 wiki', hint: 'Liquipedia 等电竞资料源。'},
    {key: 'web', label: '通用网页兜底', hint: '按所选搜索引擎查询普通网页。'},
]

function clampInteger(value: string | number, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function MobileSettingsStorageSection({
    autoBackupSecs,
    maxBackupCount,
    onAutoBackupSecsChange,
    onMaxBackupCountChange,
    onSave,
}: StorageProps) {
    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">移动端存储</h2>
                <p className="mobile-settings-field-hint">
                    项目数据库、媒体、插件和备份由系统私有存储管理；移动端不开放目录迁移，避免系统沙箱变化后失去访问权限。
                </p>
            </section>
            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">自动备份</h2>
                <div className="mobile-settings-two-column-fields">
                    <label className="mobile-settings-field-block">
                        <span>备份间隔（秒）</span>
                        <Input
                            type="number"
                            min={0}
                            max={86400}
                            step={30}
                            value={autoBackupSecs}
                            radius="full"
                            onValueChange={value => onAutoBackupSecsChange(clampInteger(value, autoBackupSecs, 0, 86400))}
                        />
                        <small>0 表示关闭</small>
                    </label>
                    <label className="mobile-settings-field-block">
                        <span>最大备份数量</span>
                        <Input
                            type="number"
                            min={1}
                            max={999}
                            step={1}
                            value={maxBackupCount}
                            radius="full"
                            onValueChange={value => onMaxBackupCountChange(clampInteger(value, maxBackupCount, 1, 999))}
                        />
                        <small>按时间保留最近的备份组</small>
                    </label>
                </div>
            </section>
            <Button type="button" radius="full" block onClick={() => void onSave()}>
                保存存储设置
            </Button>
        </div>
    )
}

export function MobileSettingsPermissionsSection({
    writerModeEnabled,
    searchEngine,
    searchSources,
    onWriterModeChange,
    onSearchEngineChange,
    onSearchSourceChange,
    onSave,
}: PermissionsProps) {
    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">AI 操作许可</h2>
                <label className="mobile-settings-switch-field mobile-settings-switch-field--stacked">
                    <span>
                        <strong>允许 AI 作家模式</strong>
                        <small>跳过新建、改写、移动等常规确认；删除类操作仍会要求确认。</small>
                    </span>
                    <input
                        type="checkbox"
                        checked={writerModeEnabled}
                        onChange={event => onWriterModeChange(event.currentTarget.checked)}
                    />
                </label>
            </section>
            <section className="mobile-settings-panel mobile-settings-form-stack">
                <h2 className="mobile-settings-panel__title">搜索工具</h2>
                <label className="mobile-settings-field-block">
                    <span>搜索引擎</span>
                    <Select
                        value={searchEngine}
                        options={[
                            {value: 'bing', label: '必应 (Bing)'},
                            {value: 'baidu', label: '百度 (Baidu)'},
                            {value: 'duckduckgo', label: 'DuckDuckGo'},
                        ]}
                        radius="full"
                        onValueChange={value => onSearchEngineChange(String(value ?? 'bing'))}
                    />
                </label>
                <div>
                    <div className="mobile-settings-subtitle">搜索信源</div>
                    <div className="mobile-settings-option-list">
                        {SEARCH_SOURCE_OPTIONS.map(source => (
                            <label className="mobile-settings-switch-field mobile-settings-switch-field--stacked" key={source.key}>
                                <span>
                                    <strong>{source.label}</strong>
                                    <small>{source.hint}</small>
                                </span>
                                <input
                                    type="checkbox"
                                    checked={searchSources[source.key]}
                                    onChange={event => onSearchSourceChange(source.key, event.currentTarget.checked)}
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </section>
            <Button type="button" radius="full" block onClick={() => void onSave()}>
                保存权限设置
            </Button>
        </div>
    )
}

export function MobileSettingsTemplatesSection({
    defaultPrompt,
    editorFontSize,
    onDefaultPromptChange,
    onSaveSettings,
}: TemplatesProps) {
    const {showAlert} = useAlert()
    const [templates, setTemplates] = useState<TemplateMeta[]>([])
    const [selectedId, setSelectedId] = useState('')
    const [document, setDocument] = useState<TemplateDocument | null>(null)
    const [draft, setDraft] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [validationError, setValidationError] = useState<TemplateValidationError | null>(null)

    const loadTemplates = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const items = await template_list()
            setTemplates(items)
            setSelectedId(current => current || items[0]?.id || '')
        } catch (nextError) {
            const message = String(nextError)
            logger.error('[MobileSettings] 加载指令模板失败', nextError)
            setError(message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadTemplates()
    }, [loadTemplates])

    useEffect(() => {
        if (!selectedId) {
            setDocument(null)
            setDraft('')
            return
        }
        let disposed = false
        setLoading(true)
        setError('')
        setValidationError(null)
        template_get(selectedId)
            .then(next => {
                if (disposed) return
                setDocument(next)
                setDraft(next.content)
            })
            .catch(nextError => {
                if (!disposed) setError(String(nextError))
            })
            .finally(() => {
                if (!disposed) setLoading(false)
            })
        return () => {
            disposed = true
        }
    }, [selectedId])

    const templateOptions = useMemo(() => templates.map(template => ({
        value: template.id,
        label: `${template.group} · ${template.title}`,
    })), [templates])

    const restoreDefault = useCallback(async () => {
        if (!selectedId) return
        try {
            setDraft(await template_get_default(selectedId))
            setValidationError(null)
            await showAlert('已载入内置默认内容，保存后生效', 'success', 'nonInvasive', 1800)
        } catch (nextError) {
            await showAlert(`读取默认模板失败：${String(nextError)}`, 'error', 'nonInvasive', 3000)
        }
    }, [selectedId, showAlert])

    const saveTemplate = useCallback(async () => {
        if (!selectedId) return
        setSaving(true)
        setValidationError(null)
        try {
            const result = await template_save(selectedId, draft)
            if (result.status === 'success') {
                setDocument(result.document)
                setDraft(result.document.content)
                await showAlert('指令模板已保存', 'success', 'nonInvasive', 1600)
            } else if (result.status === 'validation_error') {
                setValidationError(result.error)
            } else {
                await showAlert(`保存失败：${result.message}`, 'error', 'nonInvasive', 3000)
            }
        } catch (nextError) {
            await showAlert(`保存失败：${String(nextError)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setSaving(false)
        }
    }, [draft, selectedId, showAlert])

    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            <section className="mobile-settings-panel mobile-settings-form-stack">
                <h2 className="mobile-settings-panel__title">应用感知自定义指令</h2>
                <p className="mobile-settings-field-hint">追加到应用感知模式的系统指令中。</p>
                <textarea
                    className="mobile-settings-textarea"
                    value={defaultPrompt}
                    aria-label="应用感知自定义指令"
                    style={{fontSize: `max(${editorFontSize}px, var(--mobile-text-body))`}}
                    placeholder="可选"
                    onChange={event => onDefaultPromptChange(event.currentTarget.value)}
                />
                <Button type="button" radius="full" onClick={() => void onSaveSettings()}>
                    保存自定义指令
                </Button>
            </section>

            <section className="mobile-settings-panel mobile-settings-form-stack">
                <div className="mobile-settings-section__header">
                    <h2 className="mobile-settings-panel__title">模板文件</h2>
                    <Button type="button" size="sm" variant="outline" radius="full" onClick={() => void loadTemplates()} disabled={loading}>
                        {loading ? '加载中…' : '刷新'}
                    </Button>
                </div>
                {error && <div className="mobile-settings-plugin-error">加载失败：{error}</div>}
                <Select
                    value={selectedId}
                    options={templateOptions}
                    placeholder="选择模板"
                    radius="full"
                    onValueChange={value => setSelectedId(String(value ?? ''))}
                />
                {document && (
                    <>
                        <div className="mobile-settings-template-meta">
                            <strong>{document.meta.title}</strong>
                            <span>{document.meta.purpose}</span>
                            <span>出现位置：{document.meta.appear_in}</span>
                            <span>{document.is_override ? '当前使用本地覆盖' : '当前使用内置默认'}</span>
                        </div>
                        <textarea
                            className="mobile-settings-textarea mobile-settings-textarea--template"
                            value={draft}
                            aria-label={`${document.meta.title}模板内容`}
                            spellCheck={false}
                            style={{fontSize: `max(${editorFontSize}px, var(--mobile-text-body))`}}
                            onChange={event => {
                                setDraft(event.currentTarget.value)
                                setValidationError(null)
                            }}
                        />
                        {validationError && (
                            <div className="mobile-settings-template-error" role="alert">
                                {validationError.line ? `第 ${validationError.line} 行：` : ''}{validationError.message}
                            </div>
                        )}
                        <div className="mobile-settings-inline-actions">
                            <Button type="button" variant="outline" radius="full" onClick={() => void restoreDefault()} disabled={saving}>
                                载入默认值
                            </Button>
                            <Button type="button" radius="full" onClick={() => void saveTemplate()} disabled={saving || !draft.trim()}>
                                {saving ? '保存中…' : '保存模板'}
                            </Button>
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}

export function MobileSettingsFeedbackSection() {
    return (
        <div className="mobile-settings-section mobile-settings-feedback">
            <p className="mobile-settings-field-hint">提交建议或问题；不会自动上传项目数据或日志。</p>
            <FeedbackSection/>
        </div>
    )
}
