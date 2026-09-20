// 本组件只提供桌面页面属性的 portal 宿主；词条关系归词条信息浮层所有。

import {useEffect} from 'react'
import {setPageDocumentDockHost} from './pageDocumentWorkspaceStore.ts'
import './PageDocumentPropertiesDockHost.css'

export function PageDocumentPropertiesDockHost() {
    useEffect(() => () => setPageDocumentDockHost(null), [])

    return <section className="page-document-properties-dock-host" aria-label="页面属性">
        <div className="page-document-properties-dock-host__panel" ref={setPageDocumentDockHost} />
    </section>
}
