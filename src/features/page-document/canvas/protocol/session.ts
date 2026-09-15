// 本模块管理会话 token、来源 Window 与单调序号；销毁后 gate 永久拒绝旧画布的消息。

import {PAGE_DOCUMENT_CANVAS_CHANNEL, PAGE_DOCUMENT_CANVAS_VERSION} from './constants.ts'
import type {
    CanvasEnvelope,
    CanvasHostCommand,
    CanvasMessageEventLike,
    CanvasRuntimeMessage,
} from './types.ts'
import {parseCanvasRuntimeMessage} from './validation.ts'

export type CanvasHostCommandPayload = CanvasHostCommand extends infer Message
    ? Message extends CanvasHostCommand
        ? Omit<Message, keyof CanvasEnvelope>
        : never
    : never

export function createCanvasSessionToken(randomValues: (bytes: Uint8Array) => Uint8Array = bytes => crypto.getRandomValues(bytes)): string {
    const bytes = randomValues(new Uint8Array(32))
    if (bytes.byteLength !== 32) throw new Error('画布会话 token 必须使用 32 字节随机值。')
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createCanvasHostCommandFactory(sessionToken: string): (payload: CanvasHostCommandPayload) => CanvasHostCommand {
    let sequence = 0
    return payload => ({
        channel: PAGE_DOCUMENT_CANVAS_CHANNEL,
        version: PAGE_DOCUMENT_CANVAS_VERSION,
        sessionToken,
        sequence: ++sequence,
        ...payload,
    }) as CanvasHostCommand
}

export interface CanvasRuntimeMessageGate {
    accept(event: CanvasMessageEventLike): CanvasRuntimeMessage | null
    destroy(): void
}

export function createCanvasRuntimeMessageGate(expectedSource: unknown, sessionToken: string): CanvasRuntimeMessageGate {
    let active = true
    let lastSequence = 0
    return {
        accept(event) {
            if (!active || event.source !== expectedSource) return null
            const message = parseCanvasRuntimeMessage(event.data, sessionToken)
            if (!message || message.sequence <= lastSequence) return null
            lastSequence = message.sequence
            return message
        },
        destroy() {
            active = false
        },
    }
}
