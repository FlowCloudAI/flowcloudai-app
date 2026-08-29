/*
 * AI「更多」面板里的对话采样参数。
 *
 * 全部改用滑条，且不再放「当前对话独有提示词」文本框：底部面板不承载会唤起键盘的控件，
 * 也不该长到要在面板内滚动（`designs/mobile-ui-baseline.md` §9 规则 8 把本面板列为已知违例）。
 * 对话级提示词本身仍存在于会话数据里，只是移动端不再提供编辑入口，桌面端不受影响。
 */
import {Slider} from 'flowcloudai-ui'
import {CONVERSATION_TEMPERATURE_MAX, type ConversationSettings} from '../../../features/ai-chat/model/AiControllerTypes'

interface Props {
    disabled: boolean
    settings: ConversationSettings
    onTemperature: (value: number) => void
    onTopP: (value: number) => void
    onFrequencyPenalty: (value: number) => void
    onPresencePenalty: (value: number) => void
}

interface FieldProps {
    label: string
    hint?: string
    value: number
    min: number
    max: number
    step: number
    disabled: boolean
    onChange: (value: number) => void
}

function readSliderNumber(value: number | [number, number]): number {
    return Array.isArray(value) ? value[0] : value
}

function MobileAiSettingSlider({label, hint, value, min, max, step, disabled, onChange}: FieldProps) {
    return (
        <div className="mobile-ai-setting-field">
            <span className="mobile-ai-setting-field__head">
                <strong>{label}</strong>
                {hint ? <small>{hint}</small> : null}
                {/* 步长小于 0.1 的档位（开放度）需要两位小数，否则拖动时数字看起来不动。 */}
                <em>{value.toFixed(step < 0.1 ? 2 : 1)}</em>
            </span>
            <Slider
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                aria-label={label}
                onValueChange={next => onChange(readSliderNumber(next))}
            />
        </div>
    )
}

export default function MobileAiConversationControls({
    disabled,
    settings,
    onTemperature,
    onTopP,
    onFrequencyPenalty,
    onPresencePenalty,
}: Props) {
    return (
        <div className="mobile-ai-settings-card" aria-label="对话设置">
            <MobileAiSettingSlider
                label="温度"
                value={settings.temperature}
                min={0}
                max={CONVERSATION_TEMPERATURE_MAX}
                step={0.1}
                disabled={disabled}
                onChange={onTemperature}
            />
            <MobileAiSettingSlider
                label="回答开放度"
                value={settings.topP}
                min={0}
                max={1}
                step={0.05}
                disabled={disabled}
                onChange={onTopP}
            />
            <MobileAiSettingSlider
                label="重复惩罚"
                hint="0 为关闭"
                value={settings.frequencyPenalty}
                min={-2}
                max={2}
                step={0.1}
                disabled={disabled}
                onChange={onFrequencyPenalty}
            />
            <MobileAiSettingSlider
                label="存在惩罚"
                hint="0 为关闭"
                value={settings.presencePenalty}
                min={-2}
                max={2}
                step={0.1}
                disabled={disabled}
                onChange={onPresencePenalty}
            />
        </div>
    )
}
