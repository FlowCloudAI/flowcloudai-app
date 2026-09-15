// 本组件只向桌面 Dock 注册 portal 宿主；属性内容与选中状态仍由活动页面编辑器拥有。

import {useEffect} from 'react'
import {setPageDocumentDockHost} from './pageDocumentWorkspaceStore.ts'

export function PageDocumentPropertiesDockHost() {
    useEffect(() => () => setPageDocumentDockHost(null), [])
    return <div className="page-document-properties-dock-host" ref={setPageDocumentDockHost}/>
}
