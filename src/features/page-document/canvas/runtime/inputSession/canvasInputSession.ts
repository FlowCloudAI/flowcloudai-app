// 本模块实现 ADR 0007 的画布侧纯状态机；它只处理语义文本、因果基线与动作日志，不读取或修改 DOM。

import type {CanvasStoredMarks} from '../../protocol/index.ts'

export type CanvasSessionEditKind =
    | 'insert-text'
    | 'delete'
    | 'line-break'
    | 'split-block'
    | 'paste'
    | 'composition'
    | 'undo'
    | 'redo'

export type CanvasSessionOutcomeKind = 'accepted' | 'rejected' | 'cancelled'

export interface CanvasBridgeSessionIdentity {
    readonly sessionToken: string
    readonly runtimeInstanceId: string
}

export interface CanvasSessionBase {
    readonly epoch: number
    readonly version: number
    readonly watermark: number
    readonly lastForeignVersion: number
}

export interface CanvasSessionOutcome {
    readonly seq: number
    readonly batchId: string
    readonly status: CanvasSessionOutcomeKind
    readonly reason: string | null
}

export interface CanvasSessionLanding {
    readonly nodeId: string
    readonly offset: number
}

export interface CanvasSessionSnapshot extends CanvasSessionBase {
    readonly identity: CanvasBridgeSessionIdentity
    readonly outcomes: readonly CanvasSessionOutcome[]
    readonly html: string
    readonly css: string
    readonly landing: CanvasSessionLanding | null
}

/** 由接线层从权威预览派生；纯状态机只关心每个受管节点的语义文本和顺序。 */
export interface CanvasSemanticDocument {
    readonly order: readonly string[]
    readonly nodes: Readonly<Record<string, string>>
}

export interface CanvasSessionSelection {
    readonly nodeId: string
    readonly from: number
    readonly to: number
}

export interface CanvasSessionEditAction {
    readonly identity: CanvasBridgeSessionIdentity
    readonly seq: number
    readonly batchId: string
    readonly batchIndex: number
    readonly batchSize: number
    readonly recoveryGroupId: string
    readonly kind: CanvasSessionEditKind
    readonly targetNodeId: string | null
    readonly from: number
    readonly to: number
    readonly expected: string
    readonly text: string
    readonly storedMarks: CanvasStoredMarks | null
    readonly newNodeId: string | null
    readonly base: CanvasSessionBase
}

export interface CanvasSessionEditDraft {
    readonly kind: CanvasSessionEditKind
    readonly targetNodeId?: string
    readonly from?: number
    readonly to?: number
    readonly expected?: string
    readonly text?: string
    readonly batchId?: string
    readonly batchIndex?: number
    readonly batchSize?: number
    readonly recoveryGroupId?: string
}

export interface CanvasSessionSelectionAction {
    readonly order: number
    readonly afterSeq: number
    readonly kind: 'pointer' | 'direction'
    readonly selection: CanvasSessionSelection
}

export interface CanvasSessionRecoveryEmission {
    readonly documentId: string
    readonly epoch: number
    readonly groupId: string
    readonly actions: readonly CanvasSessionEditAction[]
    readonly reason: string
    readonly insertableText: string | null
}

interface CanvasCompositionLock {
    readonly targetNodeId: string
    readonly from: number
    readonly to: number
    readonly expected: string
    readonly storedMarks: CanvasStoredMarks | null
    readonly base: CanvasSessionBase
    readonly recoveryGroupId: string
}

interface DeferredCanvasSnapshot {
    readonly snapshot: CanvasSessionSnapshot
    readonly document: CanvasSemanticDocument
}

interface BufferedCanvasEdit {
    readonly kind: Exclude<CanvasSessionEditKind, 'split-block' | 'undo' | 'redo'>
    readonly text: string
    readonly deleteBefore: number
    readonly deleteAfter: number
    readonly storedMarks: CanvasStoredMarks | null
    readonly recoveryGroupId: string
}

interface CanvasUndoWait {
    readonly seq: number
    readonly action: 'undo' | 'redo'
    readonly cancelled: boolean
    readonly buffered: readonly BufferedCanvasEdit[]
}

export interface CanvasInputSessionState {
    readonly documentId: string
    readonly identity: CanvasBridgeSessionIdentity
    readonly mounted: CanvasSessionSnapshot
    readonly authoritativeDocument: CanvasSemanticDocument
    readonly visibleDocument: CanvasSemanticDocument
    readonly selection: CanvasSessionSelection | null
    readonly storedMarks: CanvasStoredMarks | null
    readonly pendingActions: readonly CanvasSessionEditAction[]
    readonly selectionActions: readonly CanvasSessionSelectionAction[]
    readonly receivedOutcomes: readonly CanvasSessionOutcome[]
    readonly consumedThrough: number
    readonly nextSeq: number
    readonly nextSelectionOrder: number
    readonly composition: CanvasCompositionLock | null
    readonly deferredSnapshot: DeferredCanvasSnapshot | null
    readonly undoWait: CanvasUndoWait | null
    readonly reservedNodeIds: readonly string[]
    readonly consumedNodeIds: Readonly<Record<string, number>>
    readonly diagnostics: readonly string[]
}

export interface CanvasSessionTransition {
    readonly state: CanvasInputSessionState
    readonly emittedActions: readonly CanvasSessionEditAction[]
    readonly recoveries: readonly CanvasSessionRecoveryEmission[]
    readonly acknowledgeThrough: number
    readonly mounted: boolean
    readonly replayedSeqs: readonly number[]
    readonly blockedReason: string | null
}

function freezeMarks(marks: CanvasStoredMarks | null): CanvasStoredMarks | null {
    return marks
        ? Object.freeze({styleContext: marks.styleContext, values: Object.freeze({...marks.values})})
        : null
}

function freezeDocument(document: CanvasSemanticDocument): CanvasSemanticDocument {
    return Object.freeze({
        order: Object.freeze([...document.order]),
        nodes: Object.freeze({...document.nodes}),
    })
}

function sameIdentity(left: CanvasBridgeSessionIdentity, right: CanvasBridgeSessionIdentity): boolean {
    return left.sessionToken === right.sessionToken && left.runtimeInstanceId === right.runtimeInstanceId
}

function actionSelection(action: CanvasSessionEditAction): CanvasSessionSelection | null {
    if (action.kind === 'undo' || action.kind === 'redo') return null
    if (action.kind === 'split-block') {
        return action.newNodeId
            ? Object.freeze({nodeId: action.newNodeId, from: 0, to: 0})
            : null
    }
    return action.targetNodeId
        ? Object.freeze({
              nodeId: action.targetNodeId,
              from: action.from + action.text.length,
              to: action.from + action.text.length,
          })
        : null
}

function validSelection(document: CanvasSemanticDocument, selection: CanvasSessionSelection | null): boolean {
    if (!selection) return false
    const text = document.nodes[selection.nodeId]
    return text !== undefined && selection.from >= 0 && selection.to >= selection.from && selection.to <= text.length
}

function applyAction(
    document: CanvasSemanticDocument,
    action: CanvasSessionEditAction,
): {readonly accepted: boolean; readonly document: CanvasSemanticDocument} {
    if (action.kind === 'undo' || action.kind === 'redo') {
        return Object.freeze({accepted: true, document})
    }
    const nodeId = action.targetNodeId
    if (!nodeId) return Object.freeze({accepted: false, document})
    const current = document.nodes[nodeId]
    if (
        current === undefined ||
        action.from < 0 ||
        action.to < action.from ||
        action.to > current.length ||
        current.slice(action.from, action.to) !== action.expected
    ) {
        return Object.freeze({accepted: false, document})
    }
    if (action.kind === 'split-block') {
        if (!action.newNodeId || document.nodes[action.newNodeId] !== undefined) {
            return Object.freeze({accepted: false, document})
        }
        const index = document.order.indexOf(nodeId)
        if (index < 0) return Object.freeze({accepted: false, document})
        const nodes = {
            ...document.nodes,
            [nodeId]: current.slice(0, action.from),
            [action.newNodeId]: current.slice(action.to),
        }
        const order = [...document.order]
        order.splice(index + 1, 0, action.newNodeId)
        return Object.freeze({accepted: true, document: freezeDocument({order, nodes})})
    }
    const text = `${current.slice(0, action.from)}${action.text}${current.slice(action.to)}`
    return Object.freeze({
        accepted: true,
        document: freezeDocument({order: document.order, nodes: {...document.nodes, [nodeId]: text}}),
    })
}

function continuousOutcomeWatermark(outcomes: readonly CanvasSessionOutcome[]): number {
    const sequences = new Set(outcomes.map(item => item.seq))
    let cursor = 0
    while (sequences.has(cursor + 1)) cursor += 1
    return cursor
}

function mergeOutcomes(
    current: readonly CanvasSessionOutcome[],
    incoming: readonly CanvasSessionOutcome[],
): readonly CanvasSessionOutcome[] {
    const bySequence = new Map(current.map(item => [item.seq, item]))
    for (const outcome of incoming) {
        if (!bySequence.has(outcome.seq)) bySequence.set(outcome.seq, Object.freeze({...outcome}))
    }
    return Object.freeze([...bySequence.values()].sort((left, right) => left.seq - right.seq))
}

function snapshotOrder(left: CanvasSessionSnapshot, right: CanvasSessionSnapshot): number {
    if (left.epoch !== right.epoch) return left.epoch - right.epoch
    if (left.version !== right.version) return left.version - right.version
    return left.watermark - right.watermark
}

function failureInInterval(
    outcomes: readonly CanvasSessionOutcome[],
    fromExclusive: number,
    toExclusive: number,
): boolean {
    return outcomes.some(outcome =>
        outcome.seq > fromExclusive &&
        outcome.seq < toExclusive &&
        outcome.status !== 'accepted',
    )
}

function recoveryText(actions: readonly CanvasSessionEditAction[]): string | null {
    if (actions.length === 0) return null
    if (actions.some(action =>
        action.kind === 'delete' ||
        action.kind === 'split-block' ||
        action.kind === 'line-break' ||
        action.kind === 'undo' ||
        action.kind === 'redo' ||
        action.from !== action.to,
    )) return null
    const first = actions[0]
    let offset = first.from
    let result = ''
    for (const action of actions) {
        if (action.targetNodeId !== first.targetNodeId || action.from !== offset) return null
        result += action.text
        offset += action.text.length
    }
    return result || null
}

function recoveryEmissions(
    state: CanvasInputSessionState,
    actions: readonly CanvasSessionEditAction[],
    reason: string,
): readonly CanvasSessionRecoveryEmission[] {
    const groups = new Map<string, CanvasSessionEditAction[]>()
    for (const action of actions) {
        const group = groups.get(action.recoveryGroupId) ?? []
        group.push(action)
        groups.set(action.recoveryGroupId, group)
    }
    return Object.freeze([...groups.entries()].map(([groupId, grouped]) => Object.freeze({
        documentId: state.documentId,
        epoch: grouped[0]?.base.epoch ?? state.mounted.epoch,
        groupId,
        actions: Object.freeze(grouped),
        reason,
        insertableText: recoveryText(grouped),
    })))
}

function bufferedRecoveryActions(
    state: CanvasInputSessionState,
    wait: CanvasUndoWait,
): readonly CanvasSessionEditAction[] {
    return Object.freeze(wait.buffered.map((buffered, index): CanvasSessionEditAction => Object.freeze({
        identity: state.identity,
        seq: state.nextSeq + index,
        batchId: `buffered-wait:${wait.seq}`,
        batchIndex: index,
        batchSize: wait.buffered.length,
        recoveryGroupId: buffered.recoveryGroupId,
        kind: buffered.kind,
        targetNodeId: state.selection?.nodeId ?? null,
        from: state.selection?.from ?? 0,
        to: state.selection?.to ?? 0,
        expected: '',
        text: buffered.text,
        storedMarks: buffered.storedMarks,
        newNodeId: null,
        base: baseFromMounted(state),
    })))
}

function baseFromMounted(state: CanvasInputSessionState): CanvasSessionBase {
    const {epoch, version, watermark, lastForeignVersion} = state.mounted
    return Object.freeze({epoch, version, watermark, lastForeignVersion})
}

function transition(
    state: CanvasInputSessionState,
    options: Partial<Omit<CanvasSessionTransition, 'state' | 'acknowledgeThrough'>> = {},
): CanvasSessionTransition {
    return Object.freeze({
        state,
        emittedActions: options.emittedActions ?? Object.freeze([]),
        recoveries: options.recoveries ?? Object.freeze([]),
        acknowledgeThrough: state.consumedThrough,
        mounted: options.mounted ?? false,
        replayedSeqs: options.replayedSeqs ?? Object.freeze([]),
        blockedReason: options.blockedReason ?? null,
    })
}

export function createCanvasInputSessionState(input: {
    readonly documentId: string
    readonly snapshot: CanvasSessionSnapshot
    readonly document: CanvasSemanticDocument
    readonly selection?: CanvasSessionSelection | null
    readonly reservedNodeIds?: readonly string[]
}): CanvasInputSessionState {
    const selection = input.selection && validSelection(input.document, input.selection)
        ? Object.freeze({...input.selection})
        : null
    return Object.freeze({
        documentId: input.documentId,
        identity: Object.freeze({...input.snapshot.identity}),
        mounted: Object.freeze({...input.snapshot, outcomes: Object.freeze([...input.snapshot.outcomes])}),
        authoritativeDocument: freezeDocument(input.document),
        visibleDocument: freezeDocument(input.document),
        selection,
        storedMarks: null,
        pendingActions: Object.freeze([]),
        selectionActions: Object.freeze([]),
        receivedOutcomes: Object.freeze([]),
        consumedThrough: 0,
        nextSeq: 1,
        nextSelectionOrder: 1,
        composition: null,
        deferredSnapshot: null,
        undoWait: null,
        reservedNodeIds: Object.freeze([...(input.reservedNodeIds ?? [])]),
        consumedNodeIds: Object.freeze({}),
        diagnostics: Object.freeze([]),
    })
}

export function updateCanvasStoredMarks(
    state: CanvasInputSessionState,
    marks: CanvasStoredMarks | null,
): CanvasInputSessionState {
    if (!state.selection || state.selection.from !== state.selection.to) return state
    return Object.freeze({...state, storedMarks: freezeMarks(marks)})
}

export function supplyCanvasReservedNodeIds(
    state: CanvasInputSessionState,
    nodeIds: readonly string[],
): CanvasInputSessionState {
    const known = new Set([...state.reservedNodeIds, ...Object.keys(state.consumedNodeIds)])
    const additions = nodeIds.filter(nodeId => !known.has(nodeId))
    return additions.length === 0
        ? state
        : Object.freeze({...state, reservedNodeIds: Object.freeze([...state.reservedNodeIds, ...additions])})
}

function bufferedFromDraft(
    state: CanvasInputSessionState,
    draft: CanvasSessionEditDraft,
): BufferedCanvasEdit | null {
    if (draft.kind === 'split-block' || draft.kind === 'undo' || draft.kind === 'redo') return null
    const selection = state.selection
    if (!selection) return null
    const from = draft.from ?? selection.from
    const to = draft.to ?? selection.to
    return Object.freeze({
        kind: draft.kind,
        text: draft.text ?? '',
        deleteBefore: Math.max(0, selection.from - from),
        deleteAfter: Math.max(0, to - selection.to),
        storedMarks: freezeMarks(state.storedMarks),
        recoveryGroupId: draft.recoveryGroupId ?? `wait:${state.undoWait?.seq ?? state.nextSeq}`,
    })
}

export function recordCanvasEdit(
    state: CanvasInputSessionState,
    draft: CanvasSessionEditDraft,
): CanvasSessionTransition {
    if (state.composition && draft.kind !== 'composition') {
        return transition(state, {blockedReason: 'composition-active'})
    }
    if (state.undoWait && draft.kind !== 'undo' && draft.kind !== 'redo') {
        const buffered = bufferedFromDraft(state, draft)
        if (!buffered) return transition(state, {blockedReason: 'undo-wait-action-unsupported'})
        return transition(Object.freeze({
            ...state,
            undoWait: Object.freeze({
                ...state.undoWait,
                buffered: Object.freeze([...state.undoWait.buffered, buffered]),
            }),
        }))
    }
    const isHistory = draft.kind === 'undo' || draft.kind === 'redo'
    const selection = state.selection
    const targetNodeId = isHistory ? null : (draft.targetNodeId ?? selection?.nodeId ?? null)
    if (!isHistory && !targetNodeId) return transition(state, {blockedReason: 'selection-missing'})
    const current = targetNodeId ? state.visibleDocument.nodes[targetNodeId] : undefined
    const from = isHistory ? 0 : (draft.from ?? selection?.from ?? 0)
    const to = isHistory ? 0 : (draft.to ?? selection?.to ?? from)
    const expected = isHistory ? '' : (draft.expected ?? current?.slice(from, to) ?? '')
    let reservedNodeIds = state.reservedNodeIds
    let consumedNodeIds = state.consumedNodeIds
    let newNodeId: string | null = null
    if (draft.kind === 'split-block') {
        newNodeId = reservedNodeIds[0] ?? null
        if (!newNodeId) return transition(state, {blockedReason: 'reserved-node-id-exhausted'})
        reservedNodeIds = Object.freeze(reservedNodeIds.slice(1))
        consumedNodeIds = Object.freeze({...consumedNodeIds, [newNodeId]: state.nextSeq})
    }
    const batchId = draft.batchId ?? `canvas-batch:${state.nextSeq}`
    const action = Object.freeze({
        identity: state.identity,
        seq: state.nextSeq,
        batchId,
        batchIndex: draft.batchIndex ?? 0,
        batchSize: draft.batchSize ?? 1,
        recoveryGroupId: draft.recoveryGroupId ?? batchId,
        kind: draft.kind,
        targetNodeId,
        from,
        to,
        expected,
        text: draft.kind === 'line-break' ? '\n' : (draft.text ?? ''),
        storedMarks: freezeMarks(state.storedMarks),
        newNodeId,
        base: baseFromMounted(state),
    } satisfies CanvasSessionEditAction)
    const applied = applyAction(state.visibleDocument, action)
    if (!applied.accepted) return transition(state, {blockedReason: 'invalid-local-range'})
    const nextSelection = actionSelection(action) ?? state.selection
    const next = Object.freeze({
        ...state,
        visibleDocument: applied.document,
        selection: nextSelection,
        pendingActions: Object.freeze([...state.pendingActions, action]),
        nextSeq: state.nextSeq + 1,
        reservedNodeIds,
        consumedNodeIds,
        undoWait: isHistory
            ? Object.freeze({seq: action.seq, action: draft.kind, cancelled: false, buffered: Object.freeze([])})
            : state.undoWait,
    })
    return transition(next, {emittedActions: Object.freeze([action])})
}

export function recordCanvasSelectionAction(
    state: CanvasInputSessionState,
    kind: CanvasSessionSelectionAction['kind'],
    selection: CanvasSessionSelection,
): CanvasSessionTransition {
    if (state.undoWait) return transition(state, {blockedReason: 'undo-wait-selection-ignored'})
    if (!validSelection(state.visibleDocument, selection)) {
        return transition(state, {blockedReason: 'invalid-selection'})
    }
    const action = Object.freeze({
        order: state.nextSelectionOrder,
        afterSeq: state.nextSeq - 1,
        kind,
        selection: Object.freeze({...selection}),
    })
    return transition(Object.freeze({
        ...state,
        selection: action.selection,
        storedMarks: null,
        selectionActions: Object.freeze([...state.selectionActions, action]),
        nextSelectionOrder: state.nextSelectionOrder + 1,
    }))
}

export function beginCanvasComposition(
    state: CanvasInputSessionState,
    input: Pick<CanvasSessionEditDraft, 'targetNodeId' | 'from' | 'to' | 'expected' | 'recoveryGroupId'> = {},
): CanvasSessionTransition {
    if (state.composition) return transition(state, {blockedReason: 'composition-active'})
    const selection = state.selection
    const targetNodeId = input.targetNodeId ?? selection?.nodeId
    if (!selection || !targetNodeId) return transition(state, {blockedReason: 'selection-missing'})
    const from = input.from ?? selection.from
    const to = input.to ?? selection.to
    const text = state.visibleDocument.nodes[targetNodeId]
    if (text === undefined || from < 0 || to < from || to > text.length) {
        return transition(state, {blockedReason: 'invalid-selection'})
    }
    return transition(Object.freeze({
        ...state,
        composition: Object.freeze({
            targetNodeId,
            from,
            to,
            expected: input.expected ?? text.slice(from, to),
            storedMarks: freezeMarks(state.storedMarks),
            base: baseFromMounted(state),
            recoveryGroupId: input.recoveryGroupId ?? `composition:${state.nextSeq}`,
        }),
    }))
}

export function cancelCanvasComposition(state: CanvasInputSessionState): CanvasSessionTransition {
    if (!state.composition) return transition(state)
    const cleared = Object.freeze({...state, composition: null})
    return state.deferredSnapshot
        ? receiveCanvasSnapshot(
              Object.freeze({...cleared, deferredSnapshot: null}),
              state.deferredSnapshot.snapshot,
              state.deferredSnapshot.document,
          )
        : transition(cleared)
}

export function commitCanvasComposition(
    state: CanvasInputSessionState,
    text: string,
): CanvasSessionTransition {
    const locked = state.composition
    if (!locked) return transition(state, {blockedReason: 'composition-missing'})
    const batchId = `canvas-batch:${state.nextSeq}`
    const action = Object.freeze({
        identity: state.identity,
        seq: state.nextSeq,
        batchId,
        batchIndex: 0,
        batchSize: 1,
        recoveryGroupId: locked.recoveryGroupId,
        kind: 'composition' as const,
        targetNodeId: locked.targetNodeId,
        from: locked.from,
        to: locked.to,
        expected: locked.expected,
        text,
        storedMarks: locked.storedMarks,
        newNodeId: null,
        base: locked.base,
    } satisfies CanvasSessionEditAction)
    const applied = applyAction(state.visibleDocument, action)
    if (!applied.accepted) {
        return transition(Object.freeze({...state, composition: null}), {blockedReason: 'invalid-local-range'})
    }
    const next = Object.freeze({
        ...state,
        composition: null,
        visibleDocument: applied.document,
        selection: actionSelection(action),
        pendingActions: Object.freeze([...state.pendingActions, action]),
        nextSeq: state.nextSeq + 1,
    })
    if (!state.deferredSnapshot) return transition(next, {emittedActions: Object.freeze([action])})
    const settled = receiveCanvasSnapshot(
        Object.freeze({...next, deferredSnapshot: null}),
        state.deferredSnapshot.snapshot,
        state.deferredSnapshot.document,
    )
    return Object.freeze({
        ...settled,
        emittedActions: Object.freeze([action, ...settled.emittedActions]),
    })
}

function hasKnownFailure(
    action: CanvasSessionEditAction,
    outcomes: readonly CanvasSessionOutcome[],
): CanvasSessionOutcome | null {
    return outcomes.find(outcome => outcome.seq === action.seq && outcome.status !== 'accepted') ?? null
}

function latestValidSelectionAction(
    state: CanvasInputSessionState,
    lastReplaySeq: number,
    document: CanvasSemanticDocument,
    failedSeqs: ReadonlySet<number>,
): CanvasSessionSelection | null {
    const candidates = state.selectionActions
        // 选区动作记录的是“发生前最后一个编辑 seq”，因此等于最后重放 seq 即表示发生在其后。
        .filter(action => action.afterSeq >= lastReplaySeq)
        .sort((left, right) => right.order - left.order)
    for (const action of candidates) {
        const invalidView = state.pendingActions.some(edit =>
            edit.seq <= action.afterSeq && failedSeqs.has(edit.seq),
        )
        if (!invalidView && validSelection(document, action.selection)) return action.selection
    }
    return null
}

function materializeUndoBuffer(
    state: CanvasInputSessionState,
    landing: CanvasSessionSelection,
): {readonly state: CanvasInputSessionState; readonly actions: readonly CanvasSessionEditAction[]} {
    const wait = state.undoWait
    if (!wait || wait.cancelled || wait.buffered.length === 0) {
        return Object.freeze({state: Object.freeze({...state, undoWait: null}), actions: Object.freeze([])})
    }
    let next: CanvasInputSessionState = Object.freeze({...state, undoWait: null, selection: landing})
    const actions: CanvasSessionEditAction[] = []
    for (const buffered of wait.buffered) {
        const selection = next.selection
        if (!selection) break
        const nodeText = next.visibleDocument.nodes[selection.nodeId]
        if (nodeText === undefined) break
        const from = Math.max(0, selection.from - buffered.deleteBefore)
        const to = Math.min(nodeText.length, selection.to + buffered.deleteAfter)
        const marked = Object.freeze({...next, storedMarks: buffered.storedMarks})
        const result = recordCanvasEdit(marked, {
            kind: buffered.kind,
            targetNodeId: selection.nodeId,
            from,
            to,
            expected: nodeText.slice(from, to),
            text: buffered.text,
            recoveryGroupId: buffered.recoveryGroupId,
        })
        if (result.blockedReason) break
        next = result.state
        actions.push(...result.emittedActions)
    }
    return Object.freeze({state: next, actions: Object.freeze(actions)})
}

export function receiveCanvasSnapshot(
    state: CanvasInputSessionState,
    snapshot: CanvasSessionSnapshot,
    authoritativeDocument: CanvasSemanticDocument,
): CanvasSessionTransition {
    if (!sameIdentity(state.identity, snapshot.identity)) {
        return transition(Object.freeze({
            ...state,
            diagnostics: Object.freeze([...state.diagnostics, 'snapshot-bridge-session-mismatch']),
        }), {blockedReason: 'snapshot-bridge-session-mismatch'})
    }
    const outcomes = mergeOutcomes(state.receivedOutcomes, snapshot.outcomes)
    const consumedThrough = continuousOutcomeWatermark(outcomes)
    const withOutcomes = Object.freeze({...state, receivedOutcomes: outcomes, consumedThrough})
    if (state.composition) {
        const deferred = !state.deferredSnapshot || snapshotOrder(snapshot, state.deferredSnapshot.snapshot) >= 0
            ? Object.freeze({snapshot, document: freezeDocument(authoritativeDocument)})
            : state.deferredSnapshot
        return transition(Object.freeze({...withOutcomes, deferredSnapshot: deferred}))
    }
    if (snapshot.epoch < state.mounted.epoch) {
        return transition(Object.freeze({
            ...withOutcomes,
            diagnostics: Object.freeze([...state.diagnostics, 'snapshot-epoch-regressed']),
        }), {blockedReason: 'snapshot-epoch-regressed'})
    }
    if (snapshot.epoch === state.mounted.epoch && (
        snapshot.version < state.mounted.version || snapshot.watermark < state.mounted.watermark
    )) {
        return transition(Object.freeze({
            ...withOutcomes,
            diagnostics: Object.freeze([...state.diagnostics, 'snapshot-baseline-regressed']),
        }), {blockedReason: 'snapshot-baseline-regressed'})
    }
    if (
        snapshot.epoch === state.mounted.epoch &&
        snapshot.version === state.mounted.version &&
        (snapshot.html !== state.mounted.html || snapshot.css !== state.mounted.css)
    ) {
        return transition(Object.freeze({
            ...withOutcomes,
            diagnostics: Object.freeze([...state.diagnostics, 'snapshot-content-identity-violated']),
        }), {blockedReason: 'snapshot-content-identity-violated'})
    }

    if (snapshot.epoch > state.mounted.epoch) {
        const recoveries = recoveryEmissions(withOutcomes, state.pendingActions, 'epoch-changed')
        const waitActions = state.undoWait?.buffered.length
            ? recoveryEmissions(
                  withOutcomes,
                  bufferedRecoveryActions(state, state.undoWait),
                  'epoch-changed-during-undo-wait',
              )
            : Object.freeze([])
        const next = Object.freeze({
            ...withOutcomes,
            mounted: snapshot,
            authoritativeDocument: freezeDocument(authoritativeDocument),
            visibleDocument: freezeDocument(authoritativeDocument),
            selection: snapshot.landing && validSelection(authoritativeDocument, {...snapshot.landing, from: snapshot.landing.offset, to: snapshot.landing.offset})
                ? Object.freeze({nodeId: snapshot.landing.nodeId, from: snapshot.landing.offset, to: snapshot.landing.offset})
                : null,
            storedMarks: null,
            pendingActions: Object.freeze([]),
            selectionActions: Object.freeze([]),
            undoWait: null,
            reservedNodeIds: Object.freeze([]),
            consumedNodeIds: Object.freeze({}),
        })
        return transition(next, {recoveries: Object.freeze([...recoveries, ...waitActions]), mounted: true})
    }

    const oldDocument = state.visibleDocument
    const failed = new Set(outcomes.filter(item => item.status !== 'accepted').map(item => item.seq))
    const covered = state.pendingActions.filter(action => action.seq <= snapshot.watermark)
    const failedCovered = covered.filter(action => failed.has(action.seq))
    const recoveries: CanvasSessionRecoveryEmission[] = [...recoveryEmissions(
        withOutcomes,
        failedCovered,
        outcomes.find(item => failed.has(item.seq))?.reason ?? 'action-not-accepted',
    )]
    const pending = state.pendingActions.filter(action => action.seq > snapshot.watermark)
    let visible = freezeDocument(authoritativeDocument)
    const replayed: CanvasSessionEditAction[] = []
    const withdrawn: CanvasSessionEditAction[] = []
    for (const action of pending) {
        const terminalFailure = hasKnownFailure(action, outcomes)
        if (
            terminalFailure ||
            action.base.epoch !== snapshot.epoch ||
            action.base.version < snapshot.lastForeignVersion ||
            failureInInterval(outcomes, action.base.watermark, action.seq)
        ) {
            withdrawn.push(action)
            continue
        }
        const result = applyAction(visible, action)
        if (!result.accepted) {
            withdrawn.push(action)
            continue
        }
        visible = result.document
        replayed.push(action)
    }
    if (withdrawn.length > 0) recoveries.push(...recoveryEmissions(withOutcomes, withdrawn, 'replay-dependency-failed'))
    const lastReplay = replayed.at(-1)
    const authorSelection = latestValidSelectionAction(
        state,
        lastReplay?.seq ?? snapshot.watermark,
        visible,
        failed,
    )
    const landingSelection = snapshot.landing
        ? Object.freeze({nodeId: snapshot.landing.nodeId, from: snapshot.landing.offset, to: snapshot.landing.offset})
        : null
    const preservedSelection = state.selection &&
        oldDocument.nodes[state.selection.nodeId] === visible.nodes[state.selection.nodeId] &&
        validSelection(visible, state.selection)
        ? state.selection
        : null
    const selection = authorSelection ?? (lastReplay ? actionSelection(lastReplay) : null) ??
        (landingSelection && validSelection(visible, landingSelection) ? landingSelection : null) ??
        preservedSelection
    const mounted = Object.freeze({...snapshot, outcomes: Object.freeze([...snapshot.outcomes])})
    let next = Object.freeze({
        ...withOutcomes,
        mounted,
        authoritativeDocument: freezeDocument(authoritativeDocument),
        visibleDocument: visible,
        selection,
        storedMarks: selection ? state.storedMarks : null,
        pendingActions: Object.freeze(replayed),
        selectionActions: Object.freeze(state.selectionActions.filter(action => action.afterSeq > snapshot.watermark)),
    })
    let emittedActions: readonly CanvasSessionEditAction[] = Object.freeze([])
    const undoSettled = state.undoWait && snapshot.watermark >= state.undoWait.seq
    if (undoSettled) {
        const waitLanding = landingSelection && validSelection(visible, landingSelection)
            ? landingSelection
            : selection
        if (waitLanding) {
            const materialized = materializeUndoBuffer(next, waitLanding)
            next = materialized.state
            emittedActions = materialized.actions
        } else {
            const waitRecovery = recoveryEmissions(withOutcomes, [], 'undo-wait-landing-missing')
            recoveries.push(...waitRecovery)
            next = Object.freeze({...next, undoWait: null})
        }
    }
    return transition(next, {
        emittedActions,
        recoveries: Object.freeze(recoveries),
        mounted: snapshot.version > state.mounted.version || failedCovered.length > 0,
        replayedSeqs: Object.freeze(replayed.map(action => action.seq)),
    })
}

export function cancelCanvasUndoWait(state: CanvasInputSessionState): CanvasSessionTransition {
    const wait = state.undoWait
    if (!wait || wait.cancelled) return transition(state)
    const synthetic = bufferedRecoveryActions(state, wait)
    return transition(Object.freeze({
        ...state,
        undoWait: Object.freeze({...wait, cancelled: true, buffered: Object.freeze([])}),
    }), {recoveries: recoveryEmissions(state, synthetic, 'undo-wait-cancelled')})
}

export function restartCanvasInputSession(
    state: CanvasInputSessionState,
    identity: CanvasBridgeSessionIdentity,
    snapshot: CanvasSessionSnapshot,
    document: CanvasSemanticDocument,
): CanvasSessionTransition {
    const recoveries = recoveryEmissions(state, state.pendingActions, 'bridge-session-restarted')
    return transition(createCanvasInputSessionState({
        documentId: state.documentId,
        snapshot: {...snapshot, identity},
        document,
        selection: null,
    }), {recoveries, mounted: true})
}
