// 本模块识别会破坏独立文本选区语义的 CSS 伪元素；guard 与 AI 策略共享同一判定。
export const VISUAL_TEXT_PSEUDO_ELEMENTS = ['first-letter', 'first-line'] as const

const VISUAL_TEXT_PSEUDO_PATTERN = /::(first-letter|first-line)\b/giu

export function visualTextPseudoElements(selector: string): string[] {
    return [
        ...new Set(
            [...selector.matchAll(VISUAL_TEXT_PSEUDO_PATTERN)].map(match =>
                String(match[1]).toLowerCase(),
            ),
        ),
    ]
}
