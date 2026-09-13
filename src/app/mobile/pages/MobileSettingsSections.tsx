import {type CSSProperties, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Button, Select, Slider} from 'flowcloudai-ui'
import {
    type ApiUsageByModel,
    type ApiUsageDaily,
    type ApiUsageSummary,
    type LocalPluginInfo,
} from '../../../api'
import {usePluginPageCapacity} from '../../../features/plugins/usePluginPageCapacity'
import {
    buildUsageActivityDays,
    buildUsageMonthLabels,
    USAGE_ACTIVITY_COLUMNS,
} from '../../../features/settings/usageActivity'
import type {ThemeColorConfig} from '../../../api'
import MobilePagination from '../components/MobilePagination'
import {type MobileSettingsPageType} from '../usePageStack'
import MobilePluginIcon from './MobilePluginIcon'
import MobileThemeColorSection from './MobileThemeColorSection'
import MobileThemeModeSection from './MobileThemeModeSection'
import {getPluginKindLabel} from './mobilePluginLabels'


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
    localPluginError: string | null
    localPlugins: LocalPluginInfo[]
    uninstallingPluginId: string | null
    onUninstallPlugin: (pluginId: string) => void | Promise<void>
    /** 打开访问密钥页，同时把该插件设为待配置对象。 */
    onOpenApiKeys: (pluginId: string) => void
    onOpenPluginLibrary: () => void
}

interface AppearanceSectionProps {
    theme: string
    themeOptions: SelectOption[]
    themeColorConfig: ThemeColorConfig | null
    language: string
    languageOptions: SelectOption[]
    editorFontSize: number
    glassEffectEnabled: boolean
    onThemeChange: (value: 'system' | 'light' | 'dark') => void
    onThemeColorConfigChange: (config: ThemeColorConfig | null) => void
    onLanguageChange: (value: string) => void
    onEditorFontSizeChange: (value: number) => void
    onGlassEffectChange: (value: boolean) => void
}

interface UsageSectionProps {
    summary: ApiUsageSummary | null
    byModel: ApiUsageByModel[]
    daily: ApiUsageDaily[]
    loading: boolean
    error: string
}

function getUsageModalityLabel(modality: string): string {
    if (modality === 'image') return '图片'
    if (modality === 'tts') return '语音'
    return '对话'
}

function formatUsageNumber(value: number): string {
    return value.toLocaleString('zh-CN')
}

/**
 * 用量热力图（与桌面同一份取数，见 features/settings/usageActivity）。
 *
 * 52 周在手机上放不下，横向滚动是必然选择；容器必须带 data-mobile-horizontal-scroll，
 * 否则侧边抽屉手势会把横滑吃掉（见 app_main/AGENTS.md「移动端界面」）。
 * 初始滚到最右：不这么做的话，用户一进来看到的是一年前那片空白。
 */
function UsageHeatmap({daily, totalTokens}: {daily: ApiUsageDaily[]; totalTokens: number | null}) {
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const days = buildUsageActivityDays(daily)
    const monthLabels = buildUsageMonthLabels()

    // 用 layout effect：滚动位置要在首次绘制前就位，不能让用户看见从左边滑过去。
    useLayoutEffect(() => {
        const element = scrollRef.current
        if (element) element.scrollLeft = element.scrollWidth
    }, [daily])

    return (
        <section className="mobile-settings-usage-heatmap">
            <div className="mobile-settings-usage-heatmap__header">
                <div className="mobile-settings-subtitle">AI 使用热力图</div>
                <div className="mobile-settings-usage-heatmap__total">
                    {totalTokens === null ? '暂无数据' : `${formatUsageNumber(totalTokens)} 消耗`}
                </div>
            </div>
            <div
                ref={scrollRef}
                className="mobile-settings-usage-heatmap__scroll"
                data-mobile-horizontal-scroll
                role="img"
                aria-label={`最近 ${USAGE_ACTIVITY_COLUMNS} 周 AI 使用热力图`}
            >
                <div
                    className="mobile-settings-usage-heatmap__track"
                    style={{'--mobile-usage-heatmap-columns': USAGE_ACTIVITY_COLUMNS} as CSSProperties}
                >
                    <div className="mobile-settings-usage-heatmap__grid">
                        {days.map((day, index) => day ? (
                            <span
                                key={day.date}
                                className={`mobile-settings-usage-heatmap__cell mobile-settings-usage-heatmap__cell--${day.intensity}`}
                                title={`${day.label}：${formatUsageNumber(day.totalTokens)} 消耗，${formatUsageNumber(day.callCount)} 条用量记录`}
                            />
                        ) : (
                            <span
                                key={`empty-${index}`}
                                className="mobile-settings-usage-heatmap__cell mobile-settings-usage-heatmap__cell--empty"
                            />
                        ))}
                    </div>
                    <div className="mobile-settings-usage-heatmap__months">
                        {monthLabels.map(item => (
                            <span key={`${item.label}-${item.column}`} style={{gridColumn: item.column}}>
                                {item.label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
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


export function MobileSettingsPluginsSection({
    localPluginCount,
    localPluginError,
    localPlugins,
    uninstallingPluginId,
    onUninstallPlugin,
    onOpenApiKeys,
    onOpenPluginLibrary,
}: PluginsSectionProps) {
    const [installedPage, setInstalledPage] = useState(1)
    const {
        viewportRef: installedViewportRef,
        listRef: installedListRef,
        pageSize: installedPageSize,
    } = usePluginPageCapacity(true, localPlugins.length)
    const installedPageCount = Math.max(1, Math.ceil(localPlugins.length / installedPageSize))
    const currentInstalledPage = Math.min(installedPage, installedPageCount)
    const paginatedLocalPlugins = localPlugins.slice(
        (currentInstalledPage - 1) * installedPageSize,
        currentInstalledPage * installedPageSize,
    )

    useEffect(() => {
        setInstalledPage(page => Math.min(page, installedPageCount))
    }, [installedPageCount])

    return (
        <div className="mobile-settings-section mobile-settings-plugin-page">
            <div className="mobile-settings-installed-plugin-list__header">
                <div>
                    <div className="mobile-settings-installed-plugin-list__title">已安装插件</div>
                    <div className="mobile-settings-plugin-count">已安装 {localPluginCount} 个</div>
                </div>
                <div className="mobile-settings-plugin-header-actions">
                    {/* 已安装列表只在应用自己装卸插件后变化，那条路径自带刷新，不再放刷新按钮。 */}
                    <Button type="button" size="sm" radius="full" onClick={onOpenPluginLibrary}>
                        安装插件
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
                                        onClick={() => onOpenApiKeys(plugin.id)}
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
            <MobilePagination
                page={currentInstalledPage}
                pageCount={installedPageCount}
                ariaLabel="已安装插件分页"
                onPageChange={setInstalledPage}
                keepPlaceholder
                round
                className="mobile-settings-plugin-pagination"
            />
        </div>
    )
}

export function MobileSettingsAppearanceSection({
    theme,
    themeOptions,
    themeColorConfig,
    language,
    languageOptions,
    editorFontSize,
    glassEffectEnabled,
    onThemeChange,
    onThemeColorConfigChange,
    onLanguageChange,
    onEditorFontSizeChange,
    onGlassEffectChange,
}: AppearanceSectionProps) {
    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-form-stack">
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
                <label className="mobile-settings-switch-field mobile-settings-switch-field--inline">
                    <span>毛玻璃效果</span>
                    <input
                        type="checkbox"
                        checked={glassEffectEnabled}
                        onChange={event => onGlassEffectChange(event.currentTarget.checked)}
                    />
                </label>
                {/*
                  * 明暗主题与颜色主题放在最后：上面几项是「怎么排版」，这两项是「什么颜色」，
                  * 而颜色改动会让整页当场重绘——摆在顶部会把用户正在读的内容顶走。
                  */}
                <MobileThemeModeSection
                    value={theme}
                    options={themeOptions}
                    onChange={onThemeChange}
                />
                <MobileThemeColorSection
                    value={themeColorConfig}
                    onChange={onThemeColorConfigChange}
                />
            </div>
        </div>
    )
}

export function MobileSettingsUsageSection({
    summary,
    byModel,
    daily,
    loading,
    error,
}: UsageSectionProps) {
    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            {/* 刷新在顶栏（见 MobileSettings 的 refreshPill），这里只留说明。 */}
            <div className="mobile-settings-plugin-count">查看实际 API 请求、缓存覆盖与消耗统计</div>
            {loading && !summary && <div className="mobile-settings-plugin-empty">正在加载用量统计…</div>}
            {error && <div className="mobile-settings-plugin-error">加载失败：{error}</div>}
            {summary && (
                <div className="mobile-settings-usage-grid">
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.request_count)}</div>
                        <div className="mobile-settings-usage-card__label">API 请求</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">总消耗</div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">
                            {summary.cached_prompt_tokens == null
                                ? '未知'
                                : formatUsageNumber(summary.cached_prompt_tokens)}
                        </div>
                        <div className="mobile-settings-usage-card__label">
                            缓存读取（{summary.cache_usage_known_count}/{summary.request_count}）
                        </div>
                    </div>
                    <div className="mobile-settings-usage-card">
                        <div className="mobile-settings-usage-card__value">{formatUsageNumber(summary.total_completion_tokens)}</div>
                        <div className="mobile-settings-usage-card__label">应答消耗</div>
                    </div>
                </div>
            )}
            {summary && summary.legacy_turn_count > 0 && (
                <div className="mobile-settings-plugin-count">
                    另有 {formatUsageNumber(summary.legacy_turn_count)} 条旧版回合记录，不计作实际 API 请求。
                </div>
            )}
            {summary && <UsageHeatmap daily={daily} totalTokens={summary.total_tokens}/>}
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
                            <span>{formatUsageNumber(row.request_count)} 个请求</span>
                            {row.legacy_turn_count > 0 && (
                                <span>{formatUsageNumber(row.legacy_turn_count)} 条旧回合</span>
                            )}
                            <span>
                                缓存 {row.cached_prompt_tokens == null
                                    ? '未知'
                                    : formatUsageNumber(row.cached_prompt_tokens)}
                                （{row.cache_usage_known_count}/{row.request_count}）
                            </span>
                            <span>{formatUsageNumber(row.total_tokens)} 消耗</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
