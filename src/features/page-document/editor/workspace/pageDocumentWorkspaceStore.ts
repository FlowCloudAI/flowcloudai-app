// 本模块在页面编辑器、项目左栏与桌面 Dock 之间共享挂载点和活动词条；不承载草稿数据。

import {useSyncExternalStore} from 'react'

export interface ActivePageDocumentWorkspace {
    projectId: string
    entryId: string
    categoryId: string | null
    dirty: boolean
    requestLeave: () => Promise<boolean>
}

export interface PageDocumentWorkspaceSnapshot {
    active: ActivePageDocumentWorkspace | null
    sidebarHost: HTMLElement | null
    dockHost: HTMLElement | null
}

const EMPTY_SNAPSHOT: PageDocumentWorkspaceSnapshot = Object.freeze({
    active: null,
    sidebarHost: null,
    dockHost: null,
})

let snapshot = EMPTY_SNAPSHOT
const listeners = new Set<() => void>()

function publish(next: PageDocumentWorkspaceSnapshot): void {
    if (
        next.active?.projectId === snapshot.active?.projectId &&
        next.active?.entryId === snapshot.active?.entryId &&
        next.active?.categoryId === snapshot.active?.categoryId &&
        next.active?.dirty === snapshot.active?.dirty &&
        next.active?.requestLeave === snapshot.active?.requestLeave &&
        next.sidebarHost === snapshot.sidebarHost &&
        next.dockHost === snapshot.dockHost
    ) return
    snapshot = Object.freeze(next)
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function usePageDocumentWorkspace(): PageDocumentWorkspaceSnapshot {
    return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY_SNAPSHOT)
}

export function setActivePageDocumentWorkspace(active: ActivePageDocumentWorkspace): () => void {
    publish({...snapshot, active})
    return () => {
        if (
            snapshot.active?.projectId === active.projectId &&
            snapshot.active.entryId === active.entryId
        ) publish({...snapshot, active: null})
    }
}

export function setPageDocumentSidebarHost(sidebarHost: HTMLElement | null): void {
    publish({...snapshot, sidebarHost})
}

export function setPageDocumentDockHost(dockHost: HTMLElement | null): void {
    publish({...snapshot, dockHost})
}
