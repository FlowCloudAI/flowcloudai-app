/*
 * 移动端颜色主题（配方）选择。
 *
 * 只做「换配方」，不含桌面端那套逐令牌编辑：46 个取色输入在 375px 上排不下，
 * 而且 Android WebView 自带的取色器只有 8 个固定色块 + 一个「自定义」二级入口，
 * 不适合逐项微调（2026-09-01 真机实测）。
 *
 * 配方的四个背景令牌在移动端不生效（见 fcThemeRecipe 的 FC_THEME_DESKTOP_SCOPE），
 * 所以这里换的是主色、边框、文字与滚动条；底色始终保持中性。
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
    resolveThemeColorState,
} from '../../../features/settings/themeColorState'
import './MobileThemeColorSection.css'

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
        if (nextRecipeId === state.recipeId) return
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
            previousRecipeId: state.recipeId,
            nextRecipeId: nextRecipe.id,
            persistedAsDefault: nextConfig === null,
        })
        onChange(nextConfig)
    }

    return (
        <div className="mobile-theme-color">
            <div className="mobile-settings-field-label">颜色主题</div>
            <div className="mobile-theme-color__grid" role="group" aria-label="颜色主题配方">
                {FC_THEME_RECIPES.map(recipe => (
                    <button
                        key={recipe.id}
                        type="button"
                        className="mobile-theme-color__card"
                        style={cardStyle(recipe.primarySeed)}
                        aria-pressed={recipe.id === state.recipeId}
                        onClick={() => selectRecipe(recipe.id)}
                    >
                        <span className="mobile-theme-color__dot" aria-hidden="true"/>
                        <span className="mobile-theme-color__name">{recipe.label}</span>
                        {recipe.id === DEFAULT_FC_THEME_RECIPE_ID && (
                            <span className="mobile-theme-color__badge">默认</span>
                        )}
                        {/* 选中不能只靠描边颜色，勾选标记是给色觉障碍与强光下的非颜色提示。 */}
                        <span className="mobile-theme-color__check" aria-hidden="true">✓</span>
                    </button>
                ))}
            </div>
            <p className="mobile-theme-color__hint">
                {selectedRecipe.description}底色保持中性，只换主色、边框与文字。
            </p>
        </div>
    )
}

/** 卡片只用配方的主色种子做身份标识：默认配方的种子正好等于 lib_ui 的基线主色。 */
function cardStyle(primarySeed: string): ColorVariableStyle {
    return {'--mobile-theme-color-seed': primarySeed}
}
