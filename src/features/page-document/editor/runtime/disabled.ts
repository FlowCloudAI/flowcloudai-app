// 默认构建不注册页面属性内容，桌面 Dock 因而不会包含相关 key 或文案。

import type {SideBarItem} from 'flowcloudai-ui'

export const PAGE_DOCUMENT_EDITOR_SIDE_PANEL_CONTENTS = [] as const

export function isPageDocumentPropertiesKey(key: string): key is never {
    void key
    return false
}

export function usePageDocumentEditorActive(): boolean {
    return false
}

export function getPageDocumentEditorSideBarItems(active: boolean): SideBarItem[] {
    void active
    return []
}
