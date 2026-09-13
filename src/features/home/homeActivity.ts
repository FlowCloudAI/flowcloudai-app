import {useEffect, useSyncExternalStore} from 'react'
import {buildHelpTargetId, HELP_HOME_LINKS} from '../../shared/help/helpCatalog'
import {findHomeContinueTarget} from './homeContinueTarget'

const HOME_ACTIVITY_STORAGE_KEY = 'flowcloudai.home.activity.v1'
const HOME_SESSION_STORAGE_KEY = 'flowcloudai.home.last-session.v1'
const MAX_ACTIVITY_RECORDS = 80

export type HomeActivityTargetType = 'project' | 'entry' | 'tool' | 'idea' | 'conversation' | 'snapshot' | 'help'
export type HomeProjectToolPanel = 'relation-graph' | 'timeline' | 'contradiction' | 'world-map'

export interface HomeActivityTarget {
    type: HomeActivityTargetType
    id: string
    title: string
    projectId?: string | null
    entryId?: string | null
    panel?: HomeProjectToolPanel | null
    subtitle?: string | null
    description?: string | null
    updatedAt?: string | null
}

export interface HomeActivityRecord extends HomeActivityTarget {
    key: string
    firstOpenedAt: string
    lastOpenedAt: string
    openCount: number
    pinned?: boolean
}

export interface HomeLastSession {
    target: HomeActivityTarget | null
    mainContentKey: string
    activeTabKey: string | null
    savedAt: string
    sidePanel: {
        contentKey: string
        collapsed: boolean
    }
}

export interface HomeHelpLink {
    key: string
    title: string
    description: string
    target: HomeActivityTarget
}

export interface HomeDashboardData {
    lastSession: HomeLastSession | null
    continueItem: HomeActivityTarget | null
    recentItems: HomeActivityRecord[]
    recentProjects: HomeActivityRecord[]
    recentEntries: HomeActivityRecord[]
    pinnedItems: HomeActivityRecord[]
    helpLinks: HomeHelpLink[]
    updatedAt: string
}

const HOME_HELP_LINKS: HomeHelpLink[] = HELP_HOME_LINKS.map(link => ({
    key: link.key,
    title: link.title,
    description: link.description,
    target: {
        type: 'help',
        id: buildHelpTargetId(link.topicKey, link.sectionId),
        title: link.title,
        description: link.description,
    },
}))

const dashboardListeners = new Set<() => void>()
let dashboardSnapshot: HomeDashboardData | null = null

function canUseStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readJson<T>(key: string, fallback: T): T {
    if (!canUseStorage()) return fallback
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        return JSON.parse(raw) as T
    } catch {
        return fallback
    }
}

function writeJson<T>(key: string, value: T) {
    if (!canUseStorage()) return
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // 本地存储不可写时保留内存流程，首页最多缺少最近记录。
    }
}

export function getHomeActivityTargetKey(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId' | 'panel'>) {
    const projectPart = target.projectId ?? ''
    const panelPart = target.panel ?? ''
    return `${target.type}:${projectPart}:${target.id}:${panelPart}`
}

export function getHomeTargetProjectId(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId'>) {
    return target.type === 'project' ? target.projectId ?? target.id : target.projectId ?? null
}

export function getHomeTargetEntryId(target: Pick<HomeActivityTarget, 'type' | 'id' | 'entryId'>) {
    return target.type === 'entry' ? target.entryId ?? target.id : null
}

export function isHomeProjectBackedTarget(target: Pick<HomeActivityTarget, 'type'>) {
    return target.type === 'project' || target.type === 'entry' || target.type === 'tool'
}

function isProjectScopedTarget(target: HomeActivityTarget, projectId: string) {
    return getHomeTargetProjectId(target) === projectId
}

function isEntryTarget(target: HomeActivityTarget, projectId: string, entryId: string) {
    return target.type === 'entry'
        && getHomeTargetProjectId(target) === projectId
        && getHomeTargetEntryId(target) === entryId
}

function sortByRecentActivity(records: HomeActivityRecord[]) {
    return [...records].sort((a, b) => {
        const pinnedOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
        if (pinnedOrder) return pinnedOrder
        return new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
    })
}

function readHomeActivityRecords() {
    const records = readJson<HomeActivityRecord[]>(HOME_ACTIVITY_STORAGE_KEY, [])
    if (!Array.isArray(records)) return []
    return records.filter(record => (
        record
        && typeof record.key === 'string'
        && typeof record.id === 'string'
        && typeof record.title === 'string'
        && typeof record.type === 'string'
    ))
}

export function recordHomeActivity(target: HomeActivityTarget) {
    const id = target.id.trim()
    const title = target.title.trim()
    if (!id || !title) return

    const now = new Date().toISOString()
    const key = getHomeActivityTargetKey({...target, id})
    const records = readHomeActivityRecords()
    const existing = records.find(record => record.key === key)
    const nextRecord: HomeActivityRecord = {
        ...existing,
        ...target,
        id,
        title,
        key,
        firstOpenedAt: existing?.firstOpenedAt ?? now,
        lastOpenedAt: now,
        openCount: (existing?.openCount ?? 0) + 1,
        pinned: existing?.pinned,
    }
    const nextRecords = [
        nextRecord,
        ...records.filter(record => record.key !== key),
    ].slice(0, MAX_ACTIVITY_RECORDS)

    writeJson(HOME_ACTIVITY_STORAGE_KEY, nextRecords)
    refreshHomeDashboard()
}

export function setHomeActivityPinned(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId' | 'panel'>, pinned: boolean) {
    const key = getHomeActivityTargetKey(target)
    const records = readHomeActivityRecords()
    const nextRecords = records.map(record => (
        record.key === key ? {...record, pinned} : record
    ))
    writeJson(HOME_ACTIVITY_STORAGE_KEY, nextRecords)
    refreshHomeDashboard()
}

function pruneStoredHomeActivity(
    nextRecords: HomeActivityRecord[],
    shouldClearSessionTarget: (target: HomeActivityTarget) => boolean,
) {
    writeJson(HOME_ACTIVITY_STORAGE_KEY, nextRecords)

    const session = loadHomeLastSession()
    if (session?.target && shouldClearSessionTarget(session.target)) {
        writeJson<HomeLastSession>(HOME_SESSION_STORAGE_KEY, {
            ...session,
            target: null,
            activeTabKey: null,
            savedAt: new Date().toISOString(),
        })
    }

    refreshHomeDashboard()
}

export function removeHomeActivityTarget(target: Pick<HomeActivityTarget, 'type' | 'id' | 'projectId' | 'entryId' | 'panel'>) {
    const key = getHomeActivityTargetKey(target)
    const records = readHomeActivityRecords()
    pruneStoredHomeActivity(
        records.filter(record => record.key !== key),
        sessionTarget => getHomeActivityTargetKey(sessionTarget) === key,
    )
}

export function removeHomeProjectActivity(projectId: string) {
    const id = projectId.trim()
    if (!id) return

    const records = readHomeActivityRecords()
    pruneStoredHomeActivity(
        records.filter(record => !isProjectScopedTarget(record, id)),
        sessionTarget => isProjectScopedTarget(sessionTarget, id),
    )
}

export function removeHomeEntryActivity(projectId: string, entryId: string) {
    const normalizedProjectId = projectId.trim()
    const normalizedEntryId = entryId.trim()
    if (!normalizedProjectId || !normalizedEntryId) return

    const records = readHomeActivityRecords()
    pruneStoredHomeActivity(
        records.filter(record => !isEntryTarget(record, normalizedProjectId, normalizedEntryId)),
        sessionTarget => isEntryTarget(sessionTarget, normalizedProjectId, normalizedEntryId),
    )
}

export function saveHomeLastSession(session: Omit<HomeLastSession, 'savedAt'>) {
    writeJson<HomeLastSession>(HOME_SESSION_STORAGE_KEY, {
        ...session,
        savedAt: new Date().toISOString(),
    })
    refreshHomeDashboard()
}

export function loadHomeLastSession() {
    const session = readJson<HomeLastSession | null>(HOME_SESSION_STORAGE_KEY, null)
    if (!session || typeof session.mainContentKey !== 'string') return null
    return session
}

export function loadHomeDashboardData(): HomeDashboardData {
    const records = sortByRecentActivity(readHomeActivityRecords())
    const pinnedItems = records.filter(record => record.pinned)
    const recentProjects = records.filter(record => record.type === 'project').slice(0, 6)
    const recentEntries = records.filter(record => record.type === 'entry').slice(0, 8)
    const recentItems = records.slice(0, 12)
    const lastSession = loadHomeLastSession()
    const continueItem = findHomeContinueTarget([lastSession?.target, ...recentItems])

    return {
        lastSession,
        continueItem,
        recentItems,
        recentProjects,
        recentEntries,
        pinnedItems,
        helpLinks: HOME_HELP_LINKS,
        updatedAt: new Date().toISOString(),
    }
}

function subscribeHomeDashboard(listener: () => void) {
    dashboardListeners.add(listener)
    return () => dashboardListeners.delete(listener)
}

function getHomeDashboardSnapshot() {
    dashboardSnapshot ??= loadHomeDashboardData()
    return dashboardSnapshot
}

export function refreshHomeDashboard() {
    dashboardSnapshot = loadHomeDashboardData()
    for (const listener of dashboardListeners) listener()
}

export function useHomeDashboard() {
    const dashboard = useSyncExternalStore(
        subscribeHomeDashboard,
        getHomeDashboardSnapshot,
        getHomeDashboardSnapshot,
    )

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key === HOME_ACTIVITY_STORAGE_KEY || event.key === HOME_SESSION_STORAGE_KEY) {
                refreshHomeDashboard()
            }
        }
        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [])

    return dashboard
}
