/*
 * 明暗主题三选一。缩略图本身在 shared/ui/ThemeModePreview（桌面端同一份），
 * 这里只负责三个按钮的排布、选中态与标签。
 */

import ThemeModePreview, {type ThemeModeValue} from '../../../shared/ui/ThemeModePreview'
import './MobileThemeModeSection.css'

interface MobileThemeModeSectionProps {
    value: string
    options: Array<{value: string; label: string}>
    onChange: (value: ThemeModeValue) => void
}

export default function MobileThemeModeSection({value, options, onChange}: MobileThemeModeSectionProps) {
    return (
        <div className="mobile-theme-mode">
            <div className="mobile-settings-field-label">主题</div>
            <div className="mobile-theme-mode__row" role="group" aria-label="明暗主题">
                {options.map(option => {
                    const active = option.value === value
                    return (
                        <button
                            key={option.value}
                            type="button"
                            className={`mobile-theme-mode__item${active ? ' mobile-theme-mode__item--active' : ''}`}
                            aria-pressed={active}
                            onClick={() => onChange(option.value as ThemeModeValue)}
                        >
                            <span className="mobile-theme-mode__preview">
                                <ThemeModePreview mode={option.value}/>
                            </span>
                            <span className="mobile-theme-mode__label">{option.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
