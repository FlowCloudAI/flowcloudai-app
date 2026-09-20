// 本模块描述背景卡片可编辑的受控线性渐变；它与属性适配层使用同一组白名单。

export const BACKGROUND_GRADIENT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const

export const BACKGROUND_GRADIENT_STOPS = [
    {value: 'var(--fc-entry-surface)', label: '页面底色'},
    {value: 'var(--fc-entry-text)', label: '页面文字'},
    {value: 'var(--fc-entry-accent)', label: '页面强调'},
    {value: 'var(--fc-entry-muted)', label: '页面弱化'},
] as const

export const BACKGROUND_GRADIENT_END_STOPS = [
    ...BACKGROUND_GRADIENT_STOPS,
    {value: 'transparent', label: '透明'},
] as const

export interface ControlledBackgroundGradient {
    readonly angle: (typeof BACKGROUND_GRADIENT_ANGLES)[number]
    readonly start: (typeof BACKGROUND_GRADIENT_STOPS)[number]['value']
    readonly end: (typeof BACKGROUND_GRADIENT_END_STOPS)[number]['value']
}

const CONTROLLED_GRADIENT_PATTERN = /^linear-gradient\((\d+)deg, (var\(--fc-entry-(?:surface|text|accent|muted)\)), (transparent|var\(--fc-entry-(?:surface|text|accent|muted)\))\)$/u

export function parseControlledBackgroundGradient(raw: string): ControlledBackgroundGradient | null {
    const match = raw.match(CONTROLLED_GRADIENT_PATTERN)
    if (!match) return null
    const angle = Number(match[1])
    const start = match[2]
    const end = match[3]
    if (!BACKGROUND_GRADIENT_ANGLES.includes(angle as ControlledBackgroundGradient['angle'])) return null
    if (!BACKGROUND_GRADIENT_STOPS.some(option => option.value === start)) return null
    if (!BACKGROUND_GRADIENT_END_STOPS.some(option => option.value === end)) return null
    return {angle, start, end} as ControlledBackgroundGradient
}

export function serializeControlledBackgroundGradient(value: ControlledBackgroundGradient): string {
    if (!BACKGROUND_GRADIENT_ANGLES.includes(value.angle)) throw new TypeError('渐变角度不在受控范围内。')
    if (!BACKGROUND_GRADIENT_STOPS.some(option => option.value === value.start)) {
        throw new TypeError('渐变起始颜色不在受控范围内。')
    }
    if (!BACKGROUND_GRADIENT_END_STOPS.some(option => option.value === value.end)) {
        throw new TypeError('渐变结束颜色不在受控范围内。')
    }
    return `linear-gradient(${value.angle}deg, ${value.start}, ${value.end})`
}
