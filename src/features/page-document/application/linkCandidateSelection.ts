// 本模块在宿主草稿中复核双链候选范围，并以一次内核批次写入受管 HTML 内链；不信任画布临时 DOM。

import type {EntryBrief} from '../../../api/worldflow.ts'
import type {CanvasLinkCandidateIntentMessage} from '../canvas/protocol/index.ts'
import {idempotencyKey, utf16Range, type EditIntent} from '../domain/kernel/index.ts'
import {RFC_9562_UUID_PATTERN} from '../domain/uuidPolicy.ts'
import {requireKernelComponentHandle, type KernelDraftEditRequest} from './documentKernelDraftRuntime.ts'
import {readCanvasInputTarget} from './canvasInputOperation.ts'

export function pageDocumentLinkCandidates(
    entries: readonly EntryBrief[],
    currentEntryId: string,
    query: string,
): EntryBrief[] {
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter(entry => entry.id !== currentEntryId
        && (!needle || entry.title.toLocaleLowerCase().includes(needle))).slice(0, 8)
}

export function createLinkCandidateKernelRequest(
    articleHtml: string,
    candidate: CanvasLinkCandidateIntentMessage,
    entry: EntryBrief,
): KernelDraftEditRequest | null {
    if (candidate.query === null || !RFC_9562_UUID_PATTERN.test(entry.id)) return null
    const target = readCanvasInputTarget(articleHtml, candidate.nodeId)
    if (!target || candidate.from < 0 || candidate.to > target.text.length) return null
    const prefix = `[[${candidate.query}`
    if (target.text.slice(candidate.from, candidate.to) !== prefix) return null
    const closes = target.text.slice(candidate.to, candidate.to + 2) === ']]'
    const to = candidate.to + (closes ? 2 : 0)
    const expected = target.text.slice(candidate.from, to)
    const title = entry.title.trim()
    if (!title) return null
    const href = `fc://self/entry/${entry.id.toLowerCase()}`
    return {
        nodeIds: [candidate.nodeId.toLowerCase()],
        idempotencyKey: idempotencyKey(`link-candidate:${candidate.intentId.toLowerCase()}`),
        interactionId: null,
        authorizedScopes: ['entry'],
        createIntents(handles) {
            const component = requireKernelComponentHandle(handles, candidate.nodeId)
            return [
                {
                    kind: 'replace-text',
                    target: {kind: 'text-range', component, range: utf16Range(candidate.from, to), expected},
                    coordinateSpace: 'current-candidate',
                    text: title,
                },
                {
                    kind: 'set-link',
                    target: {
                        kind: 'text-range',
                        component,
                        range: utf16Range(candidate.from, candidate.from + title.length),
                        expected: title,
                    },
                    coordinateSpace: 'current-candidate',
                    href,
                },
            ] satisfies EditIntent[]
        },
    }
}
