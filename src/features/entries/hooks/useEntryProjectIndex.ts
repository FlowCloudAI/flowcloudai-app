// 本 hook 保留桌面词条编辑器原有的项目词条懒加载与反向链接缓存，不改变关系或保存链路。

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {db_get_entry, db_list_entries, type Entry, type EntryBrief, type EntryLink} from '../../../api'
import {ensureEntryDetailLoaded} from '../lib/entryDetailLoading.ts'
import {parseDateValue} from '../lib/entryCommon.ts'

interface UseEntryProjectIndexOptions {
    active: boolean
    entryId: string
    projectId: string
    incomingLinks: EntryLink[]
}

export default function useEntryProjectIndex({
    active,
    entryId,
    projectId,
    incomingLinks,
}: UseEntryProjectIndexOptions) {
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entryDetailsById, setEntryDetailsById] = useState<Record<string, Entry>>({})
    const [loading, setLoading] = useState(false)
    const entriesRef = useRef(projectEntries)
    const statusRef = useRef<'idle' | 'loading' | 'loaded'>('idle')
    const loadedDetailIdsRef = useRef(new Set<string>())
    const detailPromisesRef = useRef(new Map<string, Promise<void>>())
    const entriesPromiseRef = useRef<Promise<void> | null>(null)
    const projectIdRef = useRef(projectId)

    useLayoutEffect(() => {
        projectIdRef.current = projectId
    }, [projectId])
    useEffect(() => {
        entriesRef.current = projectEntries
    }, [projectEntries])

    const ensureEntryDetails = useCallback(async (ids: string[]) => {
        await Promise.all([...new Set(ids)]
            .filter(targetEntryId => targetEntryId !== entryId)
            .map(targetEntryId => ensureEntryDetailLoaded(
                targetEntryId,
                loadedDetailIdsRef.current,
                detailPromisesRef.current,
                async () => {
                    const detail = await db_get_entry(targetEntryId, projectId)
                    if (projectIdRef.current !== projectId) return
                    setEntryDetailsById(current => ({...current, [targetEntryId]: detail}))
                },
            ).catch(() => undefined)))
    }, [entryId, projectId])

    const ensureProjectEntriesLoaded = useCallback(async () => {
        if (statusRef.current === 'loaded') return
        if (entriesPromiseRef.current) return entriesPromiseRef.current
        statusRef.current = 'loading'
        entriesPromiseRef.current = (async () => {
            setLoading(true)
            try {
                const briefs = await db_list_entries({projectId, limit: 1000, offset: 0})
                entriesRef.current = briefs
                setProjectEntries(briefs)
                statusRef.current = 'loaded'
            } catch {
                statusRef.current = 'idle'
            } finally {
                setLoading(false)
                entriesPromiseRef.current = null
            }
        })()
        return entriesPromiseRef.current
    }, [projectId])

    useEffect(() => {
        statusRef.current = 'idle'
        loadedDetailIdsRef.current.clear()
        detailPromisesRef.current.clear()
        entriesPromiseRef.current = null
        entriesRef.current = []
        setProjectEntries([])
        setEntryDetailsById({})
    }, [projectId])
    useEffect(() => {
        if (active) void ensureProjectEntriesLoaded()
    }, [active, ensureProjectEntriesLoaded])

    const backlinks = useMemo(() => {
        const linkedEntryIds = new Set(incomingLinks.map(link => link.a_id))
        return Object.values(entryDetailsById)
            .filter(item => item.id !== entryId && linkedEntryIds.has(item.id))
            .sort((left, right) => parseDateValue(right.updated_at as string | null | undefined)
                - parseDateValue(left.updated_at as string | null | undefined))
            .map(item => ({
                id: item.id,
                project_id: item.project_id,
                category_id: item.category_id ?? null,
                title: item.title,
                summary: item.summary ?? null,
                type: item.type ?? null,
                cover: null,
                updated_at: String(item.updated_at ?? ''),
                content: item.content,
            }))
    }, [entryDetailsById, entryId, incomingLinks])

    return {
        projectEntries,
        setProjectEntries,
        entryDetailsById,
        setEntryDetailsById,
        projectDataLoading: loading,
        projectEntriesRef: entriesRef,
        ensureEntryDetails,
        ensureProjectEntriesLoaded,
        backlinks,
    }
}
