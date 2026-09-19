// 本组件把项目公共组件定义接入插入页签；实例只写入稳定引用，预览通过受管资产帧显示。

import {Component, Plus} from 'lucide-react'
import {Button} from 'flowcloudai-ui'
import type {PageDocumentAsset} from '../../../api/pageDocument.ts'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {PublicComponentDefinitionContract} from '../../page-document/domain/kernel/contracts/publicComponent.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {createPublicComponentInsertionRequest} from '../../page-document/application/publicComponentEditing.ts'
import {PageDocumentAssetThumbnail} from '../../page-document/components/assets/PageDocumentAssetPicker.tsx'
import {DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'
import './PublicComponentRibbonControls.css'

export function PublicComponentRibbonControls({
    definitions,
    assets,
    selected,
    applyKernelEntry,
    onInserted,
}: {
    definitions: readonly PublicComponentDefinitionContract[]
    assets: readonly PageDocumentAsset[]
    selected: LayerProjectionNode | null
    applyKernelEntry: (request: KernelDraftEditRequest, label: string, options?: {immediate?: boolean}) => Promise<boolean>
    onInserted: (nodeId: string) => void
}) {
    const canInsert = selected?.managed && selected.kind === 'container'
    const byCategory = new Map<string, PublicComponentDefinitionContract[]>()
    for (const definition of definitions) {
        const group = byCategory.get(definition.category) ?? []
        group.push(definition)
        byCategory.set(definition.category, group)
    }
    const insert = async (definition: PublicComponentDefinitionContract) => {
        if (!selected || !canInsert) return
        const allocated = createPublicComponentInsertionRequest(selected.id, definition)
        if (await applyKernelEntry(allocated.request, `插入公共组件 ${definition.name}`, {immediate: true})) {
            onInserted(allocated.newNodeId)
        }
    }
    if (definitions.length === 0) {
        return <div className="public-component-ribbon-empty" role="status">当前项目没有可用的公共组件定义。</div>
    }
    return <div className="public-component-ribbon">
        {!canInsert && <p className="public-component-ribbon__hint">先选择一个容器作为公共组件插入位置。</p>}
        {[...byCategory.entries()].map(([category, items]) => <DocumentRibbonGroup key={category} label={category} priority="normal" wide>
            <div className="public-component-ribbon__list">
                {items.map(definition => {
                    const preview = definition.preview
                        ? assets.find(asset => asset.id.toLowerCase() === definition.preview?.assetId.toLowerCase())
                        : undefined
                    return <article className="public-component-ribbon__item" key={`${definition.componentId}:${definition.revision}`}>
                        {preview ? <PageDocumentAssetThumbnail asset={preview} /> : <span className="public-component-ribbon__placeholder" aria-hidden="true"><Component size={20} /></span>}
                        <strong title={definition.name}>{definition.name}</strong>
                        <Button type="button" size="sm" disabled={!canInsert} onClick={() => void insert(definition)}>
                            <Plus size={13} /> 插入
                        </Button>
                    </article>
                })}
            </div>
        </DocumentRibbonGroup>)}
    </div>
}
