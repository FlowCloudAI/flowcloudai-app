// 本模块只从当前受管文本和光标偏移识别双链候选；会话身份与发送仍由画布运行时持有。

import {CANVAS_TEXT_FIELD_MAX_CODE_UNITS, type CanvasLinkCandidateIntentMessage} from '../protocol/index.ts'

type CandidatePayload = Omit<CanvasLinkCandidateIntentMessage, 'channel' | 'version' | 'sessionToken' | 'sequence'>

interface CandidateSnapshot {
    nodeId: string
    text: string
    caret: number
}

interface ActiveCandidate {
    intentId: string
    nodeId: string
    query: string
    from: number
    to: number
}

export function findCanvasLinkCandidate(text: string, caret: number): {query: string; from: number; to: number} | null {
    if (!Number.isInteger(caret) || caret < 0 || caret > text.length || caret > CANVAS_TEXT_FIELD_MAX_CODE_UNITS) return null
    const beforeCaret = text.slice(0, caret)
    const from = beforeCaret.lastIndexOf('[[')
    if (from < 0 || beforeCaret.lastIndexOf(']]') > from) return null
    const query = beforeCaret.slice(from + 2)
    if (query.length > 200) return null
    return {query, from, to: caret}
}

export function createCanvasLinkCandidateTracker(createId: () => string = () => crypto.randomUUID()) {
    let active: ActiveCandidate | null = null

    const clear = (): CandidatePayload | null => {
        if (!active) return null
        const leave: CandidatePayload = {
            type: 'link-candidate-intent',
            intentId: active.intentId,
            nodeId: active.nodeId,
            query: null,
            from: active.from,
            to: active.to,
        }
        active = null
        return leave
    }

    return {
        update(snapshot: CandidateSnapshot | null): CandidatePayload[] {
            const candidate = snapshot && findCanvasLinkCandidate(snapshot.text, snapshot.caret)
            if (!snapshot || !candidate) {
                const leave = clear()
                return leave ? [leave] : []
            }
            if (active?.nodeId === snapshot.nodeId && active.from === candidate.from) {
                if (active.query === candidate.query && active.to === candidate.to) return []
                active = {...active, ...candidate}
                return [{type: 'link-candidate-intent', ...active}]
            }
            const leave = clear()
            active = {intentId: createId(), nodeId: snapshot.nodeId, ...candidate}
            const enter: CandidatePayload = {type: 'link-candidate-intent', ...active}
            return leave ? [leave, enter] : [enter]
        },
        clear,
    }
}
