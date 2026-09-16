// 本模块只管理运行时授予的可编辑属性；作者源码中的同名属性仍由隔离策略拒绝。

import {CANVAS_EDITABLE_KINDS} from '../protocol/index.ts'

export {CANVAS_EDITABLE_KINDS}

const editableKinds = new Set<string>(CANVAS_EDITABLE_KINDS)

export function isCanvasEditableElement(value: Element | null): value is HTMLElement {
    return value instanceof HTMLElement
        && editableKinds.has(value.getAttribute('data-fc-node-kind') ?? '')
        && value.hasAttribute('data-fc-node-id')
}

/** 每次渲染后从零重建权限，避免旧节点或作者属性继承编辑能力。 */
export function applyCanvasEditingState(root: ParentNode, enabled: boolean): void {
    root.querySelectorAll('[data-fc-canvas-editable], [contenteditable]').forEach(node => {
        node.removeAttribute('data-fc-canvas-editable')
        node.removeAttribute('contenteditable')
    })
    if (!enabled) return
    root.querySelectorAll('[data-fc-node-id][data-fc-node-kind]').forEach(node => {
        const kind = node.getAttribute('data-fc-node-kind') ?? ''
        if (!editableKinds.has(kind)) return
        node.setAttribute('data-fc-canvas-editable', '')
        node.setAttribute('contenteditable', 'plaintext-only')
    })
}
