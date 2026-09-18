// 本模块固定行内样式的安全降级；没有可信选区就不能构造 range 编辑请求。
export const INLINE_RIBBON_DISABLED_REASON = '画布协议尚未提供可信的文字选区，行内样式不能安全写回。'

export function inlineRibbonEditAvailability(): {readonly enabled: false; readonly reason: string} {
    return {enabled: false, reason: INLINE_RIBBON_DISABLED_REASON}
}
