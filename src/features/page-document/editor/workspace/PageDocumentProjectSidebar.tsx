// 本组件在活动页面编辑器存在时独占项目左栏宿主，并把左栏返回交给活动编辑器的离开守卫。

import {useEffect, type ReactNode} from 'react'
import {
    setPageDocumentSidebarHost,
    usePageDocumentWorkspace,
} from './pageDocumentWorkspaceStore.ts'
import {
    resolvePageDocumentSidebarReturn,
    shouldShowPageDocumentComponentTree,
} from './pageDocumentSidebarModel.ts'
import './PageDocumentProjectSidebar.css'

interface PageDocumentProjectSidebarProps {
    projectId: string
    children: ReactNode
}

export function PageDocumentProjectSidebar({projectId, children}: PageDocumentProjectSidebarProps) {
    const {active} = usePageDocumentWorkspace()
    const enabled = shouldShowPageDocumentComponentTree(active?.projectId ?? null, projectId)

    useEffect(() => () => setPageDocumentSidebarHost(null), [])

    if (!enabled) return <>{children}</>
    return (
        <section className="page-document-project-sidebar">
            <div className="pe-tool-sidebar-host" ref={setPageDocumentSidebarHost}/>
        </section>
    )
}

interface PageDocumentProjectSidebarHeaderProps {
    projectId: string
    defaultLabel: string
    onDefaultBack: () => void
    onReturnCategory: (categoryId: string) => void
    onReturnProject: () => void
}

export function PageDocumentProjectSidebarHeader({
    projectId,
    defaultLabel,
    onDefaultBack,
    onReturnCategory,
    onReturnProject,
}: PageDocumentProjectSidebarHeaderProps) {
    const {active} = usePageDocumentWorkspace()
    const enabled = shouldShowPageDocumentComponentTree(active?.projectId ?? null, projectId)
    const handleClick = async () => {
        if (!enabled || !active) {
            onDefaultBack()
            return
        }
        const resolution = resolvePageDocumentSidebarReturn(active.categoryId, active.dirty)
        if (!(await active.requestLeave())) return
        if (resolution.target.kind === 'category') onReturnCategory(resolution.target.categoryId)
        else onReturnProject()
    }
    return (
        <button type="button" className="pe-tree-header-btn" onClick={() => void handleClick()}>
            {enabled ? '返回分类' : defaultLabel}
        </button>
    )
}
