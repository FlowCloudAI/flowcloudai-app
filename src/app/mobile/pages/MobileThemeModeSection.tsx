/*
 * 明暗主题三选一，每个选项用一张极简的界面缩略图代替文字说明。
 *
 * 缩略图里的底色、面色、文字色是**写死的字面量**，这是有意的：它们要表达
 * 「选了这项之后长什么样」，跟着当前主题走就全变成同一个颜色，三个按钮会一模一样。
 * 取值对齐 flowcloudai-ui 的浅色/深色基线；只有强调色用 var(--fc-color-primary)，
 * 让缩略图跟着当前颜色主题走——那一档确实是「现在选的配色」而不是「候选项」。
 *
 * 「跟随系统」用一条斜线把同一张缩略图劈成左浅右深，而不是并排两张小图：
 * 在 375px 上并排会把每张压到辨认不出结构。
 */

import {useId} from 'react'
import './MobileThemeModeSection.css'

export type MobileThemeMode = 'system' | 'light' | 'dark'

interface ThemeModePalette {
    bg: string
    surface: string
    text: string
    muted: string
}

const LIGHT_PALETTE: ThemeModePalette = {
    bg: '#FFFDFA',
    surface: '#FFFFFF',
    text: '#1A1A1A',
    muted: '#D0D0D0',
}

const DARK_PALETTE: ThemeModePalette = {
    bg: '#101010',
    surface: '#282828',
    text: '#E8E8E6',
    muted: '#4A4845',
}

/** 斜线两端：从上边偏右走到下边偏左，够斜才不会被误读成一条竖直分栏。 */
const SPLIT_TOP_X = 42
const SPLIT_BOTTOM_X = 22

interface MobileThemeModeSectionProps {
    value: string
    options: Array<{value: string; label: string}>
    onChange: (value: MobileThemeMode) => void
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
                            onClick={() => onChange(option.value as MobileThemeMode)}
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

function ThemeModePreview({mode}: {mode: string}) {
    // clipPath 的 id 在文档内必须唯一，三个按钮同时在场，不能写常量。
    const clipId = useId()

    return (
        <svg
            className="mobile-theme-mode__svg"
            viewBox="0 0 64 44"
            role="img"
            aria-hidden="true"
            preserveAspectRatio="none"
        >
            <MockScreen palette={mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE}/>
            {mode === 'system' && (
                <>
                    <defs>
                        <clipPath id={clipId}>
                            <polygon points={`${SPLIT_TOP_X},0 64,0 64,44 ${SPLIT_BOTTOM_X},44`}/>
                        </clipPath>
                    </defs>
                    <g clipPath={`url(#${clipId})`}>
                        <MockScreen palette={DARK_PALETTE}/>
                    </g>
                    <line
                        x1={SPLIT_TOP_X}
                        y1={0}
                        x2={SPLIT_BOTTOM_X}
                        y2={44}
                        className="mobile-theme-mode__split"
                    />
                </>
            )}
        </svg>
    )
}

/** 极简页面：顶栏 + 标题 + 两行正文 + 一颗按钮，只为让人一眼认出是「一屏界面」。 */
function MockScreen({palette}: {palette: ThemeModePalette}) {
    return (
        <>
            <rect x={0} y={0} width={64} height={44} fill={palette.bg}/>
            <rect x={0} y={0} width={64} height={10} fill={palette.surface}/>
            {/* 浅色下面色 #FFFFFF 压在底色 #FFFDFA 上几乎看不见，靠这条分隔线撑出顶栏。 */}
            <rect x={0} y={10} width={64} height={0.8} fill={palette.muted}/>
            <rect x={5} y={4} width={13} height={2} rx={1} fill="var(--fc-color-primary)"/>
            <rect x={5} y={16} width={28} height={3} rx={1.5} fill={palette.text}/>
            <rect x={5} y={24} width={42} height={2} rx={1} fill={palette.muted}/>
            <rect x={5} y={29} width={34} height={2} rx={1} fill={palette.muted}/>
            <rect x={5} y={35} width={15} height={5} rx={2.5} fill="var(--fc-color-primary)"/>
        </>
    )
}
