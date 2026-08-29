import {Input, Select} from 'flowcloudai-ui'
import {type SearchSourceSettings} from '../../../api'
import {FeedbackSection} from '../../../features/about/AboutSection'

interface StorageProps {
    autoBackupSecs: number
    maxBackupCount: number
    onAutoBackupSecsChange: (value: number) => void
    onMaxBackupCountChange: (value: number) => void
}

interface PermissionsProps {
    writerModeEnabled: boolean
    searchEngine: string
    searchSources: SearchSourceSettings
    onWriterModeChange: (enabled: boolean) => void
    onSearchEngineChange: (value: string) => void
    onSearchSourceChange: (key: keyof SearchSourceSettings, enabled: boolean) => void
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
