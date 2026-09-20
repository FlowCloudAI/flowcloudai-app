// 本组件只组织桌面 Dock 的页签与 portal 宿主；属性和关系内容仍由活动词条各自拥有。

import {useEffect, useState} from 'react'
import {
    setPageDocumentDockHost,
    setPageDocumentRelationsDockHost,
} from './pageDocumentWorkspaceStore.ts'
import './PageDocumentPropertiesDockHost.css'

export function PageDocumentPropertiesDockHost() {
    const [tab, setTab] = useState<'properties' | 'relations'>('properties')

    useEffect(() => () => {
        setPageDocumentDockHost(null)
        setPageDocumentRelationsDockHost(null)
    }, [])

    return <section className="page-document-properties-dock-host">
        <div className="page-document-properties-dock-host__tabs" role="tablist" aria-label="词条编辑侧栏">
            <button
                type="button"
                role="tab"
                aria-selected={tab === 'properties'}
                className={tab === 'properties' ? 'is-active' : ''}
                onClick={() => setTab('properties')}
            >属性</button>
            <button
                type="button"
                role="tab"
                aria-selected={tab === 'relations'}
                className={tab === 'relations' ? 'is-active' : ''}
                onClick={() => setTab('relations')}
            >关系</button>
        </div>
        <div
            className="page-document-properties-dock-host__panel"
            hidden={tab !== 'properties'}
            ref={setPageDocumentDockHost}
        />
        <div
            className="page-document-properties-dock-host__panel is-relations"
            hidden={tab !== 'relations'}
            ref={setPageDocumentRelationsDockHost}
        />
    </section>
}
