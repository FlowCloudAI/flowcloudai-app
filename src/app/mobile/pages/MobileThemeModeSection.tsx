/*
 * 明暗主题三选一，每个选项用一张极简的界面缩略图代替文字说明。
 *
 * 缩略图里的底色、面色、线条色是**写死的字面量**，这是有意的：它们要表达
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
    muted: string
}

const LIGHT_PALETTE: ThemeModePalette = {
    bg: '#FFFDFA',
    surface: '#FFFFFF',
    muted: '#D0D0D0',
}

const DARK_PALETTE: ThemeModePalette = {
    bg: '#101010',
    surface: '#282828',
    muted: '#4A4845',
}

/** 缩略图画布。高度压到 32：去掉标题行之后中间空了一截，再留 44 会显得下半张是空的。 */
const MOCK_WIDTH = 64
const MOCK_HEIGHT = 32

/** 斜线两端：从上边偏右走到下边偏左，够斜才不会被误读成一条竖直分栏。 */
const SPLIT_TOP_X = 40
const SPLIT_BOTTOM_X = 24

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
            viewBox={`0 0 ${MOCK_WIDTH} ${MOCK_HEIGHT}`}
            role="img"
            aria-hidden="true"
            preserveAspectRatio="none"
        >
            <MockScreen palette={mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE}/>
            {mode === 'system' && (
                <>
                    <defs>
                        <clipPath id={clipId}>
                            <polygon
                                points={
                                    `${SPLIT_TOP_X},0 ${MOCK_WIDTH},0`
                                    + ` ${MOCK_WIDTH},${MOCK_HEIGHT} ${SPLIT_BOTTOM_X},${MOCK_HEIGHT}`
                                }
                            />
                        </clipPath>
                    </defs>
                    <g clipPath={`url(#${clipId})`}>
                        <MockScreen palette={DARK_PALETTE}/>
                    </g>
                    <line
                        x1={SPLIT_TOP_X}
                        y1={0}
                        x2={SPLIT_BOTTOM_X}
                        y2={MOCK_HEIGHT}
                        className="mobile-theme-mode__split"
                    />
                </>
            )}
        </svg>
    )
}

/** 极简页面：顶栏 + 两行正文 + 一颗按钮，只为让人一眼认出是「一屏界面」。 */
function MockScreen({palette}: {palette: ThemeModePalette}) {
    return (
        <>
            <rect x={0} y={0} width={MOCK_WIDTH} height={MOCK_HEIGHT} fill={palette.bg}/>
            <rect x={0} y={0} width={MOCK_WIDTH} height={8} fill={palette.surface}/>
            {/* 浅色下面色 #FFFFFF 压在底色 #FFFDFA 上几乎看不见，靠这条分隔线撑出顶栏。 */}
            <rect x={0} y={8} width={MOCK_WIDTH} height={0.8} fill={palette.muted}/>
            <rect x={5} y={3} width={13} height={2} rx={1} fill="var(--fc-color-primary)"/>
            <rect x={5} y={13} width={42} height={2} rx={1} fill={palette.muted}/>
            <rect x={5} y={18} width={34} height={2} rx={1} fill={palette.muted}/>
            <rect x={5} y={24} width={15} height={5} rx={2.5} fill="var(--fc-color-primary)"/>
        </>
    )
}
