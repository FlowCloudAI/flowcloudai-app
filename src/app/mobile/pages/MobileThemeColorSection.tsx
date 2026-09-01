/*
 * 移动端颜色主题（配方）选择。
 *
 * 版式沿用桌面端的预设卡：上排名称与默认徽章，下排整条色带，选中用主色描边加
 * 主色弱底。区别在色带内容——桌面端画的是「底色 + 主色」，而配方的背景令牌在移动端
 * 不生效（见 fcThemeRecipe 的 FC_THEME_DESKTOP_SCOPE），画底色等于承诺一个不会发生的
 * 变化，所以这里换成移动端真正会变的三档：主色、边框、次级文字。
 *
 * 只做「换配方」，不含桌面端那套逐令牌编辑：46 个取色输入在 375px 上排不下，
 * 而且 Android WebView 自带的取色器只有 8 个固定色块 + 一个「自定义」二级入口
 * （2026-09-01 真机实测）。
 *
 * 选中态由 `value` 直接推导而不另存一份 state：设置是父组件持有的唯一真值，
 * 本地再存一份就要写同步 effect，那正是桌面端组件里最难读的一段。
 */

import {useEffect, useMemo, type CSSProperties} from 'react'
import {useTheme} from 'flowcloudai-ui'
import type {ThemeColorConfig} from '../../../api'
import {logger} from '../../../shared/logger'
import {
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    getFcThemeCustomValues,
    getFcThemeRecipe,
} from '../../../features/settings/fcThemeRecipe'
import {
    applyFcThemeTokenOverride,
    clearFcThemeTokenOverride,
} from '../../../features/settings/fcThemeTokenOverride'
import {
    buildThemeColorConfig,
    createPreviewForValues,
    createTokenColors,
    resolveThemeColorState,
} from '../../../features/settings/themeColorState'
import './MobileThemeColorSection.css'

type ColorVariableStyle = CSSProperties & Record<string, string>

/** 色带三档，顺序即从左到右：主色最显眼，后两档说明中性色跟着配方偏暖还是偏冷。 */
const SWATCH_TOKENS = ['--fc-color-primary', '--fc-color-border', '--fc-color-text-secondary'] as const

interface MobileThemeColorSectionProps {
    value: ThemeColorConfig | null
    onChange: (config: ThemeColorConfig | null) => void
}

export default function MobileThemeColorSection({value, onChange}: MobileThemeColorSectionProps) {
    const {resolvedTheme} = useTheme()
    const defaultRecipe = useMemo(() => getFcThemeRecipe(DEFAULT_FC_THEME_RECIPE_ID), [])
    const defaultValues = useMemo(() => getFcThemeCustomValues(defaultRecipe), [defaultRecipe])
    const state = useMemo(
        () => resolveThemeColorState(value, defaultRecipe, defaultValues),
        [defaultRecipe, defaultValues, value],
    )
    const selectedRecipe = getFcThemeRecipe(state.recipeId)
    const isDefaultTheme = state.recipeId === DEFAULT_FC_THEME_RECIPE_ID
    const preview = useMemo(
        () => (isDefaultTheme ? null : createPreviewForValues(selectedRecipe, state.themeValues)),
        [isDefaultTheme, selectedRecipe, state.themeValues],
    )

    /*
     * 覆盖是文档级 `<style>`，离开设置页也应当留着，所以没有清理函数——
     * 只有「切回默认」才清，那条走的是下面 clear 分支而不是卸载。
     */
    useEffect(() => {
        if (!preview) {
            clearFcThemeTokenOverride()
            return
        }
        applyFcThemeTokenOverride(preview, state.tokenColors)
    }, [preview, state.tokenColors])

    const selectRecipe = (nextRecipeId: string) => {
        /*
         * 和「存进设置的那个 id」比，而不是和推导出的选中态比：配方被下架后
         * （例如 2026-09-01 去掉的琥珀）设置里会留一个解析不出来的 id，界面已经
         * 回落显示默认。此时点默认卡若因「看起来没变」提前返回，那条陈旧配置就永远清不掉。
         */
        const persistedRecipeId = value?.recipeId ?? DEFAULT_FC_THEME_RECIPE_ID
        if (nextRecipeId === persistedRecipeId) return

        const nextRecipe = getFcThemeRecipe(nextRecipeId)
        const nextValues = getFcThemeCustomValues(nextRecipe)
        const nextConfig = buildThemeColorConfig(
            nextRecipe.id,
            nextValues,
            createTokenColors(nextRecipe, nextValues),
        )
        if (nextConfig === 'invalid') {
            logger.warn('[MobileThemeColor] 配方无法生成有效配置，跳过', {nextRecipeId})
            return
        }
        logger.info('[MobileThemeColor] 切换颜色主题配方', {
            previousRecipeId: persistedRecipeId,
            nextRecipeId: nextRecipe.id,
            persistedAsDefault: nextConfig === null,
        })
        onChange(nextConfig)
    }

    return (
        <div className="mobile-theme-color">
            <div className="mobile-settings-field-label">颜色主题</div>
            <div className="mobile-theme-color__grid" role="group" aria-label="颜色主题配方">
                {FC_THEME_RECIPES.map(recipe => {
                    const active = recipe.id === state.recipeId
                    return (
                        <button
                            key={recipe.id}
                            type="button"
                            className={`mobile-theme-color__card${active ? ' mobile-theme-color__card--active' : ''}`}
                            aria-pressed={active}
                            onClick={() => selectRecipe(recipe.id)}
                        >
                            <span className="mobile-theme-color__header">
                                <span className="mobile-theme-color__name">{recipe.label}</span>
                                {recipe.id === DEFAULT_FC_THEME_RECIPE_ID && (
                                    <span className="mobile-theme-color__badge">默认</span>
                                )}
                                {/* 选中不能只靠描边颜色，勾选标记是给色觉障碍与强光下的非颜色提示。 */}
                                {active && <span className="mobile-theme-color__check" aria-hidden="true">✓</span>}
                            </span>
                            <span className="mobile-theme-color__swatches" aria-hidden="true">
                                {getPresetSwatches(recipe.id, resolvedTheme === 'dark').map((color, index) => (
                                    <span
                                        /* 定长静态色带，位置即身份；排序发生在取值时，渲染期不会重排。 */
                                        key={index}
                                        className="mobile-theme-color__swatch"
                                        style={swatchStyle(color)}
                                    />
                                ))}
                            </span>
                        </button>
                    )
                })}
            </div>
            <p className="mobile-theme-color__hint">
                {selectedRecipe.description}底色保持中性，只换主色、边框与文字。
            </p>
        </div>
    )
}

function swatchStyle(color: string): ColorVariableStyle {
    return {'--mobile-theme-color-swatch': color}
}

/*
 * 配方色带取自配方自己的预览，保证卡片画的就是点下去会得到的颜色。
 *
 * FC_THEME_RECIPES 是静态的，预览一次算完缓存住；每次渲染重算要跑 5 遍
 * Material 调色板推导，而这块在设置页每次滚动都会重绘。
 */
let presetSwatchCache: Map<string, {light: string[]; dark: string[]}> | null = null

function getPresetSwatches(recipeId: string, dark: boolean): string[] {
    if (!presetSwatchCache) {
        presetSwatchCache = new Map(FC_THEME_RECIPES.map(recipe => {
            const preview = createPreviewForValues(recipe, getFcThemeCustomValues(recipe))
            const pick = (mode: 'light' | 'dark') => {
                const [primary, ...neutrals] = SWATCH_TOKENS.map(token => {
                    const item = preview?.tokens.find(entry => entry.token === token)
                    // 取不到就退回配方种子：宁可画一个近似色，也不要留一格透明的空白。
                    return item?.[mode].hex ?? recipe.primarySeed
                })
                /*
                 * 两格中性色按明度从亮到暗排，色带才是一条渐次收深的坡。
                 * 不能按令牌固定顺序：边框在浅色下比次级文字浅、在深色下比它深，
                 * 写死顺序会让其中一个模式的中间那格夹在两个更亮的格子之间，看着像断了一块。
                 */
                return [primary, ...neutrals.sort((a, b) => relativeLuminance(b) - relativeLuminance(a))]
            }
            return [recipe.id, {light: pick('light'), dark: pick('dark')}]
        }))
    }
    const entry = presetSwatchCache.get(recipeId)
    if (!entry) return []
    return dark ? entry.dark : entry.light
}

/** 只用于色带排序，不参与对比度判定，所以不必处理 hex 以外的写法。 */
function relativeLuminance(hex: string): number {
    const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    const [r, g, b] = channels.map(value => (
        value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
