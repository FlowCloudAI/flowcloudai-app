/*
 * 明暗主题选项的界面缩略图，桌面与移动共用。
 *
 * 缩略图里的底色、面色、线条色是**写死的字面量**，这是有意的：它们要表达
 * 「选了这项之后长什么样」，跟着当前主题走就全变成同一个颜色，三个选项会一模一样。
 * 取值对齐 flowcloudai-ui 的浅色/深色基线；只有强调色用 var(--fc-color-primary)，
 * 让缩略图跟着当前颜色主题走——那一档确实是「现在选的配色」而不是「候选项」。
 *
 * 「跟随系统」用一条斜线把同一张缩略图劈成左浅右深，而不是并排两张小图：
 * 在移动端 375px 上并排会把每张压到辨认不出结构。
 *
 * 组件只负责画图与自身宽高比；选中描边、标签、排布由各壳自己的样式决定。
 */

import {useId} from 'react'
import './ThemeModePreview.css'

export type ThemeModeValue = 'system' | 'light' | 'dark'

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

/** 缩略图画布。高度取 32：内容只有顶栏、两行正文和一颗按钮，再高下半张会显得是空的。 */
const MOCK_WIDTH = 64
const MOCK_HEIGHT = 32

/** 斜线两端：从上边偏右走到下边偏左，够斜才不会被误读成一条竖直分栏。 */
const SPLIT_TOP_X = 40
const SPLIT_BOTTOM_X = 24

export default function ThemeModePreview({mode}: {mode: string}) {
    // clipPath 的 id 在文档内必须唯一，三个选项同时在场，不能写常量。
    const clipId = useId()

    return (
        <svg
            className="fc-theme-mode-preview"
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
                        className="fc-theme-mode-preview__split"
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
