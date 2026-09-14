// 本模块定义主题令牌受管根的唯一选择器语义；读取与写入共享该判定，避免等价引号或空白造成状态分裂。

import type {SourceScope} from '../contracts/source.ts'

export function themeTokenSelector(scope: SourceScope, entryId: string): string {
    return scope === 'project' ? ':root' : `[data-fc-entry-id="${entryId.toLowerCase()}"]`
}

export function matchesThemeTokenSelector(
    selectorInput: string,
    scope: SourceScope,
    entryId: string,
): boolean {
    const selector = selectorInput.trim()
    if (scope === 'project') return selector === ':root'
    const match = /^\[\s*data-fc-entry-id\s*=\s*(["'])([^"']+)\1\s*\]$/iu.exec(selector)
    return match?.[2]?.toLowerCase() === entryId.toLowerCase()
}
