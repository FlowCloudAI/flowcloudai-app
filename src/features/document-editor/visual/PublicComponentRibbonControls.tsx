// 本组件把项目公共组件定义接入插入页签；实例只写入稳定引用，预览通过受管资产帧显示。

import {useState} from 'react'
import {Component, PackagePlus, Pencil, Plus, Trash2} from 'lucide-react'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    pageDocumentComponentErrorMessage,
    type PageDocumentAsset,
} from '../../../api/pageDocument.ts'
import type {LayerProjectionNode} from '../../page-document/domain/layerProjection.ts'
import type {PublicComponentDefinitionContract} from '../../page-document/domain/kernel/contracts/publicComponent.ts'
import type {KernelDraftEditRequest} from '../../page-document/application/documentKernelDraftRuntime.ts'
import {createPublicComponentInsertionRequest} from '../../page-document/application/publicComponentEditing.ts'
import {PageDocumentAssetThumbnail} from '../../page-document/components/assets/PageDocumentAssetPicker.tsx'
import {DocumentRibbonGroup} from './DocumentOfficeRibbon.tsx'
import './PublicComponentRibbonControls.css'

export function PublicComponentRibbonControls({
    definitions,
    warning,
    assets,
    selected,
    applyKernelEntry,
    onInserted,
    onOpenCreate,
    onOpenEdit,
    onSaveSelected,
    onDelete,
}: {
    definitions: readonly PublicComponentDefinitionContract[]
    warning: string | null
    assets: readonly PageDocumentAsset[]
    selected: LayerProjectionNode | null
    applyKernelEntry: (request: KernelDraftEditRequest, label: string, options?: {immediate?: boolean}) => Promise<boolean>
    onInserted: (nodeId: string) => void
    onOpenCreate: () => void
    onOpenEdit: (definition: PublicComponentDefinitionContract) => void
    onSaveSelected: () => void
    onDelete: (componentId: string) => Promise<void>
}) {
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const {showAlert} = useAlert()
    const canInsert = selected?.managed && selected.kind === 'container'
    const latestDefinitions = [...definitions.reduce((latest, definition) => {
        const key = definition.componentId.toLowerCase()
        const current = latest.get(key)
        if (!current || definition.revision > current.revision) latest.set(key, definition)
        return latest
    }, new Map<string, PublicComponentDefinitionContract>()).values()]
    const byCategory = new Map<string, PublicComponentDefinitionContract[]>()
    for (const definition of latestDefinitions) {
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
    const remove = async (definition: PublicComponentDefinitionContract) => {
        const confirmed = await showAlert(
            `删除公共组件“${definition.name}”及其全部修订？仍被页面实例引用时后端会拒绝。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return
        setDeletingId(definition.componentId)
        setError(null)
        try {
            await onDelete(definition.componentId)
        } catch (cause) {
            setError(pageDocumentComponentErrorMessage(cause))
        } finally {
            setDeletingId(null)
        }
    }
    const canCapture = Boolean(selected?.managed && selected.kind !== 'component')
    return <div className="public-component-ribbon">
        <div className="public-component-ribbon__toolbar">
            <Button type="button" size="sm" variant="outline" onClick={onOpenCreate}>
                <Plus size={13} /> 新建组件
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!canCapture} onClick={onSaveSelected}>
                <PackagePlus size={13} /> 保存选中内容
            </Button>
            {!canInsert && <p className="public-component-ribbon__hint">先选择一个容器作为公共组件插入位置。</p>}
            {warning && <p className="public-component-ribbon__hint" role="status">{warning}</p>}
            {error && <p className="public-component-ribbon__error" role="alert">{error}</p>}
        </div>
        {latestDefinitions.length === 0 && <div className="public-component-ribbon-empty" role="status">当前项目没有可用的公共组件定义。</div>}
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
                        <Button type="button" size="sm" variant="ghost" onClick={() => onOpenEdit(definition)}>
                            <Pencil size={13} /> 编辑
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`删除公共组件 ${definition.name}`}
                            disabled={deletingId !== null}
                            onClick={() => void remove(definition)}
                        >
                            <Trash2 size={13} /> {deletingId === definition.componentId ? '删除中…' : '删除'}
                        </Button>
                    </article>
                })}
            </div>
        </DocumentRibbonGroup>)}
    </div>
}
