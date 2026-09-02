import {
    argbFromHex,
    Hct,
    hexFromArgb,
    themeFromSourceColor,
    TonalPalette,
} from '@material/material-color-utilities'
import {normalizeHexColor, type MaterialToneSwatch} from './materialThemePreview'

const MATERIAL_THEME_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 97, 99, 100] as const

type FcThemeLightProfile = 'default' | 'soft' | 'warm'
type FcThemePaletteKey = 'primary' | 'primarySurface' | 'neutral' | 'neutralVariant'
type MaterialThemeTone = typeof MATERIAL_THEME_TONES[number]

export interface FcThemeRecipe {
    id: string
    label: string
    description: string
    primarySeed: string
    primarySurfaceChroma: number
    neutralSeed: string
    neutralChroma: number
    neutralVariantChroma: number
    lightProfile: FcThemeLightProfile
}

export interface FcThemeCustomValues {
    primarySeed: string
    primarySurfaceChroma: number
    neutralSeed: string
    neutralChroma: number
    neutralVariantChroma: number
}

export interface FcThemeTokenValue {
    label: string
    value: string
    swatch: string
    hex: string
    css: string
    alpha?: number
}

export interface FcThemeTokenPreview {
    token: string
    label: string
    group: '主色' | '背景' | '边框' | '文字' | '滚动条'
    modeInvariant: boolean
    light: FcThemeTokenValue
    dark: FcThemeTokenValue
}

export interface FcThemePreview {
    recipe: FcThemeRecipe
    primarySeed: string
    primaryTones: MaterialToneSwatch[]
    neutralTones: MaterialToneSwatch[]
    neutralVariantTones: MaterialToneSwatch[]
    tokens: FcThemeTokenPreview[]
}

export interface FcThemeTokenColorValue {
    hex: string
    css: string
}

export interface FcThemeTokenColorPair {
    light: FcThemeTokenColorValue
    dark: FcThemeTokenColorValue
}

export type FcThemeTokenColorValues = Record<string, FcThemeTokenColorPair>

interface FcThemeTokenRule {
    token: string
    label: string
    group: FcThemeTokenPreview['group']
    palette?: FcThemePaletteKey
    lightPalette?: FcThemePaletteKey
    darkPalette?: FcThemePaletteKey
    lightTone?: number
    lightToneKey?: keyof FcLightToneProfile
    darkTone?: number
    lightAlpha?: number
    darkAlpha?: number
    modeInvariant?: boolean
    kind?: 'onPrimary'
}

interface FcLightToneProfile {
    primarySubtle: number
    bg: number
    bgSecondary: number
    bgTertiary: number
    bgElevated: number
    border: number
    borderLight: number
    borderHover: number
}

export const DEFAULT_FC_THEME_RECIPE_ID = 'liuyun'

const LIGHT_TONE_PROFILES: Record<FcThemeLightProfile, FcLightToneProfile> = {
    default: {
        primarySubtle: 95,
        bg: 99,
        bgSecondary: 97,
        bgTertiary: 95,
        bgElevated: 100,
        border: 90,
        borderLight: 95,
        borderHover: 60,
    },
    soft: {
        primarySubtle: 90,
        bg: 99,
        bgSecondary: 95,
        bgTertiary: 90,
        bgElevated: 100,
        border: 80,
        borderLight: 90,
        borderHover: 50,
    },
    warm: {
        primarySubtle: 90,
        bg: 97,
        bgSecondary: 95,
        bgTertiary: 90,
        bgElevated: 99,
        border: 80,
        borderLight: 90,
        borderHover: 50,
    },
}

export const FC_THEME_RECIPES: FcThemeRecipe[] = [
    {
        id: 'liuyun',
        label: '流云',
        description: '干净微暖的默认蓝调。',
        primarySeed: '#378ADD',
        primarySurfaceChroma: 10,
        neutralSeed: '#F7F4EE',
        neutralChroma: 3.5,
        neutralVariantChroma: 7,
        lightProfile: 'default',
    },
    {
        id: 'ziteng',
        label: '紫藤',
        description: '冷灰紫背景，适合夜间整理设定。',
        primarySeed: '#7C5CE8',
        primarySurfaceChroma: 10,
        neutralSeed: '#F1EDF7',
        neutralChroma: 5,
        neutralVariantChroma: 10,
        lightProfile: 'soft',
    },
    {
        id: 'qingsong',
        label: '青松',
        description: '低饱和青灰，稳定、安静。',
        primarySeed: '#2E7D63',
        primarySurfaceChroma: 8,
        neutralSeed: '#EEF5F1',
        neutralChroma: 5,
        neutralVariantChroma: 11,
        lightProfile: 'soft',
    },
    {
        id: 'wanxia',
        label: '晚霞',
        description: '温暖橙红，适合轻松构思。',
        primarySeed: '#D86B47',
        primarySurfaceChroma: 12,
        neutralSeed: '#F8EFE8',
        neutralChroma: 6,
        neutralVariantChroma: 12,
        lightProfile: 'warm',
    },
    {
        id: 'monlan',
        label: '墨蓝',
        description: '更专注的深蓝灰底色。',
        primarySeed: '#35618F',
        primarySurfaceChroma: 9,
        neutralSeed: '#EEF2F6',
        neutralChroma: 4,
        neutralVariantChroma: 9,
        lightProfile: 'soft',
    },
    /*
     * 中性种子与彩度由 generateFcThemeCustomValues 从主色推出，但 primarySurfaceChroma
     * 与 neutralVariantChroma 从生成的 13 / 16 压到 12：那是现有配方的上限（晚霞），
     * 不压的话绛梅会成为全套里边框最艳的一个，和「中性色跟着配方走但不喧宾夺主」相悖。
     */
    {
        id: 'jiangmei',
        label: '绛梅',
        description: '清冷梅红，适合梳理人物关系。',
        primarySeed: '#C24A78',
        primarySurfaceChroma: 12,
        neutralSeed: '#FFF4F5',
        neutralChroma: 6,
        neutralVariantChroma: 12,
        lightProfile: 'soft',
    },
]

const FC_THEME_TOKEN_RULES: FcThemeTokenRule[] = [
    {token: '--fc-color-primary', label: '主色', group: '主色', palette: 'primary', lightTone: 50, modeInvariant: true},
    {token: '--fc-color-primary-hover', label: '悬停', group: '主色', palette: 'primary', lightTone: 40, modeInvariant: true},
    {token: '--fc-color-primary-active', label: '按下', group: '主色', palette: 'primary', lightTone: 30, modeInvariant: true},
    {token: '--fc-color-primary-subtle', label: '弱背景', group: '主色', palette: 'primary', lightPalette: 'primarySurface', lightToneKey: 'primarySubtle', darkTone: 70, darkAlpha: 12},
    {token: '--fc-color-border-focus', label: '焦点边框', group: '主色', palette: 'primary', lightTone: 50, modeInvariant: true},
    {token: '--fc-color-text-link', label: '链接', group: '主色', palette: 'primary', lightTone: 40, modeInvariant: true},
    {token: '--fc-color-text-link-hover', label: '链接悬停', group: '主色', palette: 'primary', lightTone: 30, modeInvariant: true},
    {token: '--fc-color-text-on-primary', label: '主色上文字', group: '主色', modeInvariant: true, kind: 'onPrimary'},

    {token: '--fc-color-bg', label: '页面背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bg', darkTone: 10},
    {token: '--fc-color-bg-secondary', label: '工作台背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bgSecondary', darkTone: 20},
    {token: '--fc-color-bg-tertiary', label: '悬停背景', group: '背景', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'bgTertiary', darkTone: 20},
    {token: '--fc-color-bg-elevated', label: '浮层背景', group: '背景', palette: 'neutral', lightPalette: 'primarySurface', lightToneKey: 'bgElevated', darkTone: 30},

    {token: '--fc-color-border', label: '边框', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'border', darkTone: 30},
    {token: '--fc-color-border-light', label: '浅边框', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'borderLight', darkTone: 20},
    {token: '--fc-color-border-hover', label: '边框悬停', group: '边框', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'borderHover', darkTone: 50},

    {token: '--fc-color-scrollbar-track', label: '滚动轨道', group: '滚动条', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'bgTertiary', darkTone: 20},
    {token: '--fc-color-scrollbar-thumb', label: '滚动滑块', group: '滚动条', palette: 'neutralVariant', lightPalette: 'primarySurface', lightToneKey: 'border', darkTone: 30},
    {token: '--fc-color-scrollbar-thumb-hover', label: '滑块悬停', group: '滚动条', palette: 'neutral', lightTone: 60, darkTone: 50},
    {token: '--fc-color-scrollbar-thumb-active', label: '滑块滚动', group: '滚动条', palette: 'neutral', lightTone: 40, darkTone: 70},

    {token: '--fc-color-text', label: '正文', group: '文字', palette: 'neutral', lightTone: 10, darkTone: 90},
    {token: '--fc-color-text-secondary', label: '次级文字', group: '文字', palette: 'neutral', lightTone: 40, darkTone: 70},
    {token: '--fc-color-text-tertiary', label: '辅助文字', group: '文字', palette: 'neutral', lightTone: 60, darkTone: 50},
    {token: '--fc-color-text-disabled', label: '禁用文字', group: '文字', palette: 'neutral', lightTone: 70, darkTone: 40},
]

export function getFcThemeRecipe(id: string): FcThemeRecipe {
    return FC_THEME_RECIPES.find((recipe) => recipe.id === id) ?? FC_THEME_RECIPES[0]
}

export function getFcThemeCustomValues(recipe: FcThemeRecipe): FcThemeCustomValues {
    return {
        primarySeed: recipe.primarySeed,
        primarySurfaceChroma: recipe.primarySurfaceChroma,
        neutralSeed: recipe.neutralSeed,
        neutralChroma: recipe.neutralChroma,
        neutralVariantChroma: recipe.neutralVariantChroma,
    }
}

export function createCustomFcThemeRecipe(
    recipe: FcThemeRecipe,
    values: FcThemeCustomValues,
): FcThemeRecipe {
    return {
        ...recipe,
        primarySeed: values.primarySeed,
        primarySurfaceChroma: values.primarySurfaceChroma,
        neutralSeed: values.neutralSeed,
        neutralChroma: values.neutralChroma,
        neutralVariantChroma: values.neutralVariantChroma,
    }
}

export function generateFcThemeCustomValues(
    primarySeed: string,
    baseRecipe: FcThemeRecipe,
): FcThemeCustomValues | null {
    const normalizedPrimary = normalizeHexColor(primarySeed)
    if (!normalizedPrimary) return null

    const primaryHct = Hct.fromInt(argbFromHex(normalizedPrimary))
    const neutralChroma = baseRecipe.lightProfile === 'warm'
        ? clampNumber(Math.round(primaryHct.chroma * 0.12), 5, 8)
        : clampNumber(Math.round(primaryHct.chroma * 0.1), 4, 7)
    const primarySurfaceChroma = clampNumber(Math.round(primaryHct.chroma * 0.22), 8, 14)
    const neutralVariantChroma = clampNumber(primarySurfaceChroma + 3, 9, 18)
    const neutralTone = baseRecipe.lightProfile === 'warm' ? 96 : 97
    const neutralSeed = getToneHex(
        TonalPalette.fromHueAndChroma(primaryHct.hue, neutralChroma),
        neutralTone,
    )

    return {
        primarySeed: normalizedPrimary,
        primarySurfaceChroma,
        neutralSeed,
        neutralChroma,
        neutralVariantChroma,
    }
}

export function createFcThemePreview(
    recipe: FcThemeRecipe,
    primarySeedOverride?: string,
): FcThemePreview | null {
    const primarySeed = normalizeHexColor(primarySeedOverride ?? recipe.primarySeed)
    const neutralSeed = normalizeHexColor(recipe.neutralSeed)
    if (!primarySeed || !neutralSeed) return null

    const primaryTheme = themeFromSourceColor(argbFromHex(primarySeed))
    const primaryHct = Hct.fromInt(argbFromHex(primarySeed))
    const neutralHct = Hct.fromInt(argbFromHex(neutralSeed))
    const primarySurfacePalette = TonalPalette.fromHueAndChroma(primaryHct.hue, recipe.primarySurfaceChroma)
    const neutralPalette = TonalPalette.fromHueAndChroma(neutralHct.hue, recipe.neutralChroma)
    const neutralVariantPalette = TonalPalette.fromHueAndChroma(neutralHct.hue, recipe.neutralVariantChroma)
    const primaryPalette = primaryTheme.palettes.primary
    const primaryTones = createToneSwatches(primaryTheme.palettes.primary)
    const neutralTones = createToneSwatches(neutralPalette)
    const neutralVariantTones = createToneSwatches(neutralVariantPalette)

    return {
        recipe,
        primarySeed,
        primaryTones,
        neutralTones,
        neutralVariantTones,
        tokens: FC_THEME_TOKEN_RULES.map((rule) => createTokenPreview(rule, recipe.lightProfile, {
            primary: primaryPalette,
            primarySurface: primarySurfacePalette,
            neutral: neutralPalette,
            neutralVariant: neutralVariantPalette,
        })),
    }
}

/**
 * 桌面端专属令牌的作用域。
 *
 * 用 `:not([data-fc-density="touch"])` 而不是给移动端另发一份 CSS：密度是 ThemeProvider
 * 在运行时写/删的属性（comfortable 不写属性），选择器跟着它自动切换，
 * 不需要生成侧知道自己在哪个壳里。哪些令牌进这个作用域见 DESKTOP_ONLY_TOKENS。
 */
const FC_THEME_DESKTOP_SCOPE = 'html:root:not([data-fc-density="touch"])'

/*
 * 只在桌面端生效的令牌。
 *
 * 四个背景令牌：移动端整屏几乎只有底色，配方铺满全屏读起来像换了个应用。
 *
 * 三级文字：移动端由 mobileAccessibility.css 别名到次级色（触控密度下的可读性修正），
 * 配方自己的 T60/T50 实测浅色 3.13:1、深色 4.22:1，都低于正文 4.5:1 门槛。
 * 靠 !important 压不住——深色侧覆盖写在 `html:root[data-theme="dark"]`(0,2,1)，
 * 比别名的 `:root[data-fc-density="touch"]`(0,2,0) 特异性更高，浅色能赢、深色赢不了。
 * 干脆不往移动端发这个令牌：别名无人竞争，而它指向的次级色仍然跟着配方走。
 */
const DESKTOP_ONLY_TOKENS = new Set([
    '--fc-color-bg',
    '--fc-color-bg-secondary',
    '--fc-color-bg-tertiary',
    '--fc-color-bg-elevated',
    '--fc-color-text-tertiary',
])

function isDesktopOnlyToken(item: FcThemeTokenPreview): boolean {
    return DESKTOP_ONLY_TOKENS.has(item.token)
}

export function createFcThemeOverrideCss(
    preview: FcThemePreview,
    tokenColors?: FcThemeTokenColorValues,
): string {
    const lightCssOf = (item: FcThemeTokenPreview) =>
        tokenColors?.[item.token]?.light.css ?? item.light.css
    const darkCssOf = (item: FcThemeTokenPreview) => (
        item.modeInvariant
            ? lightCssOf(item)
            : tokenColors?.[item.token]?.dark.css ?? item.dark.css
    )
    const block = (selector: string, tokens: FcThemeTokenPreview[], css: (item: FcThemeTokenPreview) => string) => (
        tokens.length === 0
            ? []
            : [`${selector} {`, ...tokens.map((item) => `  ${item.token}: ${css(item)} !important;`), '}', '']
    )

    const shared = preview.tokens.filter((item) => !isDesktopOnlyToken(item))
    const desktopOnly = preview.tokens.filter(isDesktopOnlyToken)

    return [
        ...block('html:root', shared, lightCssOf),
        ...block('html:root[data-theme="dark"]', shared, darkCssOf),
        ...block(FC_THEME_DESKTOP_SCOPE, desktopOnly, lightCssOf),
        ...block(`${FC_THEME_DESKTOP_SCOPE}[data-theme="dark"]`, desktopOnly, darkCssOf),
    ].join('\n').trimEnd()
}

export function createFcThemeTokenColorValues(preview: FcThemePreview): FcThemeTokenColorValues {
    return Object.fromEntries(preview.tokens.map((item) => [item.token, {
        light: {
            hex: item.light.hex,
            css: item.light.css,
        },
        dark: {
            hex: item.modeInvariant ? item.light.hex : item.dark.hex,
            css: item.modeInvariant ? item.light.css : item.dark.css,
        },
    }]))
}

function createTokenPreview(
    rule: FcThemeTokenRule,
    lightProfile: FcThemeLightProfile,
    palettes: Record<FcThemePaletteKey, TonalPalette>,
): FcThemeTokenPreview {
    if (rule.kind === 'onPrimary') {
        const lightPrimary = getToneHex(palettes.primary, 50)
        const darkPrimary = rule.modeInvariant ? lightPrimary : getToneHex(palettes.primary, 70)
        return {
            token: rule.token,
            label: rule.label,
            group: rule.group,
            modeInvariant: Boolean(rule.modeInvariant),
            light: createStaticTokenValue('自动对比', pickReadableTextColor(lightPrimary)),
            dark: createStaticTokenValue('自动对比', pickReadableTextColor(darkPrimary)),
        }
    }

    const defaultPaletteKey = rule.palette ?? 'primary'
    const lightPaletteKey = rule.lightPalette ?? defaultPaletteKey
    const darkPaletteKey = rule.darkPalette ?? defaultPaletteKey
    const lightPalette = palettes[lightPaletteKey]
    const darkPalette = palettes[darkPaletteKey]
    const lightTone = normalizeThemeTone(resolveLightTone(rule, lightProfile))
    const darkTone = normalizeThemeTone(rule.modeInvariant ? lightTone : rule.darkTone ?? 70)
    const lightHex = getToneHex(lightPalette, lightTone)
    const darkHex = rule.modeInvariant ? lightHex : getToneHex(darkPalette, darkTone)
    return {
        token: rule.token,
        label: rule.label,
        group: rule.group,
        modeInvariant: Boolean(rule.modeInvariant),
        light: createToneTokenValue(`Light ${formatPaletteLabel(lightPaletteKey)} T${lightTone}`, lightHex, rule.lightAlpha),
        dark: createToneTokenValue(`Dark T${darkTone}`, darkHex, rule.darkAlpha),
    }
}

function createToneSwatches(palette: TonalPalette): MaterialToneSwatch[] {
    return MATERIAL_THEME_TONES.map((tone) => ({
        tone,
        hex: hexFromArgb(palette.tone(tone)).toUpperCase(),
    }))
}

function createToneTokenValue(label: string, hex: string, alpha?: number): FcThemeTokenValue {
    const css = formatCssTokenValue(hex, alpha)
    return {
        label,
        value: alpha ? `${hex} / ${alpha}%` : hex,
        swatch: css,
        hex,
        css,
        alpha,
    }
}

function createStaticTokenValue(label: string, hex: string): FcThemeTokenValue {
    return {
        label,
        value: hex,
        swatch: hex,
        hex,
        css: hex,
    }
}

function formatCssTokenValue(hex: string, alpha?: number): string {
    if (!alpha) return hex
    return `color-mix(in srgb, ${hex} ${alpha}%, transparent)`
}

function getToneHex(palette: TonalPalette, tone: number): string {
    return hexFromArgb(palette.tone(tone)).toUpperCase()
}

function resolveLightTone(rule: FcThemeTokenRule, lightProfile: FcThemeLightProfile): number {
    if (rule.lightToneKey) return LIGHT_TONE_PROFILES[lightProfile][rule.lightToneKey]
    return rule.lightTone ?? 50
}

function normalizeThemeTone(tone: number): MaterialThemeTone {
    if (isMaterialThemeTone(tone)) return tone
    return MATERIAL_THEME_TONES.reduce((nearest, item) => (
        Math.abs(item - tone) < Math.abs(nearest - tone) ? item : nearest
    ))
}

function isMaterialThemeTone(tone: number): tone is MaterialThemeTone {
    return MATERIAL_THEME_TONES.some((item) => item === tone)
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function formatPaletteLabel(palette: FcThemePaletteKey): string {
    if (palette === 'primary') return '主色'
    if (palette === 'primarySurface') return '主色柔面'
    if (palette === 'neutralVariant') return '中性变体'
    return '中性'
}

function pickReadableTextColor(backgroundHex: string): string {
    const whiteContrast = contrastRatio(backgroundHex, '#FFFFFF')
    const darkContrast = contrastRatio(backgroundHex, '#111111')
    return whiteContrast >= darkContrast ? '#FFFFFF' : '#111111'
}

function contrastRatio(firstHex: string, secondHex: string): number {
    const first = relativeLuminance(hexToRgb(firstHex))
    const second = relativeLuminance(hexToRgb(secondHex))
    const lighter = Math.max(first, second)
    const darker = Math.min(first, second)
    return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.03928
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hexToRgb(hex: string): [number, number, number] {
    const normalized = normalizeHexColor(hex) ?? '#000000'
    return [
        Number.parseInt(normalized.slice(1, 3), 16),
        Number.parseInt(normalized.slice(3, 5), 16),
        Number.parseInt(normalized.slice(5, 7), 16),
    ]
}
