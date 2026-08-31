/**
 * 插件管理下面两个独立页面：访问密钥、插件库。
 *
 * 原本是插件管理页里的两个 FloatingPanel，但都是重操作——密钥要输入敏感文本、
 * 插件库带搜索框与分页列表，本质是一整页内容塞进了浮层。浮层只留给
 * 选择、提示和简单查看。
 *
 * 数据仍由 MobileSettings 持有，这里只做展示与回调。
 */
import {useEffect, useState} from 'react'
import {Button, Input, Select} from 'flowcloudai-ui'
import {type LocalPluginInfo, type RemotePluginInfo} from '../../../api'
import {usePluginPageCapacity} from '../../../features/plugins/usePluginPageCapacity'
import {MobileSearchIcon} from '../components/MobileTopControls'
import MobilePagination from '../components/MobilePagination'
import MobilePluginIcon from './MobilePluginIcon'
import {getPluginKindLabel} from './mobilePluginLabels'

type ApiKeyStatus = 'unknown' | 'checking' | 'configured' | 'missing' | 'error'
type PluginKindFilter = 'all' | 'llm' | 'image' | 'tts'

interface SelectOption {
    value: string
    label: string
}

interface ApiKeySectionProps {
    selectedApiKeyPlugin: string
    apiKeyPluginOptions: SelectOption[]
    apiKeyStatus: ApiKeyStatus
    apiKeyStatusLabel: string
    apiKeyDraft: string
    apiKeyBusy: boolean
    apiKeyPlaceholder: string
    onSelectedApiKeyPluginChange: (value: string) => void
    onApiKeyDraftChange: (value: string) => void
    onSaveApiKey: () => void | Promise<void>
    onDeleteApiKey: () => void | Promise<void>
}

export function MobileSettingsApiKeySection({
    selectedApiKeyPlugin,
    apiKeyPluginOptions,
    apiKeyStatus,
    apiKeyStatusLabel,
    apiKeyDraft,
    apiKeyBusy,
    apiKeyPlaceholder,
    onSelectedApiKeyPluginChange,
    onApiKeyDraftChange,
    onSaveApiKey,
    onDeleteApiKey,
}: ApiKeySectionProps) {
    return (
        <div className="mobile-settings-section">
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
        </div>
    )
}

interface PluginLibrarySectionProps {
    installingLocalFile: boolean
    pluginSearch: string
    pluginKindFilter: PluginKindFilter
    marketPluginError: string | null
    loadingMarketPlugins: boolean
    marketPlugins: RemotePluginInfo[]
    installingPluginIds: Set<string>
    onPluginSearchChange: (value: string) => void
    onPluginKindFilterChange: (value: PluginKindFilter) => void
    getInstalledPlugin: (pluginId: string) => LocalPluginInfo | undefined
    onInstallFromFile: () => void | Promise<void>
    onInstallMarketPlugin: (pluginId: string) => void | Promise<void>
}

export function MobileSettingsPluginLibrarySection({
    installingLocalFile,
    pluginSearch,
    pluginKindFilter,
    marketPluginError,
    loadingMarketPlugins,
    marketPlugins,
    installingPluginIds,
    onPluginSearchChange,
    onPluginKindFilterChange,
    getInstalledPlugin,
    onInstallFromFile,
    onInstallMarketPlugin,
}: PluginLibrarySectionProps) {
    const [marketPage, setMarketPage] = useState(1)
    const {
        viewportRef: marketViewportRef,
        listRef: marketListRef,
        pageSize: marketPageSize,
    } = usePluginPageCapacity(true, marketPlugins.length)
    const marketPageCount = Math.max(1, Math.ceil(marketPlugins.length / marketPageSize))
    const currentMarketPage = Math.min(marketPage, marketPageCount)
    const paginatedMarketPlugins = marketPlugins.slice(
        (currentMarketPage - 1) * marketPageSize,
        currentMarketPage * marketPageSize,
    )

    useEffect(() => {
        setMarketPage(page => Math.min(page, marketPageCount))
    }, [marketPageCount])

    return (
        <div className="mobile-settings-section mobile-settings-plugin-library-content">
            {/*
              * 搜索框与「安装本地插件」同一行：刷新已上移到顶栏后，本地安装是这页唯一的
              * 常驻动作，单独占一行只是把列表往下推。
              * 行高由按钮的胶囊高度定，搜索框跟随（见 MobileSettings.css 的 search-row）。
              */}
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
                    size="sm"
                    allowClear
                    className="mobile-settings-plugin-search"
                />
                <Button
                    type="button"
                    size="sm"
                    radius="full"
                    onClick={() => void onInstallFromFile()}
                    disabled={installingLocalFile}
                >
                    {installingLocalFile ? '安装中…' : '安装本地插件'}
                </Button>
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
            <MobilePagination
                page={currentMarketPage}
                pageCount={marketPageCount}
                ariaLabel="插件库分页"
                onPageChange={setMarketPage}
                keepPlaceholder
                round
                className="mobile-settings-plugin-pagination"
            />
        </div>
    )
}
