import {Input, Select, Slider} from 'flowcloudai-ui'
import type {AppSettings, LlmCompactDetail, PluginInfo} from '../../../api'
import {CONVERSATION_TEMPERATURE_MAX} from '../../../features/ai-chat/model/AiControllerTypes'
import {buildTtsVoiceOptions, normalizeVoiceIdWithPlugin} from '../../../features/plugins/ttsVoice'

interface Props {
    settings: AppSettings
    llmPlugins: PluginInfo[]
    imagePlugins: PluginInfo[]
    ttsPlugins: PluginInfo[]
    onChange: (settings: AppSettings) => void
}

type ModelKind = 'llm' | 'image' | 'tts'

function clampNumber(value: string | number, fallback: number, min: number, max: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

function readSliderNumber(value: number | [number, number]): number {
    return Array.isArray(value) ? value[0] : value
}

function pluginOptions(plugins: PluginInfo[]) {
    return plugins.map(plugin => ({value: plugin.id, label: plugin.name}))
}

function modelOptions(plugin: PluginInfo | null) {
    return (plugin?.models ?? []).map(model => ({value: model, label: model}))
}

/** 移动端模型管理：与桌面端保持同一领域分组，但使用单列触控布局。 */
export default function MobileSettingsModelsSection({
    settings,
    llmPlugins,
    imagePlugins,
    ttsPlugins,
    onChange,
}: Props) {
    const pluginsByKind: Record<ModelKind, PluginInfo[]> = {
        llm: llmPlugins,
        image: imagePlugins,
        tts: ttsPlugins,
    }
    const selectedLlmPlugin = llmPlugins.find(plugin => plugin.id === settings.llm.plugin_id) ?? null
    const selectedImagePlugin = imagePlugins.find(plugin => plugin.id === settings.image.plugin_id) ?? null
    const selectedTtsPlugin = ttsPlugins.find(plugin => plugin.id === settings.tts.plugin_id) ?? null
    const updateLlm = (patch: Partial<AppSettings['llm']>) => {
        onChange({...settings, llm: {...settings.llm, ...patch}})
    }

    const updatePlugin = (kind: ModelKind, pluginId: string) => {
        const plugin = pluginsByKind[kind].find(item => item.id === pluginId) ?? null
        const defaultModel = plugin?.default_model ?? plugin?.models[0] ?? null
        if (kind === 'llm') {
            updateLlm({plugin_id: pluginId || null, default_model: defaultModel})
            return
        }
        if (kind === 'image') {
            onChange({...settings, image: {...settings.image, plugin_id: pluginId || null, default_model: defaultModel}})
            return
        }
        onChange({
            ...settings,
            tts: {
                ...settings.tts,
                plugin_id: pluginId || null,
                default_model: defaultModel,
                voice_id: normalizeVoiceIdWithPlugin(plugin, settings.tts.voice_id),
            },
        })
    }

    return (
        <div className="mobile-settings-section mobile-settings-form-stack">
            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">默认模型</h2>
                <div className="mobile-settings-form-stack">
                    <div className="mobile-settings-model-group">
                        <div className="mobile-settings-subtitle">AI 对话</div>
                        <Select
                            value={settings.llm.plugin_id ?? ''}
                            options={pluginOptions(llmPlugins)}
                            placeholder="选择对话插件"
                            radius="full"
                            onValueChange={value => updatePlugin('llm', String(value ?? ''))}
                        />
                        <Select
                            value={settings.llm.default_model ?? ''}
                            options={modelOptions(selectedLlmPlugin)}
                            placeholder="选择默认模型"
                            radius="full"
                            disabled={!selectedLlmPlugin}
                            onValueChange={value => updateLlm({default_model: value ? String(value) : null})}
                        />
                    </div>
                    <div className="mobile-settings-model-group">
                        <div className="mobile-settings-subtitle">AI 绘图</div>
                        <Select
                            value={settings.image.plugin_id ?? ''}
                            options={pluginOptions(imagePlugins)}
                            placeholder="选择绘图插件"
                            radius="full"
                            onValueChange={value => updatePlugin('image', String(value ?? ''))}
                        />
                        <Select
                            value={settings.image.default_model ?? ''}
                            options={modelOptions(selectedImagePlugin)}
                            placeholder="选择默认模型"
                            radius="full"
                            disabled={!selectedImagePlugin}
                            onValueChange={value => onChange({
                                ...settings,
                                image: {...settings.image, default_model: value ? String(value) : null},
                            })}
                        />
                    </div>
                    <div className="mobile-settings-model-group">
                        <div className="mobile-settings-subtitle">AI 语音</div>
                        <Select
                            value={settings.tts.plugin_id ?? ''}
                            options={pluginOptions(ttsPlugins)}
                            placeholder="选择语音插件"
                            radius="full"
                            onValueChange={value => updatePlugin('tts', String(value ?? ''))}
                        />
                        <Select
                            value={settings.tts.default_model ?? ''}
                            options={modelOptions(selectedTtsPlugin)}
                            placeholder="选择默认模型"
                            radius="full"
                            disabled={!selectedTtsPlugin}
                            onValueChange={value => onChange({
                                ...settings,
                                tts: {...settings.tts, default_model: value ? String(value) : null},
                            })}
                        />
                        <Select
                            value={settings.tts.voice_id ?? ''}
                            options={buildTtsVoiceOptions(selectedTtsPlugin, '未选择')}
                            placeholder="选择默认音色"
                            radius="full"
                            disabled={!selectedTtsPlugin || selectedTtsPlugin.supported_voices.length === 0}
                            onValueChange={value => onChange({
                                ...settings,
                                tts: {...settings.tts, voice_id: value ? String(value) : null},
                            })}
                        />
                        <label className="mobile-settings-switch-field">
                            <span>自动播放生成语音</span>
                            <input
                                type="checkbox"
                                checked={settings.tts.auto_play}
                                onChange={event => onChange({
                                    ...settings,
                                    tts: {...settings.tts, auto_play: event.currentTarget.checked},
                                })}
                            />
                        </label>
                    </div>
                </div>
            </section>

            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">文本模型配置</h2>
                <div className="mobile-settings-two-column-fields">
                    <label className="mobile-settings-field-block">
                        <span>温度</span>
                        <Input
                            type="number"
                            min={0}
                            max={CONVERSATION_TEMPERATURE_MAX}
                            step={0.1}
                            value={settings.llm.temperature}
                            radius="full"
                            onValueChange={value => updateLlm({
                                temperature: clampNumber(value, settings.llm.temperature, 0, CONVERSATION_TEMPERATURE_MAX),
                            })}
                        />
                    </label>
                    <label className="mobile-settings-field-block">
                        <span>回答开放度</span>
                        <Input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={settings.llm.top_p}
                            radius="full"
                            onValueChange={value => updateLlm({
                                top_p: clampNumber(value, settings.llm.top_p, 0, 1),
                            })}
                        />
                    </label>
                    <label className="mobile-settings-field-block">
                        <span>重复惩罚</span>
                        <Input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.1}
                            value={settings.llm.frequency_penalty}
                            radius="full"
                            onValueChange={value => updateLlm({
                                frequency_penalty: clampNumber(value, settings.llm.frequency_penalty, -2, 2),
                            })}
                        />
                    </label>
                    <label className="mobile-settings-field-block">
                        <span>存在惩罚</span>
                        <Input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.1}
                            value={settings.llm.presence_penalty}
                            radius="full"
                            onValueChange={value => updateLlm({
                                presence_penalty: clampNumber(value, settings.llm.presence_penalty, -2, 2),
                            })}
                        />
                    </label>
                </div>
            </section>

            <section className="mobile-settings-panel">
                <h2 className="mobile-settings-panel__title">对话上下文</h2>
                <label className="mobile-settings-switch-field">
                    <span>自动精简对话记忆</span>
                    <input
                        type="checkbox"
                        checked={settings.llm.auto_compact_enabled}
                        onChange={event => updateLlm({auto_compact_enabled: event.currentTarget.checked})}
                    />
                </label>
                <p className="mobile-settings-field-hint">接近上下文上限时，先摘要较早对话并保留近期原文。</p>
                {settings.llm.auto_compact_enabled && (
                    <div className="mobile-settings-form-stack">
                        <label className="mobile-settings-range-field">
                            <span>压缩阈值</span>
                            <Slider
                                min={50}
                                max={95}
                                step={5}
                                value={Math.round(settings.llm.auto_compact_threshold_ratio * 100)}
                                onValueChange={value => updateLlm({
                                    auto_compact_threshold_ratio: readSliderNumber(value) / 100,
                                })}
                            />
                            <strong>{Math.round(settings.llm.auto_compact_threshold_ratio * 100)}%</strong>
                        </label>
                        <div className="mobile-settings-two-column-fields">
                            <label className="mobile-settings-field-block">
                                <span>保留近期消息</span>
                                <Input
                                    type="number"
                                    min={2}
                                    max={30}
                                    step={1}
                                    value={settings.llm.auto_compact_recent_messages}
                                    radius="full"
                                    onValueChange={value => updateLlm({
                                        auto_compact_recent_messages: Math.round(clampNumber(
                                            value,
                                            settings.llm.auto_compact_recent_messages,
                                            2,
                                            30,
                                        )),
                                    })}
                                />
                            </label>
                            <label className="mobile-settings-field-block">
                                <span>摘要详细程度</span>
                                <Select
                                    value={settings.llm.auto_compact_detail}
                                    options={[
                                        {value: 'brief', label: '简略'},
                                        {value: 'balanced', label: '适中'},
                                        {value: 'detailed', label: '详细'},
                                    ]}
                                    radius="full"
                                    onValueChange={value => updateLlm({auto_compact_detail: String(value) as LlmCompactDetail})}
                                />
                            </label>
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}
