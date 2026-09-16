// 本模块界定词条编辑器的全局快捷键归属；编辑模式由独立页面编辑器接管全部快捷键。

export type EntryEditorMode = 'edit' | 'browse'

export function shouldHandleEntryEditorShortcut(
    mode: EntryEditorMode,
    key: string,
): boolean {
    if (mode === 'edit') return false
    return key === 's' || key === 'z' || key === 'y'
}
