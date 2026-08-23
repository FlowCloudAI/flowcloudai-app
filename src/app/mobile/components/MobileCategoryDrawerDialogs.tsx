import type {CSSProperties} from 'react'
import {Button} from 'flowcloudai-ui'
import type {Category} from '../../../api'
import {ActionMenu, FloatingPanel, RenameDialog} from '../../../shared/ui/overlay'
import type {CategoryRow, DeleteMode, SiblingDirection} from './mobileCategoryTree'

interface Props {
    busy: boolean
    menuTarget: Category | null
    onCloseMenu: () => void
    onOpenCategory: (category: Category) => void
    onCreateChild: (category: Category) => void
    onRenameCategory: (category: Category) => void
    onChooseMove: (category: Category) => void
    canMoveUp: boolean
    canMoveDown: boolean
    onMoveSibling: (category: Category, direction: SiblingDirection) => void
    onChooseDelete: (category: Category) => void
    renameOpen: boolean
    renameTitle: string
    renameLabel?: string
    renameInitialValue: string
    renameConfirmText: string
    onCloseRename: () => void
    onConfirmRename: (name: string) => void
    moveTarget: Category | null
    moveCandidates: CategoryRow[]
    onCloseMove: () => void
    onMove: (parentId: string | null) => void
    deleteTarget: Category | null
    deleteImpact: {categoryCount: number; entryCount: number; childCount: number} | null
    onCloseDelete: () => void
    onDelete: (mode: DeleteMode) => void
}

export default function MobileCategoryDrawerDialogs(props: Props) {
    const {busy, menuTarget, moveTarget, moveCandidates, onCloseMove, onMove, deleteTarget, deleteImpact, onCloseDelete, onDelete} = props
    return <>
        <ActionMenu open={!!menuTarget} onClose={props.onCloseMenu} title={menuTarget?.name} items={menuTarget ? [
            {key: 'open', label: '浏览词条', onSelect: () => props.onOpenCategory(menuTarget)},
            {key: 'create-child', label: '新建子分类', onSelect: () => props.onCreateChild(menuTarget)},
            {key: 'rename', label: '重命名', onSelect: () => props.onRenameCategory(menuTarget)},
            {key: 'move', label: '移动到…', onSelect: () => props.onChooseMove(menuTarget)},
            {key: 'move-up', label: '上移一位', disabled: !props.canMoveUp || busy, onSelect: () => props.onMoveSibling(menuTarget, 'up')},
            {key: 'move-down', label: '下移一位', disabled: !props.canMoveDown || busy, onSelect: () => props.onMoveSibling(menuTarget, 'down')},
            {key: 'delete', label: '删除分类', danger: true, onSelect: () => props.onChooseDelete(menuTarget)},
        ] : []}/>
        <RenameDialog open={props.renameOpen} title={props.renameTitle} label={props.renameLabel} initialValue={props.renameInitialValue} placeholder="分类名称" confirmText={props.renameConfirmText} busy={busy} onClose={props.onCloseRename} onConfirm={props.onConfirmRename}/>
        <FloatingPanel open={!!moveTarget} onClose={onCloseMove} dismissible={!busy} title="移动分类" ariaLabel="移动分类" className="mobile-category-drawer-dialog">
            <div className="mobile-category-drawer-dialog__summary">将「{moveTarget?.name ?? ''}」移动到新的父分类。</div>
            <div className="mobile-category-drawer-parent-list">
                <button type="button" className={`mobile-category-drawer-parent-list__item${(moveTarget?.parent_id ?? null) === null ? ' is-current' : ''}`} aria-current={(moveTarget?.parent_id ?? null) === null ? 'true' : undefined} disabled={busy} onClick={() => onMove(null)}>根级分类</button>
                {moveCandidates.map(row => <button type="button" key={row.category.id} className={`mobile-category-drawer-parent-list__item${moveTarget?.parent_id === row.category.id ? ' is-current' : ''}`} aria-current={moveTarget?.parent_id === row.category.id ? 'true' : undefined} style={{'--mobile-category-drawer-depth': row.depth} as CSSProperties} disabled={busy} onClick={() => onMove(row.category.id)}>{row.category.name}</button>)}
            </div>
            <div className="mobile-category-drawer-dialog__actions"><Button type="button" variant="ghost" size="sm" radius="full" disabled={busy} onClick={onCloseMove}>取消</Button></div>
        </FloatingPanel>
        <FloatingPanel open={!!deleteTarget} onClose={onCloseDelete} dismissible={!busy} title="删除分类" ariaLabel="删除分类" className="mobile-category-drawer-dialog">
            <div className="mobile-category-drawer-dialog__summary">「{deleteTarget?.name ?? ''}」包含 {deleteImpact?.categoryCount ?? 0} 个分类节点、{deleteImpact?.entryCount ?? 0} 个词条。</div>
            <div className="mobile-category-drawer-delete-options">
                <Button type="button" variant="outline" size="sm" radius="full" block disabled={busy} onClick={() => onDelete('empty')}>仅删除空分类</Button>
                <Button type="button" variant="secondary" size="sm" radius="full" block disabled={busy} onClick={() => onDelete('lift')}>子项上移保留</Button>
                <Button type="button" variant="danger" size="sm" radius="full" block disabled={busy} onClick={() => onDelete('cascade')}>连同子分类和词条删除</Button>
            </div>
            {deleteImpact && deleteImpact.childCount > 0 && <div className="mobile-category-drawer-dialog__hint">“子项上移保留”会把直接子分类和词条移动到当前分类的父级。</div>}
            <div className="mobile-category-drawer-dialog__actions"><Button type="button" variant="ghost" size="sm" radius="full" disabled={busy} onClick={onCloseDelete}>取消</Button></div>
        </FloatingPanel>
    </>
}
