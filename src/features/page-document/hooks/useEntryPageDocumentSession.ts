// 本 Hook 管理词条页面文档的读取、前端防抖校验与独立保存；不接触词条 Markdown 持久化。

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {
    pageDocumentReadEntry,
    pageDocumentSaveEntry,
    parsePageDocumentSaveError,
} from '../../../api/pageDocument.ts'
import {isDocumentScopeDirty, sourceDraftView} from '../application/documentDraftModel.ts'
import {
    createDocumentKernelDraftRuntime,
    type KernelComponentInspectionRequest,
    type KernelDraftEditRequest,
    type KernelDraftPreparationResult,
} from '../application/documentKernelDraftRuntime.ts'
import {createVisualOperationQueue} from '../application/visualOperationQueue.ts'
import {
    createLiveVisualCommitScheduler,
    type LiveVisualCommitScheduler,
    type LiveVisualScheduleOptions,
} from '../application/liveVisualCommitScheduler.ts'
import {createOpaqueElementAdoptionKernelRequest} from '../application/opaqueElementAdoption.ts'
import {
    acceptEntryDocumentSave,
    acceptEntryDocumentVisualUpdate,
    beginEntryDocumentValidation,
    canSaveEntryDocument,
    createEntryDocumentSessionState,
    discardEntryDocumentChanges,
    editEntryDocumentSource,
    finishEntryDocumentValidation,
    keepEntryDocumentDraft,
    loadLatestEntryDocument,
    prepareEntryDocumentSave,
    redoEntryDocumentSession,
    rejectEntryDocumentSave,
    undoEntryDocumentSession,
    updateEntryDocumentMetadata,
    type EntryDocumentSessionState,
} from '../application/entryDocumentSessionModel.ts'
import type {SourceFileName} from '../domain/contract.ts'
import type {LayerProjectionNode} from '../domain/layerProjection.ts'

export type EntryPageDocumentLoadStatus = 'loading' | 'ready' | 'error'

export interface UseEntryPageDocumentSessionInput {
    entryId: string
    projectId: string
    title: string
    summary: string
    markdown: string
}

interface ScheduledKernelEntry {
    readonly request: KernelDraftEditRequest
    readonly label: string
}

const LIVE_VISUAL_COMMIT_DELAY_MS = 140

export function useEntryPageDocumentSession(input: UseEntryPageDocumentSessionInput) {
    const {entryId, projectId, title, summary} = input
    const [loadStatus, setLoadStatus] = useState<EntryPageDocumentLoadStatus>('loading')
    const [loadError, setLoadError] = useState<string | null>(null)
    const [loadAttempt, setLoadAttempt] = useState(0)
    const [state, setState] = useState<EntryDocumentSessionState | null>(null)
    const [visualError, setVisualError] = useState<string | null>(null)
    const stateRef = useRef<EntryDocumentSessionState | null>(null)
    const inputRef = useRef(input)
    const kernelRuntimeRef = useRef(createDocumentKernelDraftRuntime())
    const visualQueueRef = useRef(createVisualOperationQueue())
    const liveVisualSchedulerRef = useRef<LiveVisualCommitScheduler<ScheduledKernelEntry> | null>(null)
    const {showAlert} = useAlert()

    useEffect(() => {
        inputRef.current = input
    }, [input])

    const publish = useCallback((next: EntryDocumentSessionState | null) => {
        stateRef.current = next
        setState(next)
    }, [])

    useEffect(() => {
        let cancelled = false
        publish(null)
        setLoadStatus('loading')
        setLoadError(null)
        void pageDocumentReadEntry(entryId)
            .then(document => {
                if (cancelled) return
                publish(createEntryDocumentSessionState(inputRef.current, document))
                setLoadStatus('ready')
            })
            .catch(error => {
                if (cancelled) return
                setLoadError(error instanceof Error ? error.message : String(error))
                setLoadStatus('error')
            })
        return () => {
            cancelled = true
        }
        // 标题与摘要变化只更新预览元数据，不能重新读取并覆盖本地页面草稿。
    }, [entryId, loadAttempt, projectId, publish])

    useEffect(() => {
        const current = stateRef.current
        if (!current || current.identity.entryId !== entryId) return
        const next = updateEntryDocumentMetadata(current, {
            title,
            summary,
        })
        if (next !== current) publish(next)
    }, [entryId, publish, summary, title])

    const validationSignature = state
        ? `${state.model.changeVersion}:${state.model.entry.validationPhase}`
        : null
    useEffect(() => {
        if (!state || state.model.entry.validationPhase !== 'pending') return
        const expectedVersion = state.model.changeVersion
        const timer = window.setTimeout(() => {
            const current = stateRef.current
            if (!current || current.model.changeVersion !== expectedVersion) return
            const validating = beginEntryDocumentValidation(current)
            publish(validating)
            queueMicrotask(() => {
                const latest = stateRef.current
                if (!latest || latest.model.changeVersion !== expectedVersion) return
                publish(finishEntryDocumentValidation(latest))
            })
        }, 360)
        return () => window.clearTimeout(timer)
    }, [publish, state, validationSignature])

    const updateSource = useCallback(
        (file: SourceFileName, value: string) => {
            const current = stateRef.current
            if (current) publish(editEntryDocumentSource(current, file, value))
        },
        [publish],
    )

    const save = useCallback(async (): Promise<boolean> => {
        const current = stateRef.current
        if (!current) return false
        const preparation = prepareEntryDocumentSave(current, () => crypto.randomUUID())
        if (preparation.status === 'blocked') return false
        publish(preparation.state)
        const entryId = preparation.input.entryId
        try {
            const result = await pageDocumentSaveEntry(preparation.input)
            const latest = stateRef.current
            if (!latest || latest.identity.entryId !== entryId) return false
            publish(acceptEntryDocumentSave(latest, result))
            return true
        } catch (caught) {
            const error = parsePageDocumentSaveError(caught)
            let latestDocument = null
            if (error.kind === 'conflict') {
                try {
                    latestDocument = await pageDocumentReadEntry(entryId)
                } catch {
                    // 冲突本身仍可展示；读取最新版本失败时不丢弃本地草稿。
                }
            }
            const latest = stateRef.current
            if (!latest || latest.identity.entryId !== entryId) return false
            publish(rejectEntryDocumentSave(latest, error, latestDocument))
            return false
        }
    }, [publish])

    const mutate = useCallback(
        (update: (current: EntryDocumentSessionState) => EntryDocumentSessionState) => {
            const current = stateRef.current
            if (current) publish(update(current))
        },
        [publish],
    )

    const source = useMemo(
        () => (state ? sourceDraftView(state.model, 'entry', 'article.html') : null),
        [state],
    )
    const dirty = state ? isDocumentScopeDirty(state.model.entry) : false
    const discard = useCallback(() => mutate(discardEntryDocumentChanges), [mutate])
    const undo = useCallback(() => mutate(undoEntryDocumentSession), [mutate])
    const redo = useCallback(() => mutate(redoEntryDocumentSession), [mutate])
    const keepDraft = useCallback(async (): Promise<boolean> => {
        const current = stateRef.current
        if (!current?.conflict) return false
        let latestDocument = current.conflict.latestDocument
        if (!latestDocument) {
            try {
                latestDocument = await pageDocumentReadEntry(current.identity.entryId)
            } catch {
                // 状态模型会保留冲突，并给出不能用未知 revision 保存的明确原因。
            }
        }
        const latest = stateRef.current
        if (!latest || latest.identity.entryId !== current.identity.entryId) return false
        const next = keepEntryDocumentDraft(latest, latestDocument)
        publish(next)
        return next.conflict === null
    }, [publish])
    const loadLatest = useCallback(() => mutate(loadLatestEntryDocument), [mutate])
    const retryLoad = useCallback(() => setLoadAttempt(current => current + 1), [])

    const inspectComponent = useCallback((request: KernelComponentInspectionRequest) => {
        const current = stateRef.current
        if (!current) {
            return Object.freeze({
                status: 'rejected' as const,
                failures: Object.freeze([
                    Object.freeze({code: 'document-snapshot-unavailable', property: null}),
                ]),
            })
        }
        return kernelRuntimeRef.current.inspectComponent(current.model, current.snapshot, request)
    }, [])

    const prepareKernelEntry = useCallback(
        (request: KernelDraftEditRequest): KernelDraftPreparationResult => {
            const current = stateRef.current
            if (!current || current.conflict) {
                return Object.freeze({
                    status: 'rejected' as const,
                    diagnostics: Object.freeze([
                        Object.freeze({
                            severity: 'error' as const,
                            category: 'capability' as const,
                            code: current ? 'document-conflict-active' : 'document-snapshot-unavailable',
                            message: current
                                ? '页面文档存在版本冲突，请先选择冲突处理方式。'
                                : '当前没有可准备的页面文档草稿。',
                        }),
                    ]),
                })
            }
            return kernelRuntimeRef.current.prepare(current.model, current.snapshot, request)
        },
        [],
    )

    const reportVisualFailure = useCallback(
        async (message: string): Promise<false> => {
            setVisualError(message)
            await showAlert(message, 'warning', 'nonInvasive', 2200)
            return false
        },
        [showAlert],
    )

    const applyPreparedKernelEntry = useCallback(
        async (
            preparation: Exclude<KernelDraftPreparationResult, {status: 'rejected' | 'unchanged'}>,
            label: string,
            history: {historyGroupId?: string} = {},
        ): Promise<boolean> => {
            if (preparation.status === 'needs-decision') {
                const impacts = [...new Set(preparation.decisions.map(item => item.message))]
                const confirmed = await showAlert(
                    `“${label}”会影响其他规则：\n\n${impacts.join('\n')}\n\n确认后才会写入当前草稿。`,
                    'warning',
                    'confirm',
                )
                if (confirmed !== 'yes') return false
            }
            const current = stateRef.current
            if (!current) return reportVisualFailure('确认后已无法取得当前页面文档草稿。')
            const update = kernelRuntimeRef.current.applyPrepared(
                current.model,
                current.snapshot,
                preparation.edit,
                label,
                history,
            )
            if (!update.applied) {
                return reportVisualFailure(
                    update.diagnostics[0]?.message ?? '内核无法安全应用这次属性修改。',
                )
            }
            setVisualError(null)
            publish(acceptEntryDocumentVisualUpdate(current, update))
            return true
        },
        [publish, reportVisualFailure, showAlert],
    )

    const applyKernelEntry = useCallback(
        (
            request: KernelDraftEditRequest,
            label: string,
            history: {historyGroupId?: string} = {},
        ): Promise<boolean> =>
            visualQueueRef.current.enqueue(async () => {
                const preparation = prepareKernelEntry(request)
                if (preparation.status === 'rejected') {
                    return reportVisualFailure(
                        preparation.diagnostics[0]?.message ?? '内核拒绝了这次属性修改。',
                    )
                }
                if (preparation.status === 'unchanged') {
                    setVisualError(null)
                    return true
                }
                return applyPreparedKernelEntry(preparation, label, history)
            }),
        [applyPreparedKernelEntry, prepareKernelEntry, reportVisualFailure],
    )

    useEffect(() => {
        const scheduler = createLiveVisualCommitScheduler<ScheduledKernelEntry>({
            // 与实验仓的实时可视状态保持同一窗口，连续输入只把尾帧送进完整内核链路。
            delayMs: LIVE_VISUAL_COMMIT_DELAY_MS,
            commit: (entry, metadata) => applyKernelEntry(entry.request, entry.label, metadata),
            onStatus: () => undefined,
        })
        liveVisualSchedulerRef.current = scheduler
        return () => {
            // 卸载时只冲刷而不立刻 dispose；这样提交中的更新仍能继续接上最后一帧。
            scheduler.flush()
            liveVisualSchedulerRef.current = null
        }
    }, [applyKernelEntry])

    const applyVisualPropertyEntry = useCallback(
        (
            request: KernelDraftEditRequest,
            label: string,
            options: LiveVisualScheduleOptions = {},
        ): Promise<boolean> => {
            const scheduler = liveVisualSchedulerRef.current
            if (!scheduler) return applyKernelEntry(request, label, options)
            return scheduler.schedule({request, label}, options)
        },
        [applyKernelEntry],
    )

    const flushVisualPropertyEntry = useCallback(() => {
        liveVisualSchedulerRef.current?.flush()
    }, [])

    const adoptOpaqueElement = useCallback(
        async (node: LayerProjectionNode): Promise<string | null> => {
            const current = stateRef.current
            if (!current) {
                reportVisualFailure('当前页面文档草稿不可用，无法纳入该元素。')
                return null
            }
            const newNodeId = crypto.randomUUID()
            let request: KernelDraftEditRequest
            try {
                request = createOpaqueElementAdoptionKernelRequest({
                    node,
                    articleHtml: current.model.entry.sources['article.html'],
                    newNodeId,
                })
            } catch (error) {
                reportVisualFailure(error instanceof Error ? error.message : '无法建立元素纳入请求。')
                return null
            }
            const applied = await applyKernelEntry(request, '纳入可视编辑')
            return applied ? newNodeId : null
        },
        [applyKernelEntry, reportVisualFailure],
    )

    return {
        loadStatus,
        loadError,
        state,
        source,
        dirty,
        canSave: state ? canSaveEntryDocument(state) : false,
        canUndo: Boolean(state?.model.entry.undo.length),
        canRedo: Boolean(state?.model.entry.redo.length),
        updateSource,
        save,
        discard,
        undo,
        redo,
        keepDraft,
        loadLatest,
        retryLoad,
        visualError,
        inspectComponent,
        prepareKernelEntry,
        applyPreparedKernelEntry,
        applyKernelEntry,
        applyVisualPropertyEntry,
        flushVisualPropertyEntry,
        adoptOpaqueElement,
    }
}
