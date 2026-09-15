// 本模块只在页面文档构建开关开启时向桌面壳注册属性 Dock 能力。

import {createElement} from 'react'
import type {SideBarItem} from 'flowcloudai-ui'
import {usePageDocumentWorkspace} from '../workspace/pageDocumentWorkspaceStore.ts'

export const PAGE_DOCUMENT_EDITOR_SIDE_PANEL_CONTENTS = [
    {key: 'page-properties', minWidth: 272, scope: 'page'},
] as const

export function isPageDocumentPropertiesKey(key: string): key is 'page-properties' {
    return key === 'page-properties'
}

export function usePageDocumentEditorActive(): boolean {
    return usePageDocumentWorkspace().active !== null
}

export function getPageDocumentEditorSideBarItems(active: boolean): SideBarItem[] {
    if (!active) return []
    return [{
        key: 'page-properties',
        label: '属性',
        icon: createElement(
            'svg',
            {viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg', fill: 'none'},
            createElement('path', {
                d: 'M5 7h14M5 17h14M8 4v6M16 14v6',
                stroke: 'currentColor',
                strokeWidth: '1.5',
                strokeLinecap: 'round',
            }),
        ),
    }]
}
