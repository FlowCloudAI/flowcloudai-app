/**
 * AI 用量热力图的取数与排版计算（GitHub 贡献图那种「格子统计图」）。
 *
 * 纯函数，不依赖任何渲染层：桌面 `pages/Settings.tsx` 与移动端用量统计页共用同一份，
 * 免得两端各算一次日期窗口后慢慢对不上。样式各自写——两端格子尺寸与滚动方式不同。
 */
import type {ApiUsageDaily} from '../../api'

/** 展示最近 52 周。列数同时决定月份标签的网格宽度，两处必须用同一个值。 */
export const USAGE_ACTIVITY_COLUMNS = 52

const USAGE_ACTIVITY_CELL_COUNT = USAGE_ACTIVITY_COLUMNS * 7
const DAY_MS = 24 * 60 * 60 * 1000

export interface UsageActivityDay {
    date: string
    label: string
    totalTokens: number
    callCount: number
    /** 0 = 无使用，1–4 为四档深浅。 */
    intensity: number
}

export interface UsageMonthLabel {
    label: string
    /** 1 起的网格列号。 */
    column: number
}

function padDatePart(value: number): string {
    return String(value).padStart(2, '0')
}

function toLocalDateKey(date: Date): string {
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function toLocalDateLabel(dateKey: string): string {
    const date = new Date(`${dateKey}T00:00:00`)
    return `${date.getMonth() + 1}月${date.getDate()}日`
}

function getLocalDayNumber(date: Date): number {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

/**
 * 定下这张图覆盖的日期窗口。
 *
 * 网格按列排（每列一周、周日起），所以最后一列要补满到本周周六：`trailingEmptyDays`
 * 是今天之后那几个占位格，真正有数据的天数要相应减少，否则最后一列会溢出一列。
 * 格子与月份标签必须用同一套窗口，不然标签会和列错位——这也是它俩共用这个函数的原因。
 */
function resolveActivityWindow(): {start: Date; end: Date; actualDayCount: number; trailingEmptyDays: number} {
    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const trailingEmptyDays = 6 - end.getDay()
    const actualDayCount = USAGE_ACTIVITY_CELL_COUNT - trailingEmptyDays
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (actualDayCount - 1))
    return {start, end, actualDayCount, trailingEmptyDays}
}

export function buildUsageMonthLabels(): UsageMonthLabel[] {
    const {start, end} = resolveActivityWindow()
    const labels: UsageMonthLabel[] = []

    for (
        let month = new Date(start.getFullYear(), start.getMonth(), 1);
        month <= end;
        month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    ) {
        const labelDate = month < start ? start : month
        const offsetDays = getLocalDayNumber(labelDate) - getLocalDayNumber(start)
        labels.push({
            label: `${month.getMonth() + 1}月`,
            column: Math.floor(offsetDays / 7) + 1,
        })
    }

    return labels
}

/** 返回按列优先铺开的格子；末尾的 null 是今天之后的占位，渲染成不可见格。 */
export function buildUsageActivityDays(rows: ApiUsageDaily[]): Array<UsageActivityDay | null> {
    const {start, actualDayCount, trailingEmptyDays} = resolveActivityWindow()
    const byDate = new Map(rows.map(row => [row.date, row]))
    const rawDays: Array<{dateKey: string; row?: ApiUsageDaily; totalTokens: number}> = []

    for (let index = 0; index < actualDayCount; index += 1) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
        const dateKey = toLocalDateKey(date)
        const row = byDate.get(dateKey)
        rawDays.push({dateKey, row, totalTokens: row?.total_tokens ?? 0})
    }

    // 深浅按窗口内最大值归一化，不用绝对阈值：不同用户的量级差几个数量级。
    const maxTokens = Math.max(0, ...rawDays.map(day => day.totalTokens))
    const days: Array<UsageActivityDay | null> = rawDays.map(({dateKey, row, totalTokens}) => ({
        date: dateKey,
        label: toLocalDateLabel(dateKey),
        totalTokens,
        callCount: row?.call_count ?? 0,
        intensity: totalTokens === 0 || maxTokens === 0
            ? 0
            : Math.min(4, Math.max(1, Math.ceil((totalTokens / maxTokens) * 4))),
    }))

    days.push(...Array.from({length: trailingEmptyDays}, () => null))

    return days
}
