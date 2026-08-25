/**
 * 移动端词条日期格式化：列表保留紧凑的月日时分，详情页使用不含相对语义的完整日期。
 * 两处共用同一套后端时间解析，避免无时区字符串在不同 WebView 中出现偏差。
 */

function parseEntryDate(value?: string | null): Date | null {
    if (!value) return null
    const normalized = value.includes('T') ? value : value.replace(' ', 'T')
    const withTimezone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
    const date = new Date(withTimezone)
    return Number.isNaN(date.getTime()) ? null : date
}

export function formatMobileEntryListDate(value?: string | null): string {
    const date = parseEntryDate(value)
    if (!date) return '未知'
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)
}

/**
 * 详情页的更新时间。当年的词条不带年份——「2026年8月25日」里的年份在绝大多数
 * 情况下是噪声，跨年的词条才需要它来定位。
 */
export function formatMobileEntryUpdatedDate(value?: string | null): string {
    const date = parseEntryDate(value)
    if (!date) return '日期未知'
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return new Intl.DateTimeFormat('zh-CN', {
        year: sameYear ? undefined : 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date)
}
