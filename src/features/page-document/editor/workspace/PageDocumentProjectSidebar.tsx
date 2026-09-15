// 本组件在活动页面编辑器存在时为项目左栏提供图层宿主；项目树仍由原组件拥有。

import {useEffect, useState, type ReactNode} from 'react'
import {
    setPageDocumentSidebarHost,
    usePageDocumentWorkspace,
} from './pageDocumentWorkspaceStore.ts'
import './PageDocumentProjectSidebar.css'

interface PageDocumentProjectSidebarProps {
    projectId: string
    children: ReactNode
}

export function PageDocumentProjectSidebar({projectId, children}: PageDocumentProjectSidebarProps) {
    const {active} = usePageDocumentWorkspace()
    const [tab, setTab] = useState<'layers' | 'project'>('layers')
    const enabled = active?.projectId === projectId

    useEffect(() => {
        if (enabled) setTab('layers')
    }, [active?.entryId, enabled])

    useEffect(() => () => setPageDocumentSidebarHost(null), [])

    if (!enabled) return <>{children}</>
    return (
        <section className="page-document-project-sidebar">
            <div className="page-document-project-sidebar__tabs" role="tablist" aria-label="页面编辑左栏">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'layers'}
                    className={tab === 'layers' ? 'is-active' : ''}
                    onClick={() => setTab('layers')}
                >图层</button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'project'}
                    className={tab === 'project' ? 'is-active' : ''}
                    onClick={() => setTab('project')}
                >项目</button>
            </div>
            {tab === 'layers' ? (
                <div className="pe-tool-sidebar-host" ref={setPageDocumentSidebarHost}/>
            ) : children}
        </section>
    )
}
