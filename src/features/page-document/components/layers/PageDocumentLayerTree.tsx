// 本组件把领域投影呈现为可折叠组件树；未纳入节点可选中，方向键行为沿用参考实现。

import {useMemo, useRef, useState, type KeyboardEvent} from 'react'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import {
    PageDocumentDisclosureIcon,
    PageDocumentLayerKindIcon,
} from '../icons/PageDocumentLayerIcons.tsx'
import {
    resolveLayerTreeKeyboardAction,
    visibleLayerTreeItems,
} from './layerTreeNavigation.ts'
import {pageDocumentLayerLabel} from './layerTreePresentation.ts'
import './PageDocumentLayerTree.css'

interface PageDocumentLayerTreeProps {
    nodes: readonly LayerProjectionNode[]
    selectedNodeId: string | null
    onSelect: (nodeId: string) => void
}

function LayerNode({
    node,
    level,
    selectedNodeId,
    activeRovingId,
    collapsedIds,
    onFocus,
    onKeyDown,
    onSelect,
    onToggle,
    register,
}: {
    node: LayerProjectionNode
    level: number
    selectedNodeId: string | null
    activeRovingId: string | null
    collapsedIds: ReadonlySet<string>
    onFocus: (nodeId: string) => void
    onKeyDown: (nodeId: string, event: KeyboardEvent<HTMLLIElement>) => void
    onSelect: (nodeId: string) => void
    onToggle: (nodeId: string) => void
    register: (nodeId: string, element: HTMLLIElement | null) => void
}) {
    const hasChildren = node.children.length > 0
    const expanded = hasChildren && !collapsedIds.has(node.id)
    const editingModeLabel = node.managed
        ? '可视编辑'
        : node.kind === 'operation' ? '模板生成' : '仅代码编辑'
    return (
        <li
            aria-expanded={hasChildren ? expanded : undefined}
            aria-level={level}
            aria-selected={node.id === selectedNodeId}
            onFocus={event => {
                if (event.target === event.currentTarget) onFocus(node.id)
            }}
            onKeyDown={event => onKeyDown(node.id, event)}
            ref={element => register(node.id, element)}
            role="treeitem"
            tabIndex={activeRovingId === node.id ? 0 : -1}
        >
            <div className={`page-document-layer-node${node.id === selectedNodeId ? ' is-selected' : ''}${node.managed ? '' : ' is-unmanaged'}`}>
                <button
                    type="button"
                    className="page-document-layer-node__toggle"
                    disabled={!hasChildren}
                    tabIndex={-1}
                    aria-label={expanded ? '收起图层' : '展开图层'}
                    onClick={event => {
                        event.stopPropagation()
                        onToggle(node.id)
                        onFocus(node.id)
                    }}
                >
                    {hasChildren && <PageDocumentDisclosureIcon expanded={expanded}/>}
                </button>
                <button
                    type="button"
                    className="page-document-layer-node__select"
                    tabIndex={-1}
                    aria-label={`${pageDocumentLayerLabel(node)} · ${editingModeLabel}`}
                    title={editingModeLabel}
                    onClick={() => {
                        onFocus(node.id)
                        onSelect(node.id)
                    }}
                >
                    <span className="page-document-layer-node__icon" aria-hidden="true">
                        <PageDocumentLayerKindIcon kind={node.kind}/>
                    </span>
                    <span>{pageDocumentLayerLabel(node)}</span>
                </button>
            </div>
            {expanded && (
                <ul role="group">
                    {node.children.map(child => (
                        <LayerNode
                            activeRovingId={activeRovingId}
                            collapsedIds={collapsedIds}
                            key={child.id}
                            level={level + 1}
                            node={child}
                            onFocus={onFocus}
                            onKeyDown={onKeyDown}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            register={register}
                            selectedNodeId={selectedNodeId}
                        />
                    ))}
                </ul>
            )}
        </li>
    )
}

export function PageDocumentLayerTree({nodes, selectedNodeId, onSelect}: PageDocumentLayerTreeProps) {
    const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())
    const [rovingId, setRovingId] = useState<string | null>(null)
    const itemRefs = useRef(new Map<string, HTMLLIElement>())
    const items = useMemo(() => visibleLayerTreeItems(nodes, collapsedIds), [collapsedIds, nodes])
    const visibleIds = useMemo(() => new Set(items.map(item => item.id)), [items])
    const activeRovingId = visibleIds.has(rovingId ?? '')
        ? rovingId
        : selectedNodeId && visibleIds.has(selectedNodeId)
          ? selectedNodeId
          : (items[0]?.id ?? null)
    const focus = (nodeId: string) => {
        setRovingId(nodeId)
        itemRefs.current.get(nodeId)?.focus()
    }
    const toggle = (nodeId: string) => {
        setCollapsedIds(current => {
            const next = new Set(current)
            if (next.has(nodeId)) next.delete(nodeId)
            else next.add(nodeId)
            return next
        })
    }
    const handleKeyDown = (nodeId: string, event: KeyboardEvent<HTMLLIElement>) => {
        if (event.target !== event.currentTarget) return
        const action = resolveLayerTreeKeyboardAction(items, nodeId, event.key)
        if (!action) return
        event.preventDefault()
        if (action.toggleId) toggle(action.toggleId)
        if (action.selectId) onSelect(action.selectId)
        focus(action.focusId)
    }
    const register = (nodeId: string, element: HTMLLIElement | null) => {
        if (element) itemRefs.current.set(nodeId, element)
        else itemRefs.current.delete(nodeId)
    }

    if (nodes.length === 0) {
        return <p className="page-document-layer-tree__empty">当前源码没有可显示的图层。</p>
    }
    return (
        <ul className="page-document-layer-tree" role="tree" aria-label="页面图层">
            {nodes.map(node => (
                <LayerNode
                    activeRovingId={activeRovingId}
                    collapsedIds={collapsedIds}
                    key={node.id}
                    level={1}
                    node={node}
                    onFocus={focus}
                    onKeyDown={handleKeyDown}
                    onSelect={onSelect}
                    onToggle={toggle}
                    register={register}
                    selectedNodeId={selectedNodeId}
                />
            ))}
        </ul>
    )
}
