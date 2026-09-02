/*
 * 移动端颜色主题（配方）选择。
 *
 * 每张卡是一幅配方题图 + 右侧渐变上的名称，六张长得完全一样，默认配方不额外挂标记。
 * 不画色板：配方的背景令牌在移动端不生效
 * （见 fcThemeRecipe 的 FC_THEME_DESKTOP_SCOPE），画底色等于承诺一个不会发生的变化，
 * 而只画主色又不足以说明这套配色的整体调性。题图直接把调性摆出来。
 *
 * 只做「换配方」，不含桌面端那套逐令牌编辑：46 个取色输入在 375px 上排不下，
 * 而且 Android WebView 自带的取色器只有 8 个固定色块 + 一个「自定义」二级入口
 * （2026-09-01 真机实测）。
 *
 * 选中态由 `value` 直接推导而不另存一份 state：设置是父组件持有的唯一真值，
 * 本地再存一份就要写同步 effect，那正是桌面端组件里最难读的一段。
 */

import {useEffect, useMemo, type CSSProperties} from 'react'
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
    getPrimaryTokenColor,
    resolveThemeColorState,
} from '../../../features/settings/themeColorState'
import liuyunArt from '../../../assets/theme-recipes/liuyun.webp'
import zitengArt from '../../../assets/theme-recipes/ziteng.webp'
import qingsongArt from '../../../assets/theme-recipes/qingsong.webp'
import wanxiaArt from '../../../assets/theme-recipes/wanxia.webp'
import monlanArt from '../../../assets/theme-recipes/monlan.webp'
import jiangmeiArt from '../../../assets/theme-recipes/jiangmei.webp'
import './MobileThemeColorSection.css'

/*
 * 每个配方一张 2:1 的题图，卡片比它更宽，右侧用渐变收进 tint，名称压在 tint 上。
 *
 * tint 是各张题图最右侧 3% 的平均色（取自素材本身）。卡片底色用它而不是通用 surface：
 * 题图收边处是浅色，衬在深色卡上会在交界处糊出一条灰带；用题图自己的收边色，
 * 画面到色块之间根本不存在交界。
 *
 * 由此整张卡是按题图自己的浅色世界绘制的，不跟随应用明暗——它展示的是「这套配色
 * 长什么样」，跟着当前主题走六张卡就成了一个样。只有选中描边仍用主色，那是界面状态。
 *
 * 显式列出而不是按 id 拼路径：拼出来的动态 import 打不进构建产物，
 * 而且新增配方时漏配图会在编译期就报出来。
 */
const RECIPE_ART: Record<string, {url: string; tint: string}> = {
    liuyun: {url: liuyunArt, tint: '#E9F2FB'},
    ziteng: {url: zitengArt, tint: '#F2EBFB'},
    qingsong: {url: qingsongArt, tint: '#ECF6EE'},
    wanxia: {url: wanxiaArt, tint: '#FCE9DD'},
    monlan: {url: monlanArt, tint: '#E5EDF7'},
    jiangmei: {url: jiangmeiArt, tint: '#FCEBEC'},
}

/*
 * 六种 tint 都很浅，名称统一用这一档深墨。写在这里而不是 CSS：
 * 移动端 CSS 基线禁止颜色字面量，而这个值恰恰不能是随主题翻转的 token——
 * 底色永远是浅的，文字就永远得是深的。
 */
const ART_INK = '#1A1A1A'

type ColorVariableStyle = CSSProperties & Record<string, string>

interface MobileThemeColorSectionProps {
    value: ThemeColorConfig | null
    onChange: (config: ThemeColorConfig | null) => void
}

export default function MobileThemeColorSection({value, onChange}: MobileThemeColorSectionProps) {
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
     * 选中卡的名称要用「这个配方自己的主色」，不能读 --fc-color-primary：
     * 那是当前生效主题的主色，而默认配方压根不注入覆盖，深色模式下它是 lib_ui 的
     * 基线亮蓝，压在浅色题图上读不清（2026-09-02 实测 2.4:1）。
     *
     * state.tokenColors 里已经有算好的值——默认配方走的是 resolveThemeColorState
     * 的 fallback 分支，同样算过一遍，这里不额外跑 Material 色彩管线。
     */
    const activeAccent = getPrimaryTokenColor(state.tokenColors, selectedRecipe.primarySeed)

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
            <div
                className="mobile-theme-color__grid"
                style={{'--mobile-theme-color-accent': activeAccent} as ColorVariableStyle}
                role="group"
                aria-label="颜色主题配方"
            >
                {FC_THEME_RECIPES.map(recipe => {
                    const active = recipe.id === state.recipeId
                    return (
                        <button
                            key={recipe.id}
                            type="button"
                            className={`mobile-theme-color__card${active ? ' mobile-theme-color__card--active' : ''}`}
                            style={cardStyle(RECIPE_ART[recipe.id])}
                            aria-pressed={active}
                            onClick={() => selectRecipe(recipe.id)}
                        >
                            <span className="mobile-theme-color__caption">
                                <span className="mobile-theme-color__name">{recipe.label}</span>
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

function cardStyle(art: {url: string; tint: string} | undefined): ColorVariableStyle {
    // 缺图时留空，卡片退回通用 surface，不会画出一个坏掉的 url()。
    if (!art) return {}
    return {
        '--mobile-theme-color-art': `url("${art.url}")`,
        '--mobile-theme-color-tint': art.tint,
        '--mobile-theme-color-ink': ART_INK,
    }
}
