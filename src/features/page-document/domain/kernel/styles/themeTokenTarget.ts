// 本模块定义主题令牌受管根的唯一选择器语义；读取与写入共享该判定，避免等价引号或空白造成状态分裂。

import type {SourceScope} from '../contracts/source.ts'

export function themeTokenSelector(scope: SourceScope, entryId: string): string {
    if (scope === 'project') return ':root'
    if (scope === 'entry') return `[data-fc-entry-id="${entryId.toLowerCase()}"]`
    throw new TypeError('组件作用域不支持主题令牌写回。')
}

export function matchesThemeTokenSelector(
    selectorInput: string,
    scope: SourceScope,
    entryId: string,
): boolean {
    const selector = selectorInput.trim()
    if (scope === 'project') return selector === ':root'
    if (scope === 'component') return false
    const match = /^\[\s*data-fc-entry-id\s*=\s*(["'])([^"']+)\1\s*\]$/iu.exec(selector)
    return match?.[2]?.toLowerCase() === entryId.toLowerCase()
}
