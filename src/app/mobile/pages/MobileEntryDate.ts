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

export function formatMobileEntryUpdatedDate(value?: string | null): string {
    const date = parseEntryDate(value)
    if (!date) return '日期未知'
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date)
}
