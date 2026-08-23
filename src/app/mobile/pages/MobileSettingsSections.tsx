import {useEffect, useState} from 'react'
import {Button, Input, Select, Slider} from 'flowcloudai-ui'
import {
    type ApiUsageByModel,
    type ApiUsageSummary,
    type LocalPluginInfo,
    type RemotePluginInfo,
} from '../../../api'
import {usePluginPageCapacity} from '../../../features/plugins/usePluginPageCapacity'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {MobileSearchIcon} from '../components/MobileTopControls'
import {type MobileSettingsPageType} from '../usePageStack'
import MobilePluginIcon from './MobilePluginIcon'

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type PluginKindFilter = 'all' | 'llm' | 'image' | 'tts'

interface SelectOption {
    value: string
    label: string
}

interface MenuSectionProps {
    themeLabel: string
    localPluginCount: number
    currentPluginName?: string
    apiKeyStatusLabel: string
    writerModeEnabled: boolean
    searchEngineLabel: string
    version: string
    onOpenPage: (type: MobileSettingsPageType) => void
}

interface PluginsSectionProps {
    localPluginCount: number
    pluginSourcesRefreshing: boolean
    installingLocalFile: boolean
    pluginSearch: string
    pluginKindFilter: PluginKindFilter
    localPluginError: string | null
    marketPluginError: string | null
    loadingMarketPlugins: boolean
    localPlugins: LocalPluginInfo[]
    marketPlugins: RemotePluginInfo[]
    installingPluginIds: Set<string>
    uninstallingPluginId: string | null
    selectedApiKeyPlugin: string
    apiKeyPluginOptions: SelectOption[]
    apiKeyStatus: ApiKeyStatus
    apiKeyStatusLabel: string
    apiKeyDraft: string
    apiKeyBusy: boolean
    apiKeyPlaceholder: string
    onPluginSearchChange: (value: string) => void
    onPluginKindFilterChange: (value: PluginKindFilter) => void
    getInstalledPlugin: (pluginId: string) => LocalPluginInfo | undefined
    onRefreshPluginSources: () => void | Promise<void>
    onInstallFromFile: () => void | Promise<void>
    onInstallMarketPlugin: (pluginId: string) => void | Promise<void>
    onUninstallPlugin: (pluginId: string) => void | Promise<void>
    onSelectedApiKeyPluginChange: (value: string) => void
    onApiKeyDraftChange: (value: string) => void
    onSaveApiKey: () => void | Promise<void>
    onDeleteApiKey: () => void | Promise<void>
}

interface AppearanceSectionProps {
    theme: string
    themeOptions: SelectOption[]
    language: string
    languageOptions: SelectOption[]
    editorFontSize: number
    glassEffectEnabled: boolean
    onThemeChange: (value: 'system' | 'light' | 'dark') => void
    onLanguageChange: (value: string) => void
    onEditorFontSizeChange: (value: number) => void
    onGlassEffectChange: (value: boolean) => void
    onSaveSettings: () => void | Promise<void>
}

interface UsageSectionProps {
    summary: ApiUsageSummary | null
    byModel: ApiUsageByModel[]
    loading: boolean
    error: string
    onRefresh: () => void | Promise<void>
}

function getPluginKindLabel(kind: string): string {
    if (kind.includes('image')) return 'AI 绘图'
    if (kind.includes('tts')) return 'AI 语音'
    return 'AI 对话'
}

function getUsageModalityLabel(modality: string): string {
    if (modality === 'image') return '图片'
    if (modality === 'tts') return '语音'
    return '对话'
}

function formatUsageNumber(value: number): string {
    return value.toLocaleString('zh-CN')
}

function readSliderNumber(value: number | [number, number]): number {
    return Array.isArray(value) ? value[0] : value
}

function ChevronRightIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="mobile-settings-menu-item__icon"
        >
            <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function MobileSettingsMenuSection({
    themeLabel,
    localPluginCount,
    currentPluginName,
    apiKeyStatusLabel,
    writerModeEnabled,
    searchEngineLabel,
    version,
    onOpenPage,
}: MenuSectionProps) {
    const groups: Array<{
        label: string
        items: Array<{type: MobileSettingsPageType; label: string; summary: string}>
    }> = [
        {
            label: '系统',
            items: [
                {type: 'settingsStorage', label: '存储与备份', summary: 'Android 私有存储与自动备份'},
                {type: 'settingsAppearance', label: '外观', summary: themeLabel},
            ],
        },
        {
            label: 'AI',
            items: [
                {
                    type: 'settingsPlugins',
                    label: '插件管理',
                    summary: `已安装 ${localPluginCount} 个 · 密钥${apiKeyStatusLabel}`,
                },
                {type: 'settingsModels', label: '模型管理', summary: currentPluginName ?? '未选择默认对话插件'},
                {
                    type: 'settingsPermissions',
                    label: '权限与工具',
                    summary: `${writerModeEnabled ? '作家模式已允许' : '作家模式未允许'} · ${searchEngineLabel}`,
                },
                {type: 'settingsTemplates', label: '指令模板', summary: '应用感知指令与模板文件'},
                {type: 'settingsUsage', label: '用量统计', summary: 'AI 使用次数与消耗统计'},
            ],
        },
        {
            label: '信息',
            items: [
                {type: 'settingsUpdate', label: '更新', summary: version ? `当前版本 ${version}` : '检查更新与查看版本记录'},
                {type: 'settingsFeedback', label: '提交反馈', summary: '提交建议或问题'},
                {type: 'settingsAbout', label: '关于', summary: '流云AI 移动端'},
            ],
        },
    ]

    return (
        <div className="mobile-settings-menu">
            {groups.map(group => (
                <section className="mobile-settings-menu-group" key={group.label}>
                    <h2 className="mobile-settings-menu-group__label">{group.label}</h2>
                    <div className="mobile-settings-menu-group__items">
                        {group.items.map(item => (
                            <button
                                key={item.type}
                                type="button"
                                className="mobile-settings-menu-item"
                                onClick={() => onOpenPage(item.type)}
                            >
                                <span className="mobile-settings-menu-item__content">
                                    <span className="mobile-settings-menu-item__label">{item.label}</span>
                                    <span className="mobile-settings-menu-item__summary">{item.summary}</span>
                                </span>
                                <ChevronRightIcon/>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}

function MobilePluginPagination({
    page,
    pageCount,
    ariaLabel,
    onPageChange,
}: {
    page: number
    pageCount: number
    ariaLabel: string
    onPageChange: (page: number) => void
}) {
    return (
        <nav
            className={`mobile-settings-plugin-pagination${pageCount <= 1 ? ' is-placeholder' : ''}`}
            aria-label={ariaLabel}
            aria-hidden={pageCount <= 1}
        >
            <Button
                type="button"
                size="sm"
                variant="outline"
                radius="full"
                disabled={page === 1}
                onClick={() => onPageChange(page - 1)}
            >
                上一页
            </Button>
            <span aria-live="polite">{page} / {pageCount}</span>
            <Button
                type="button"
                size="sm"
                variant="outline"
                radius="full"
                disabled={page === pageCount}
                onClick={() => onPageChange(page + 1)}
            >
                下一页
            </Button>
        </nav>
    )
}

export function MobileSettingsPluginsSection({
    localPluginCount,
    pluginSourcesRefreshing,
    installingLocalFile,
    pluginSearch,
    pluginKindFilter,
    localPluginError,
    marketPluginError,
    loadingMarketPlugins,
    localPlugins,
    marketPlugins,
    installingPluginIds,
    uninstallingPluginId,
    selectedApiKeyPlugin,
    apiKeyPluginOptions,
    apiKeyStatus,
    apiKeyStatusLabel,
    apiKeyDraft,
    apiKeyBusy,
    apiKeyPlaceholder,
    onPluginSearchChange,
    onPluginKindFilterChange,
    getInstalledPlugin,
    onRefreshPluginSources,
    onInstallFromFile,
    onInstallMarketPlugin,
    onUninstallPlugin,
    onSelectedApiKeyPluginChange,
    onApiKeyDraftChange,
    onSaveApiKey,
    onDeleteApiKey,
}: PluginsSectionProps) {
    const [pluginLibraryOpen, setPluginLibraryOpen] = useState(false)
    const [apiKeyPanelOpen, setApiKeyPanelOpen] = useState(false)
    const [installedPage, setInstalledPage] = useState(1)
    const [marketPage, setMarketPage] = useState(1)
    const {
        viewportRef: installedViewportRef,
        listRef: installedListRef,
        pageSize: installedPageSize,
    } = usePluginPageCapacity(true, localPlugins.length)
    const {
        viewportRef: marketViewportRef,
        listRef: marketListRef,
        pageSize: marketPageSize,
    } = usePluginPageCapacity(pluginLibraryOpen, marketPlugins.length)
    const installedPageCount = Math.max(1, Math.ceil(localPlugins.length / installedPageSize))
    const currentInstalledPage = Math.min(installedPage, installedPageCount)
    const paginatedLocalPlugins = localPlugins.slice(
        (currentInstalledPage - 1) * installedPageSize,
        currentInstalledPage * installedPageSize,
    )
    const marketPageCount = Math.max(1, Math.ceil(marketPlugins.length / marketPageSize))
    const currentMarketPage = Math.min(marketPage, marketPageCount)
    const paginatedMarketPlugins = marketPlugins.slice(
        (currentMarketPage - 1) * marketPageSize,
        currentMarketPage * marketPageSize,
    )

    useEffect(() => {
        setInstalledPage(page => Math.min(page, installedPageCount))
    }, [installedPageCount])

    useEffect(() => {
        setMarketPage(page => Math.min(page, marketPageCount))
    }, [marketPageCount])

    return (
        <>
            <div className="mobile-settings-section mobile-settings-plugin-page">
                <div className="mobile-settings-installed-plugin-list__header">
                    <div>
                        <div className="mobile-settings-installed-plugin-list__title">已安装插件</div>
                        <div className="mobile-settings-plugin-count">已安装 {localPluginCount} 个</div>
                    </div>
                    <div className="mobile-settings-plugin-header-actions">
                        <Button type="button" size="sm" radius="full" onClick={() => setPluginLibraryOpen(true)}>
                            安装插件
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            radius="full"
                            onClick={() => void onRefreshPluginSources()}
                            disabled={pluginSourcesRefreshing}
                        >
                            {pluginSourcesRefreshing ? '刷新中…' : '刷新'}
                        </Button>
                    </div>
                </div>
                {localPluginError && (
                    <div className="mobile-settings-plugin-error">本地插件加载失败：{localPluginError}</div>
                )}
                <div ref={installedViewportRef} className="mobile-settings-plugin-grid-viewport">
                    <div ref={installedListRef} className="mobile-settings-plugin-grid">
                        {localPlugins.length === 0 ? (
                            <div className="mobile-settings-plugin-empty">暂无已安装插件</div>
                        ) : (
                            paginatedLocalPlugins.map(plugin => (
                                <div className="mobile-settings-installed-plugin-item" key={plugin.id}>
                                    <MobilePluginIcon kind={plugin.kind} iconUrl={plugin.icon_url} local/>
                                    <div className="mobile-settings-plugin-item__body">
                                        <div className="mobile-settings-plugin-item__title">{plugin.name}</div>
                                        <div className="mobile-settings-plugin-item__meta">
                                            <span>{getPluginKindLabel(plugin.kind)}</span>
                                            <span>v{plugin.version}</span>
                                            <span>{plugin.author}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-settings-plugin-item__actions">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            radius="full"
                                            onClick={() => {
                                                onSelectedApiKeyPluginChange(plugin.id)
                                                setApiKeyPanelOpen(true)
                                            }}
                                        >
                                            密钥
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            radius="full"
                                            disabled={uninstallingPluginId === plugin.id}
                                            onClick={() => void onUninstallPlugin(plugin.id)}
                                        >
                                            {uninstallingPluginId === plugin.id ? '卸载中…' : '卸载'}
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <MobilePluginPagination
                    page={currentInstalledPage}
                    pageCount={installedPageCount}
                    ariaLabel="已安装插件分页"
                    onPageChange={setInstalledPage}
                />
            </div>

            <FloatingPanel
                open={apiKeyPanelOpen}
                onClose={() => setApiKeyPanelOpen(false)}
                title="访问密钥"
                className="mobile-settings-api-key-panel"
            >
                <div className="mobile-settings-api-key mobile-settings-api-key--panel">
                    <div className="mobile-settings-api-key__header">
                        <div className="mobile-settings-api-key__desc">按插件保存到系统安全存储，不写入设置文件明文。</div>
                        <span className={`mobile-settings-api-key__status mobile-settings-api-key__status--${apiKeyStatus}`}>
                            {apiKeyStatusLabel}
                        </span>
                    </div>
                    <Select
                        value={selectedApiKeyPlugin}
                        onValueChange={value => onSelectedApiKeyPluginChange(String(value ?? ''))}
                        options={apiKeyPluginOptions}
                        placeholder="选择要配置的插件"
                        radius="full"
                    />
                    <Input
                        type="password"
                        aria-label="插件访问密钥"
                        value={apiKeyDraft}
                        onValueChange={onApiKeyDraftChange}
                        placeholder={apiKeyPlaceholder}
                        disabled={!selectedApiKeyPlugin || apiKeyBusy}
                        autoComplete="off"
                        radius="full"
                        className="mobile-settings-api-key__input"
                    />
                    <div className="mobile-settings-api-key__actions">
                        <Button
                            type="button"
                            size="sm"
                            radius="full"
                            onClick={() => void onSaveApiKey()}
                            disabled={!selectedApiKeyPlugin || apiKeyBusy || !apiKeyDraft.trim()}
                        >
                            {apiKeyBusy ? '处理中…' : '保存密钥'}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            radius="full"
                            onClick={() => void onDeleteApiKey()}
                            disabled={!selectedApiKeyPlugin || apiKeyBusy || apiKeyStatus !== 'configured'}
                        >
                            删除密钥
                        </Button>
                    </div>
                </div>
            </FloatingPanel>

            <FloatingPanel
                open={pluginLibraryOpen}
                onClose={() => setPluginLibraryOpen(false)}
                title="插件库"
                className="mobile-settings-plugin-library-panel"
            >
                <div className="mobile-settings-plugin-library-content">
                    <div className="mobile-settings-plugin-library-actions">
                        <Button
                            type="button"
                            size="sm"
                            radius="full"
                            onClick={() => void onInstallFromFile()}
                            disabled={installingLocalFile}
                        >
                            {installingLocalFile ? '安装中…' : '安装本地插件'}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            radius="full"
                            onClick={() => void onRefreshPluginSources()}
                            disabled={pluginSourcesRefreshing}
                        >
                            {pluginSourcesRefreshing ? '刷新中…' : '刷新'}
                        </Button>
                    </div>
                    <div className="mobile-settings-plugin-search-row">
                        <Input
                            value={pluginSearch}
                            aria-label="搜索插件"
                            onValueChange={value => {
                                setMarketPage(1)
                                onPluginSearchChange(value)
                            }}
                            placeholder="搜索插件…"
                            prefix={<MobileSearchIcon className="mobile-drawer-search-icon"/>}
                            radius="full"
                            size="lg"
                            allowClear
                            className="mobile-settings-plugin-search"
                        />
                    </div>
                    <div className="mobile-settings-plugin-filter">
                        <div className="mobile-settings-plugin-filter__segments" role="group" aria-label="插件类型筛选">
                            {[
                                ['all', '全部'],
                                ['llm', '对话'],
                                ['image', '图片'],
                                ['tts', '语音'],
                            ].map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    className={`mobile-settings-plugin-filter__segment${pluginKindFilter === value ? ' is-active' : ''}`}
                                    aria-pressed={pluginKindFilter === value}
                                    onClick={() => {
                                        setMarketPage(1)
                                        onPluginKindFilterChange(value as PluginKindFilter)
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {marketPluginError && (
                        <div className="mobile-settings-plugin-error">插件库加载失败：{marketPluginError}</div>
                    )}
                    <div ref={marketViewportRef} className="mobile-settings-plugin-grid-viewport">
                        <div ref={marketListRef} className="mobile-settings-plugin-grid mobile-settings-plugin-list">
                            {loadingMarketPlugins ? (
                                <div className="mobile-settings-plugin-empty">正在加载插件库…</div>
                            ) : marketPlugins.length === 0 ? (
                                <div className="mobile-settings-plugin-empty">暂无可安装插件</div>
                            ) : (
                                paginatedMarketPlugins.map(plugin => {
                                    const installedPlugin = getInstalledPlugin(plugin.id)
                                    const installed = Boolean(installedPlugin)
                                    const hasUpdate = installedPlugin ? installedPlugin.version !== plugin.version : false
                                    const installing = installingPluginIds.has(plugin.id)
                                    const actionDisabled = installing || (installed && !hasUpdate)
                                    const actionLabel = installed
                                        ? hasUpdate
                                            ? installing ? '更新中…' : '更新'
                                            : '已安装'
                                        : installing ? '安装中…' : '安装'

                                    return (
                                        <div className="mobile-settings-plugin-item" key={plugin.id}>
                                            <MobilePluginIcon kind={plugin.kind} iconUrl={plugin.icon_url}/>
                                            <div className="mobile-settings-plugin-item__body">
                                                <div className="mobile-settings-plugin-item__title">{plugin.name}</div>
                                                <div className="mobile-settings-plugin-item__meta">
                                                    <span>{getPluginKindLabel(plugin.kind)}</span>
                                                    <span>v{plugin.version}</span>
                                                    <span>{plugin.author}</span>
                                                </div>
                                                {installedPlugin && (
                                                    <div className={`mobile-settings-plugin-item__status${hasUpdate ? ' is-update' : ''}`}>
                                                        {hasUpdate
                                                            ? `已安装 v${installedPlugin.version}，可更新`
                                                            : `已安装 v${installedPlugin.version}`}
                                                    </div>
                                                )}
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                radius="full"
                                                variant={installed && !hasUpdate ? 'outline' : 'primary'}
                                                disabled={actionDisabled}
                                                onClick={() => void onInstallMarketPlugin(plugin.id)}
                                            >
                                                {actionLabel}
                                            </Button>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                    <MobilePluginPagination
                        page={currentMarketPage}
                        pageCount={marketPageCount}
                        ariaLabel="插件库分页"
                        onPageChange={setMarketPage}
                    />
                </div>
            </FloatingPanel>
        </>
    )
}

export function MobileSettingsAppearanceSection({
    theme,
    themeOptions,
    language,
    languageOptions,
    editorFontSize,
    glassEffectEnabled,
    onThemeChange,
    onLanguageChange,
    onEditorFontSizeChange,
    onGlassEffectChange,
    onSaveSettings,
}: AppearanceSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-form-stack">
                <div>
                    <div className="mobile-settings-field-label">主题</div>
                    <Select
                        value={theme}
                        onValueChange={v => onThemeChange(String(v ?? 'system') as 'system' | 'light' | 'dark')}
                        options={themeOptions}
                        placeholder="选择主题"
                        radius="full"
                    />
                </div>
                <div>
                    <div className="mobile-settings-field-label">语言</div>
                    <Select
                        value={language}
                        onValueChange={v => onLanguageChange(String(v ?? 'zh-CN'))}
                        options={languageOptions}
                        placeholder="选择语言"
                        radius="full"
                    />
                </div>
                <div>
                    <div className="mobile-settings-field-label">编辑器字号</div>
                    <div className="mobile-settings-font-size-control">
                        <Slider
                            min={10}
                            max={24}
                            step={1}
                            value={editorFontSize}
                            tooltip
                            onValueChange={value => onEditorFontSizeChange(readSliderNumber(value))}
                        />
                        <span>{editorFontSize}px</span>
                        {editorFontSize !== 14 && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => onEditorFontSizeChange(14)}
                            >
                                默认
                            </Button>
                        )}
                    </div>
                </div>
                <label className="mobile-settings-switch-field">
                    <span>毛玻璃效果</span>
                    <input
                        type="checkbox"
                        checked={glassEffectEnabled}
                        onChange={event => onGlassEffectChange(event.currentTarget.checked)}
                    />
                </label>
                <Button type="button" onClick={onSaveSettings} className="mobile-settings-full-button">
                    保存设置
                </Button>
            </div>
        </div>
    )
}

export function MobileSettingsUsageSection({
    summary,
    byModel,
    loading,
    error,
    onRefresh,
}: UsageSectionProps) {
    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            <div className="mobile-settings-section__header">
                <div className="mobile-settings-plugin-count">查看 AI 使用次数与消耗统计</div>
                <Button type="button" size="sm" variant="outline" radius="full" onClick={() => void onRefresh()} disabled={loading}>
                    {loading ? '刷新中…' : '刷新'}
                </Button>
            </div>
            {loading && !summary && <div className="mobile-settings-plugin-empty">正在加载用量统计…</div>}
            {error && <div className="mobile-settings-plugin-error">加载失败：{error}</div>}
            {summary && (
                <div className="mobile-settings-usage-grid">
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.call_count)}</div>
                        <div className="mobile-settings-usage-card__label">AI 使用</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">总消耗</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_prompt_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">提问消耗</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_completion_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">应答消耗</div>
                    </div>
                </div>
            )}
            <div className="mobile-settings-subtitle">按模型统计</div>
            <div className="mobile-settings-usage-model-list">
                {byModel.length === 0 ? (
                    <div className="mobile-settings-plugin-empty">暂无记录。使用 AI 对话后将自动统计。</div>
                ) : byModel.map((row, index) => (
                    <div className="mobile-settings-usage-model-item" key={`${row.provider}-${row.model}-${index}`}>
                        <div className="mobile-settings-usage-model-item__header">
                            <div className="mobile-settings-plugin-item__title">{row.model}</div>
                            <span className="mobile-settings-usage-badge">{getUsageModalityLabel(row.modality)}</span>
                        </div>
                        <div className="mobile-settings-plugin-item__meta">
                            <span>{row.provider}</span>
                            <span>{formatUsageNumber(row.call_count)} 次</span>
                            <span>{formatUsageNumber(row.total_tokens)} 消耗</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
