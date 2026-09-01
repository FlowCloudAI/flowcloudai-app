/*
 * 颜色主题配置的读写与归一，双端共用。
 *
 * 这里只放不认识 DOM 与外壳的纯逻辑：从设置里读出的配置 → 可渲染状态，以及反过来
 * 组装出可持久化的配置。桌面端的令牌编辑器和移动端的配方选择都从这里取，
 * 避免两边各写一套解析和默认值判定——`ThemeColorConfig` 是要写进用户设置的，
 * 两套宽松程度不同的解析会让同一份配置在两端表现不一致。
 *
 * 覆盖 CSS 的生成在 fcThemeRecipe.ts，应用到文档在 fcThemeTokenOverride.ts。
 */

import type {ThemeColorConfig} from '../../api'
import {
    createCustomFcThemeRecipe,
    createFcThemePreview,
    createFcThemeTokenColorValues,
    DEFAULT_FC_THEME_RECIPE_ID,
    FC_THEME_RECIPES,
    getFcThemeCustomValues,
    type FcThemeCustomValues,
    type FcThemePreview,
    type FcThemeRecipe,
    type FcThemeTokenColorPair,
    type FcThemeTokenColorValue,
    type FcThemeTokenColorValues,
} from './fcThemeRecipe'
import {normalizeHexColor} from './materialThemePreview'

export const THEME_CONFIG_VERSION = 3
export const PRIMARY_TOKEN = '--fc-color-primary'

export interface ParsedThemeConfig {
    recipeId: string
    customValues?: FcThemeCustomValues
    primarySeed?: string
    tokenColors?: FcThemeTokenColorValues
}

export interface ThemeColorState {
    recipeId: string
    themeValues: FcThemeCustomValues
    tokenColors: FcThemeTokenColorValues
}

export function resolveThemeColorState(
    config: ThemeColorConfig | null,
    defaultRecipe: FcThemeRecipe,
    defaultValues: FcThemeCustomValues,
): ThemeColorState {
    const fallbackTokenColors = createTokenColors(defaultRecipe, defaultValues)
    if (!config) {
        return {
            recipeId: defaultRecipe.id,
            themeValues: defaultValues,
            tokenColors: fallbackTokenColors,
        }
    }

    const parsed = parseThemeConfig(config)
    const recipe = parsed
        ? FC_THEME_RECIPES.find((item) => item.id === parsed.recipeId)
        : null
    if (!parsed || !recipe) {
        return {
            recipeId: defaultRecipe.id,
            themeValues: defaultValues,
            tokenColors: fallbackTokenColors,
        }
    }

    const themeValues = parsed.customValues ?? {
        ...getFcThemeCustomValues(recipe),
        primarySeed: parsed.primarySeed ?? recipe.primarySeed,
    }
    const tokenColors = normalizeTokenColorsForPreview(
        parsed.tokenColors ?? createTokenColors(recipe, themeValues),
        createPreviewForValues(recipe, themeValues),
    )
    return {
        recipeId: recipe.id,
        themeValues,
        tokenColors,
    }
}

/**
 * 组装可持久化的配置；默认配方返回 `null`。
 *
 * 默认配方之所以存空值而不是存它自己那份令牌，是因为「没配过」和「选了默认」
 * 应当走同一条渲染路径（都不注入覆盖），否则默认配方的产出与 lib_ui 的基线值
 * 不完全相等，切回默认会看起来没切干净。
 *
 * 值不合法时返回 `'invalid'`，让调用方能区分「该存空」和「别存」。
 */
export function buildThemeColorConfig(
    recipeId: string,
    values: FcThemeCustomValues,
    tokenColors: FcThemeTokenColorValues,
): ThemeColorConfig | null | 'invalid' {
    const normalizedValues = normalizeThemeValues(values)
    const recipe = FC_THEME_RECIPES.find((item) => item.id === recipeId)
    const preview = recipe && normalizedValues
        ? createPreviewForValues(recipe, normalizedValues)
        : null
    if (!recipe || !normalizedValues || !preview) return 'invalid'
    if (recipe.id === DEFAULT_FC_THEME_RECIPE_ID) return null

    return {
        version: THEME_CONFIG_VERSION,
        recipeId: recipe.id,
        customValues: normalizedValues,
        tokenColors: normalizeTokenColorsForPreview(tokenColors, preview),
    }
}

export function parseThemeConfig(value: unknown): ParsedThemeConfig | null {
    if (!isRecord(value) || typeof value.recipeId !== 'string') return null

    if (value.version === 1 && typeof value.seedColor === 'string') {
        const primarySeed = normalizeHexColor(value.seedColor)
        return primarySeed ? {recipeId: value.recipeId, primarySeed} : null
    }

    if (value.version === 2) {
        const customValues = parseThemeValues(value.customValues)
        return customValues ? {recipeId: value.recipeId, customValues} : null
    }

    if (value.version !== THEME_CONFIG_VERSION) return null
    const customValues = parseThemeValues(value.customValues)
    const tokenColors = parseTokenColors(value.tokenColors)
    return customValues && tokenColors ? {recipeId: value.recipeId, customValues, tokenColors} : null
}

export function parseThemeValues(value: unknown): FcThemeCustomValues | null {
    if (!isRecord(value)) return null
    const primarySeed = typeof value.primarySeed === 'string' ? normalizeHexColor(value.primarySeed) : null
    const neutralSeed = typeof value.neutralSeed === 'string' ? normalizeHexColor(value.neutralSeed) : null
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(value.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(value.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(value.neutralVariantChroma, 10, 0, 24),
    }
}

export function parseTokenColors(value: unknown): FcThemeTokenColorValues | null {
    if (!isRecord(value)) return null
    const entries = Object.entries(value).flatMap(([token, pair]) => {
        const parsedPair = parseTokenColorPair(pair)
        return parsedPair ? [[token, parsedPair] as const] : []
    })
    return entries.length > 0 ? Object.fromEntries(entries) : null
}

function parseTokenColorPair(value: unknown): FcThemeTokenColorPair | null {
    if (!isRecord(value)) return null
    const light = parseTokenColorValue(value.light)
    const dark = parseTokenColorValue(value.dark)
    return light && dark ? {light, dark} : null
}

function parseTokenColorValue(value: unknown): FcThemeTokenColorValue | null {
    if (typeof value === 'string') {
        const hex = normalizeHexColor(value)
        return hex ? {hex, css: hex} : null
    }
    if (!isRecord(value) || typeof value.hex !== 'string') return null
    const hex = normalizeHexColor(value.hex)
    if (!hex) return null
    const css = typeof value.css === 'string' && isSafeTokenCss(value.css, hex)
        ? value.css
        : hex
    return {hex, css}
}

export function normalizeThemeValues(values: FcThemeCustomValues): FcThemeCustomValues | null {
    const primarySeed = normalizeHexColor(values.primarySeed)
    const neutralSeed = normalizeHexColor(values.neutralSeed)
    if (!primarySeed || !neutralSeed) return null
    return {
        primarySeed,
        primarySurfaceChroma: normalizeChroma(values.primarySurfaceChroma, 10, 0, 24),
        neutralSeed,
        neutralChroma: normalizeChroma(values.neutralChroma, 5, 0, 16),
        neutralVariantChroma: normalizeChroma(values.neutralVariantChroma, 10, 0, 24),
    }
}

export function normalizeTokenColorsForPreview(
    tokenColors: FcThemeTokenColorValues,
    preview: FcThemePreview | null,
): FcThemeTokenColorValues {
    if (!preview) return tokenColors
    return Object.fromEntries(Object.entries(tokenColors).map(([token, pair]) => {
        const tokenPreview = preview.tokens.find((item) => item.token === token)
        return [token, tokenPreview?.modeInvariant ? {...pair, dark: pair.light} : pair]
    }))
}

export function createTokenColors(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemeTokenColorValues {
    const preview = createPreviewForValues(recipe, values)
    return preview ? createFcThemeTokenColorValues(preview) : {}
}

export function createPreviewForValues(recipe: FcThemeRecipe, values: FcThemeCustomValues): FcThemePreview | null {
    return createFcThemePreview(createCustomFcThemeRecipe(recipe, values))
}

export function getPrimaryTokenColor(tokenColors: FcThemeTokenColorValues, fallback: string): string {
    return normalizeHexColor(tokenColors[PRIMARY_TOKEN]?.light.hex)
        ?? normalizeHexColor(fallback)
        ?? '#4B78FF'
}

function normalizeChroma(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? clampNumber(Math.round(numeric), min, max) : fallback
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 只放行预览自己会产出的两种形态，挡住从导入文件带进来的任意 CSS。 */
function isSafeTokenCss(value: string, hex: string): boolean {
    return value === hex || /^color-mix\(in srgb, #[0-9A-F]{6} \d{1,3}%, transparent\)$/u.test(value)
}
