import {type CSSProperties, useCallback, useMemo, useState} from 'react'
import {Button, useAlert} from 'flowcloudai-ui'
import {
    db_cascade_delete_category,
    db_create_category,
    db_delete_category,
    db_delete_category_move_to_parent,
    db_update_category,
    type Category,
    type CategoryCascadeDeleteResult,
} from '../../../api'
import {invalidateProjectContext, useProjectContextStore} from '../../../features/projects/projectContextStore'
import {ActionMenu, FloatingPanel, RenameDialog} from '../../../shared/ui/overlay'
import {MobileAddIcon, MobileMoreIcon} from '../components/MobileTopControls'
import {
    buildAllRows,
    buildChildrenMap,
    collectDescendantIds,
    type DeleteMode,
    getEntryCountMap,
    parentKey,
    type RenameTarget,
} from '../components/mobileCategoryTree'
import {type MobilePage, type MobileProjectScopedPageParams} from '../usePageStack'
import './MobileCategoryManager.css'

interface Props {
    push: (page: MobilePage) => void
    params: MobileProjectScopedPageParams
}

export default function MobileCategoryManager({push, params}: Props) {
    const projectId = params.projectId
    const {showAlert} = useAlert()

    const projectContext = useProjectContextStore(projectId)
    const categories = projectContext.categories
    const stats = projectContext.stats
    const [busy, setBusy] = useState(false)
    const [menuTarget, setMenuTarget] = useState<Category | null>(null)
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
    const [moveTarget, setMoveTarget] = useState<Category | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)

    const childrenMap = useMemo(() => buildChildrenMap(categories), [categories])
    const rows = useMemo(() => buildAllRows(childrenMap), [childrenMap])
    const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories])
    const entryCountMap = useMemo(() => getEntryCountMap(stats), [stats])

    const getRecursiveEntryCount = useCallback((categoryId: string) => {
        const ids = [categoryId, ...collectDescendantIds(categoryId, childrenMap)]
        return ids.reduce((sum, id) => sum + (entryCountMap.get(id) ?? 0), 0)
    }, [childrenMap, entryCountMap])

    const handleOpenEntries = useCallback((category: Category) => {
        push({type: 'entryList', params: {projectId, categoryId: category.id, displayName: category.name}})
    }, [projectId, push])

    const handleConfirmName = useCallback(async (name: string) => {
        if (!renameTarget) return
        setBusy(true)
        try {
            if (renameTarget.mode === 'create') {
                const parentId = renameTarget.parentId
                const siblings = categories.filter(category => (category.parent_id ?? null) === parentId)
                const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
                await db_create_category({
                    projectId,
                    parentId,
                    name,
                    sortOrder: maxOrder + 1,
                })
            } else {
                await db_update_category({id: renameTarget.category.id, projectId, name})
            }
            setRenameTarget(null)
            await invalidateProjectContext(projectId)
        } catch (error) {
            await showAlert(`保存分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, projectId, renameTarget, showAlert])

    const handleMoveToParent = useCallback(async (parentId: string | null) => {
        if (!moveTarget) return
        if ((moveTarget.parent_id ?? null) === parentId) {
            setMoveTarget(null)
            return
        }

        setBusy(true)
        try {
            const siblings = categories.filter(category =>
                (category.parent_id ?? null) === parentId && category.id !== moveTarget.id
            )
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
            await db_update_category({
                id: moveTarget.id,
                projectId,
                parentId,
                sortOrder: maxOrder + 1,
            })
            setMoveTarget(null)
            await invalidateProjectContext(projectId)
        } catch (error) {
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, moveTarget, projectId, showAlert])

    const handleDelete = useCallback(async (mode: DeleteMode) => {
        if (!deleteTarget) return
        setBusy(true)
        try {
            let result: CategoryCascadeDeleteResult | null = null
            if (mode === 'empty') {
                await db_delete_category(deleteTarget.id, projectId)
            } else if (mode === 'lift') {
                await db_delete_category_move_to_parent(deleteTarget.id, projectId)
            } else {
                result = await db_cascade_delete_category(deleteTarget.id, projectId)
            }
            setDeleteTarget(null)
            await invalidateProjectContext(projectId)
            if (result) {
                await showAlert(
                    `已删除 ${result.deletedCategories} 个分类、${result.deletedEntries} 个词条。`,
                    'success',
                    'nonInvasive',
                    2600,
                )
            }
        } catch (error) {
            await showAlert(`删除分类失败：${String(error)}`, 'error', 'nonInvasive', 3200)
        } finally {
            setBusy(false)
        }
    }, [deleteTarget, projectId, showAlert])

    const moveCandidates = useMemo(() => {
        if (!moveTarget) return rows
        const blocked = new Set([moveTarget.id, ...collectDescendantIds(moveTarget.id, childrenMap)])
        return rows.filter(row => !blocked.has(row.category.id))
    }, [childrenMap, moveTarget, rows])

    const deleteImpact = useMemo(() => {
        if (!deleteTarget) return null
        const descendantIds = collectDescendantIds(deleteTarget.id, childrenMap)
        return {
            childCount: (childrenMap.get(parentKey(deleteTarget.id)) ?? []).length,
            categoryCount: descendantIds.length + 1,
            entryCount: getRecursiveEntryCount(deleteTarget.id),
        }
    }, [childrenMap, deleteTarget, getRecursiveEntryCount])

    const renameInitialValue = renameTarget?.mode === 'rename' ? renameTarget.category.name : ''
    const renameTitle = renameTarget?.mode === 'rename' ? '重命名分类' : '新建分类'

    if (!projectContext.hasLoaded) return <div className="mobile-page__loading">加载中…</div>

    return (
        <div className="mobile-page mobile-category-manager">
            <div className="mobile-category-manager__head">
                <h3 className="mobile-category-manager__title">分类（{categories.length}）</h3>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => setRenameTarget({mode: 'create', parentId: null})}
                >
                    <MobileAddIcon className="mobile-top-control-svg--inline"/>新建分类
                </Button>
            </div>

            {rows.length === 0 ? (
                <div className="mobile-page__empty mobile-category-manager__empty">
                    还没有分类。新建后可在词条编辑时选择分类。
                </div>
            ) : (
                <div className="mobile-category-manager__list">
                    {rows.map(({category, depth}) => {
                        const childCount = (childrenMap.get(parentKey(category.id)) ?? []).length
                        const directEntryCount = entryCountMap.get(category.id) ?? 0
                        return (
                            <div
                                key={category.id}
                                className="mobile-category-row"
                                style={{'--mobile-category-depth': depth} as CSSProperties}
                            >
                                <button
                                    type="button"
                                    className="mobile-category-row__main"
                                    onClick={() => handleOpenEntries(category)}
                                >
                                    <span className="mobile-category-row__branch" aria-hidden="true"/>
                                    <span className="mobile-category-row__body">
                                        <span className="mobile-category-row__name">{category.name}</span>
                                        <span className="mobile-category-row__meta">
                                            {directEntryCount} 个词条{childCount > 0 ? ` · ${childCount} 个子分类` : ''}
                                        </span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="mobile-category-row__menu"
                                    aria-label={`管理分类 ${category.name}`}
                                    onClick={() => setMenuTarget(category)}
                                >
                                    <MobileMoreIcon/>
                                </button>
                            </div>
                        )
                    })}
                </div>
            )}

            <ActionMenu
                open={!!menuTarget}
                onClose={() => setMenuTarget(null)}
                title={menuTarget?.name}
                items={[
                    {
                        key: 'open',
                        label: '浏览词条',
                        onSelect: () => menuTarget && handleOpenEntries(menuTarget),
                    },
                    {
                        key: 'create-child',
                        label: '新建子分类',
                        onSelect: () => menuTarget && setRenameTarget({mode: 'create', parentId: menuTarget.id}),
                    },
                    {
                        key: 'rename',
                        label: '重命名',
                        onSelect: () => menuTarget && setRenameTarget({mode: 'rename', category: menuTarget}),
                    },
                    {
                        key: 'move',
                        label: '移动到…',
                        onSelect: () => menuTarget && setMoveTarget(menuTarget),
                    },
                    {
                        key: 'delete',
                        label: '删除分类',
                        danger: true,
                        onSelect: () => menuTarget && setDeleteTarget(menuTarget),
                    },
                ]}
            />

            <RenameDialog
                open={!!renameTarget}
                title={renameTitle}
                label={renameTarget?.mode === 'create' && renameTarget.parentId
                    ? `父分类：${categoryById.get(renameTarget.parentId)?.name ?? '未知分类'}`
                    : undefined}
                initialValue={renameInitialValue}
                placeholder="分类名称"
                confirmText={renameTarget?.mode === 'create' ? '新建' : '保存'}
                busy={busy}
                onClose={() => setRenameTarget(null)}
                onConfirm={(name) => void handleConfirmName(name)}
            />

            <FloatingPanel
                open={!!moveTarget}
                onClose={() => setMoveTarget(null)}
                dismissible={!busy}
                title="移动分类"
                ariaLabel="移动分类"
                className="mobile-category-dialog"
            >
                <div className="mobile-category-dialog__summary">
                    将「{moveTarget?.name ?? ''}」移动到新的父分类。
                </div>
                <div className="mobile-category-parent-list">
                    <button
                        type="button"
                        className={`mobile-category-parent-list__item${(moveTarget?.parent_id ?? null) === null ? ' is-current' : ''}`}
                        aria-current={(moveTarget?.parent_id ?? null) === null ? 'true' : undefined}
                        disabled={busy}
                        onClick={() => void handleMoveToParent(null)}
                    >
                        根级分类
                    </button>
                    {moveCandidates.map(row => (
                        <button
                            type="button"
                            key={row.category.id}
                            className={`mobile-category-parent-list__item${moveTarget?.parent_id === row.category.id ? ' is-current' : ''}`}
                            aria-current={moveTarget?.parent_id === row.category.id ? 'true' : undefined}
                            style={{'--mobile-category-depth': row.depth} as CSSProperties}
                            disabled={busy}
                            onClick={() => void handleMoveToParent(row.category.id)}
                        >
                            {row.category.name}
                        </button>
                    ))}
                </div>
                <div className="mobile-category-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" radius="full" disabled={busy} onClick={() => setMoveTarget(null)}>
                        取消
                    </Button>
                </div>
            </FloatingPanel>

            <FloatingPanel
                open={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                dismissible={!busy}
                title="删除分类"
                ariaLabel="删除分类"
                className="mobile-category-dialog"
            >
                <div className="mobile-category-dialog__summary">
                    「{deleteTarget?.name ?? ''}」包含 {deleteImpact?.categoryCount ?? 0} 个分类节点、
                    {deleteImpact?.entryCount ?? 0} 个词条。
                </div>
                <div className="mobile-category-delete-options">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        radius="full"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('empty')}
                    >
                        仅删除空分类
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        radius="full"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('lift')}
                    >
                        子项上移保留
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        radius="full"
                        block
                        disabled={busy}
                        onClick={() => void handleDelete('cascade')}
                    >
                        连同子分类和词条删除
                    </Button>
                </div>
                {deleteImpact && deleteImpact.childCount > 0 && (
                    <div className="mobile-category-dialog__hint">
                        “子项上移保留”会把直接子分类和词条移动到当前分类的父级。
                    </div>
                )}
                <div className="mobile-category-dialog__actions">
                    <Button type="button" variant="ghost" size="sm" radius="full" disabled={busy} onClick={() => setDeleteTarget(null)}>
                        取消
                    </Button>
                </div>
            </FloatingPanel>
        </div>
    )
}
