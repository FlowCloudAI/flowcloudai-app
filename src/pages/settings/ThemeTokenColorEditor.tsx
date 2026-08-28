import {useState} from 'react'
import {
    type FcThemeTokenColorValues,
    type FcThemeTokenPreview,
} from './fcThemeRecipe'
import {normalizeHexColor} from './materialThemePreview'

export type TokenColorMode = 'light' | 'dark' | 'both'

interface ThemeTokenColorEditorProps {
    tokens: FcThemeTokenPreview[]
    values: FcThemeTokenColorValues
    onChange: (token: string, mode: TokenColorMode, color: string) => void
}

const TOKEN_GROUPS: Array<FcThemeTokenPreview['group']> = ['主色', '背景', '边框', '滚动条', '文字']

export default function ThemeTokenColorEditor({
    tokens,
    values,
    onChange,
}: ThemeTokenColorEditorProps) {
    const [activeGroup, setActiveGroup] = useState<FcThemeTokenPreview['group']>('主色')
    const availableGroups = TOKEN_GROUPS.filter((group) => tokens.some((item) => item.group === group))
    const currentGroup = availableGroups.includes(activeGroup) ? activeGroup : availableGroups[0]
    const groupTokens = currentGroup ? tokens.filter((item) => item.group === currentGroup) : []

    if (!currentGroup) return null

    return (
        <div className="theme-color-preview__token-editor">
            <div className="theme-color-preview__token-editor-header">
                <strong>FC 主题令牌颜色</strong>
            </div>
            <div className="theme-color-preview__token-tabs" role="tablist" aria-label="令牌分组">
                {availableGroups.map((group) => {
                    const count = tokens.filter((item) => item.group === group).length
                    const active = group === currentGroup
                    return (
                        <button
                            key={group}
                            className={`theme-color-preview__token-tab ${active ? 'theme-color-preview__token-tab--active' : ''}`}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setActiveGroup(group)}
                        >
                            <span>{group}</span>
                            <small>{count}</small>
                        </button>
                    )
                })}
            </div>
            <section className="theme-color-preview__token-table" aria-label={`${currentGroup}颜色令牌`}>
                <div className="theme-color-preview__token-table-head" aria-hidden="true">
                    <span>用途</span>
                    <span>浅色 / 通用</span>
                    <span>深色</span>
                </div>
                <div className="theme-color-preview__token-table-body">
                    {groupTokens.map((item) => (
                        <div
                            className="theme-color-preview__token-row"
                            key={item.token}
                            title={item.token}
                        >
                            <div className="theme-color-preview__token-meta">
                                <strong>{item.label}</strong>
                                <span>{item.modeInvariant ? '通用' : '浅色 / 深色'}</span>
                            </div>
                            <TokenColorInput
                                label={item.modeInvariant ? '通用' : '浅色'}
                                color={values[item.token]?.light.hex ?? item.light.hex}
                                onChange={(color) => onChange(item.token, item.modeInvariant ? 'both' : 'light', color)}
                            />
                            {item.modeInvariant ? (
                                <span className="theme-color-preview__token-shared-note">跟随通用色</span>
                            ) : (
                                <TokenColorInput
                                    label="深色"
                                    color={values[item.token]?.dark.hex ?? item.dark.hex}
                                    onChange={(color) => onChange(item.token, 'dark', color)}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}

function TokenColorInput({
    label,
    color,
    onChange,
}: {
    label: string
    color: string
    onChange: (color: string) => void
}) {
    const normalizedColor = normalizeHexColor(color) ?? '#000000'

    const updateByText = (value: string) => {
        const normalized = normalizeHexColor(value)
        if (normalized) onChange(normalized)
    }

    return (
        <div className="theme-color-preview__token-color" title={`${label}: ${normalizedColor}`}>
            <span className="theme-color-preview__token-color-label">{label}</span>
            <input
                className="theme-color-preview__token-color-input"
                type="color"
                value={normalizedColor}
                aria-label={`${label}颜色`}
                onChange={(event) => onChange(event.target.value)}
            />
            <input
                className="theme-color-preview__token-hex-input"
                value={normalizedColor}
                aria-label={`${label}十六进制颜色`}
                onChange={(event) => updateByText(event.target.value)}
                spellCheck={false}
            />
        </div>
    )
}
