// 本组件把领域层投影呈现为可折叠组件树；未纳入节点也可选中，后续由属性面板决定可用操作。

import {useState} from 'react'
import type {LayerProjectionNode} from '../../domain/layerProjection.ts'
import {
    PageDocumentDisclosureIcon,
    PageDocumentLayerKindIcon,
} from '../icons/PageDocumentLayerIcons.tsx'
import {pageDocumentLayerLabel} from './layerTreePresentation.ts'
import './PageDocumentLayerTree.css'

interface PageDocumentLayerTreeProps {
    nodes: readonly LayerProjectionNode[]
    selectedNodeId: string | null
    onSelect: (nodeId: string) => void
}

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
            <div className={`page-document-layer-node${node.id === selectedNodeId ? ' is-selected' : ''}${node.managed ? '' : ' is-unmanaged'}`}>
                <button
                    type="button"
                    className="page-document-layer-node__toggle"
                    disabled={!hasChildren}
                    aria-label={expanded ? '收起图层' : '展开图层'}
                    onClick={() => setExpanded(current => !current)}
                >
                    {hasChildren && <PageDocumentDisclosureIcon expanded={expanded}/>}
                </button>
                <button
                    type="button"
                    className="page-document-layer-node__select"
                    title={node.managed ? '可视编辑组件' : node.kind === 'operation' ? '模板生成节点' : '该元素尚未纳入可视编辑'}
                    onClick={() => onSelect(node.id)}
                >
                    <span className="page-document-layer-node__icon" aria-hidden="true">
                        <PageDocumentLayerKindIcon kind={node.kind}/>
                    </span>
                    <span>{pageDocumentLayerLabel(node)}</span>
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
