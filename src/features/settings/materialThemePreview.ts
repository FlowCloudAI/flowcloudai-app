import {
    argbFromHex,
    Hct,
    hexFromArgb,
    themeFromSourceColor,
    type Scheme,
    type TonalPalette,
} from '@material/material-color-utilities'

export type MaterialThemeMode = 'light' | 'dark'

export interface MaterialToneSwatch {
    tone: number
    hex: string
}

export interface MaterialPalettePreview {
    key: string
    label: string
    hue: number
    chroma: number
    tones: MaterialToneSwatch[]
}

export interface MaterialRolePreview {
    key: string
    label: string
    hex: string
}

export interface MaterialSchemePreview {
    mode: MaterialThemeMode
    label: string
    roles: MaterialRolePreview[]
}

export interface MaterialThemePreview {
    source: {
        hex: string
        hue: number
        chroma: number
        tone: number
    }
    palettes: MaterialPalettePreview[]
    schemes: Record<MaterialThemeMode, MaterialSchemePreview>
}

const MATERIAL_TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]

const PALETTE_CONFIG = [
    {key: 'primary', label: 'Primary'},
    {key: 'secondary', label: 'Secondary'},
    {key: 'tertiary', label: 'Tertiary'},
    {key: 'neutral', label: 'Neutral'},
    {key: 'neutralVariant', label: 'Neutral Variant'},
    {key: 'error', label: 'Error'},
] as const

const ROLE_CONFIG = [
    {key: 'primary', label: 'Primary'},
    {key: 'onPrimary', label: 'On Primary'},
    {key: 'primaryContainer', label: 'Primary Container'},
    {key: 'onPrimaryContainer', label: 'On Primary Container'},
    {key: 'secondary', label: 'Secondary'},
    {key: 'secondaryContainer', label: 'Secondary Container'},
    {key: 'tertiary', label: 'Tertiary'},
    {key: 'tertiaryContainer', label: 'Tertiary Container'},
    {key: 'surface', label: 'Surface'},
    {key: 'surfaceVariant', label: 'Surface Variant'},
    {key: 'onSurface', label: 'On Surface'},
    {key: 'onSurfaceVariant', label: 'On Surface Variant'},
    {key: 'outline', label: 'Outline'},
    {key: 'outlineVariant', label: 'Outline Variant'},
    {key: 'error', label: 'Error'},
    {key: 'errorContainer', label: 'Error Container'},
] as const

type PaletteKey = typeof PALETTE_CONFIG[number]['key']
type RoleKey = typeof ROLE_CONFIG[number]['key']

export function normalizeHexColor(input: string): string | null {
    const value = input.trim()
    const shortMatch = /^#?([0-9a-fA-F]{3})$/.exec(value)
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].split('')
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
    }

    const fullMatch = /^#?([0-9a-fA-F]{6})$/.exec(value)
    if (!fullMatch) return null
    return `#${fullMatch[1]}`.toUpperCase()
}

export function isValidHexColor(input: string): boolean {
    return normalizeHexColor(input) !== null
}

export function generateMaterialThemePreview(seedColor: string): MaterialThemePreview | null {
    const sourceHex = normalizeHexColor(seedColor)
    if (!sourceHex) return null

    const sourceArgb = argbFromHex(sourceHex)
    const theme = themeFromSourceColor(sourceArgb)
    const sourceHct = Hct.fromInt(sourceArgb)

    return {
        source: {
            hex: sourceHex,
            hue: roundColorMetric(sourceHct.hue),
            chroma: roundColorMetric(sourceHct.chroma),
            tone: roundColorMetric(sourceHct.tone),
        },
        palettes: PALETTE_CONFIG.map(({key, label}) =>
            createPalettePreview(key, label, theme.palettes[key]),
        ),
        schemes: {
            light: createSchemePreview('light', '浅色角色', theme.schemes.light),
            dark: createSchemePreview('dark', '深色角色', theme.schemes.dark),
        },
    }
}

function createPalettePreview(
    key: PaletteKey,
    label: string,
    palette: TonalPalette,
): MaterialPalettePreview {
    return {
        key,
        label,
        hue: roundColorMetric(palette.hue),
        chroma: roundColorMetric(palette.chroma),
        tones: MATERIAL_TONES.map((tone) => ({
            tone,
            hex: hexFromArgb(palette.tone(tone)).toUpperCase(),
        })),
    }
}

function createSchemePreview(
    mode: MaterialThemeMode,
    label: string,
    scheme: Scheme,
): MaterialSchemePreview {
    const schemeJson = scheme.toJSON()
    return {
        mode,
        label,
        roles: ROLE_CONFIG.map(({key, label: roleLabel}) => ({
            key,
            label: roleLabel,
            hex: hexFromArgb(schemeJson[key as RoleKey]).toUpperCase(),
        })),
    }
}

function roundColorMetric(value: number): number {
    return Math.round(value * 10) / 10
}
