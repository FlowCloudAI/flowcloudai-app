// 本组件把领域层的只读投影呈现为可折叠图层树；只有托管节点可以送回画布选中。

import {useState} from 'react'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import './PageDocumentLayerTree.css'

interface PageDocumentLayerTreeProps {
    nodes: readonly LayerProjectionNode[]
    selectedNodeId: string | null
    onSelect: (nodeId: string) => void
}

const KIND_ICON: Readonly<Record<string, string>> = Object.freeze({
    container: '▣',
    paragraph: '¶',
    heading: 'H',
    image: '▧',
    link: '↗',
    list: '≡',
    'list-item': '•',
    table: '▦',
    'table-cell': '▫',
    quote: '❞',
    divider: '—',
    operation: '◇',
    source: '⌘',
})

function LayerNode({
    node,
    selectedNodeId,
    onSelect,
}: {
    node: LayerProjectionNode
    selectedNodeId: string | null
    onSelect: (nodeId: string) => void
}) {
    const [expanded, setExpanded] = useState(true)
    const hasChildren = node.children.length > 0
    return (
        <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
            <div className={`page-document-layer-node${node.id === selectedNodeId ? ' is-selected' : ''}`}>
                <button
                    type="button"
                    className="page-document-layer-node__toggle"
                    disabled={!hasChildren}
                    aria-label={expanded ? '收起图层' : '展开图层'}
                    onClick={() => setExpanded(current => !current)}
                >
                    {hasChildren ? (expanded ? '⌄' : '›') : ''}
                </button>
                <button
                    type="button"
                    className="page-document-layer-node__select"
                    disabled={!node.managed}
                    title={node.managed ? node.label : '源码结构只读，不可在画布中选中'}
                    onClick={() => node.managed && onSelect(node.id)}
                >
                    <span className="page-document-layer-node__icon" aria-hidden="true">
                        {KIND_ICON[node.kind] ?? '□'}
                    </span>
                    <span>{node.label}</span>
                </button>
            </div>
            {hasChildren && expanded && (
                <ul role="group">
                    {node.children.map(child => (
                        <LayerNode
                            key={child.id}
                            node={child}
                            selectedNodeId={selectedNodeId}
                            onSelect={onSelect}
                        />
                    ))}
                </ul>
            )}
        </li>
    )
}

export function PageDocumentLayerTree({nodes, selectedNodeId, onSelect}: PageDocumentLayerTreeProps) {
    if (nodes.length === 0) {
        return <p className="page-document-layer-tree__empty">当前源码没有可显示的图层。</p>
    }
    return (
        <ul className="page-document-layer-tree" role="tree" aria-label="页面图层">
            {nodes.map(node => (
                <LayerNode
                    key={node.id}
                    node={node}
                    selectedNodeId={selectedNodeId}
                    onSelect={onSelect}
                />
            ))}
        </ul>
    )
}
