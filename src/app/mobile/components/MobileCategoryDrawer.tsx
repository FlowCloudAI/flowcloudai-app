import {useCallback, useEffect, useMemo, useState} from 'react'
import {
    type CategoryTreeNode,
    type DropPosition,
    flatToTree,
    Input,
    Tree,
    type TreeActionItem,
    useAlert,
} from 'flowcloudai-ui'
import {logger} from '../../../shared/logger'
import {ProjectHomeIcon} from '../../../shared/ui/ProjectHomeIcon'
import {
    db_cascade_delete_category,
    db_create_category,
    db_delete_category,
    db_delete_category_move_to_parent,
    db_update_category,
    type Category,
    type CategoryCascadeDeleteResult,
    type ProjectStats,
} from '../../../api'
import MobileCategoryDrawerDialogs from './MobileCategoryDrawerDialogs'
import {MobileAddIcon, MobileMoreIcon, MobileSearchIcon} from './MobileTopControls'
import {
    buildAllRows,
    buildChildrenMap,
    collectDescendantIds,
    getEntryCountMap,
    getSortedSiblings,
    parentKey,
    type CategoryDropTarget,
    type DeleteMode,
    type RenameTarget,
    type SiblingDirection,
} from './mobileCategoryTree'
import './MobileCategoryDrawer.css'

export type MobileCategoryDrawerSelection =
    | {kind: 'projectHome'}
    | {kind: 'allEntries'}
    | {kind: 'uncategorized'}
    | {kind: 'category'; categoryId: string}

interface Props {
    projectId: string
    categories: Category[]
    stats: ProjectStats | null
    selected: MobileCategoryDrawerSelection
    onSelect: (selection: MobileCategoryDrawerSelection, label: string) => void
    onChanged?: () => void | Promise<void>
    /** 每一级分类的缩进距离，单位为像素。 */
    indentSize?: number
    /**
     * 分类拖拽开始/结束。宿主据此让抽屉的横滑手势在拖拽期间让路——
     * 否则拖节点时手指往左飘会把抽屉一起关掉，树跟着卸载、拖拽中断。
     */
    onDragStateChange?: (dragging: boolean) => void
}

export default function MobileCategoryDrawer({
    projectId,
    categories,
    stats,
    selected,
    onSelect,
    onChanged,
    indentSize = 16,
    onDragStateChange,
}: Props) {
    const {showAlert} = useAlert()
    const [searchText, setSearchText] = useState('')
    const [busy, setBusy] = useState(false)
    const [menuTarget, setMenuTarget] = useState<Category | null>(null)
    const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
    const [moveTarget, setMoveTarget] = useState<Category | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
    const childrenMap = useMemo(() => buildChildrenMap(categories), [categories])
    const initialExpanded = useMemo(() => {
        const ids = new Set<string>()
        for (const category of categories) {
            if ((childrenMap.get(parentKey(category.id)) ?? []).length > 0) {
                ids.add(category.id)
            }
        }
        return ids
    }, [categories, childrenMap])
    const [expandedIds, setExpandedIds] = useState<Set<string>>(initialExpanded)

    useEffect(() => {
        setExpandedIds(current => {
            const next = new Set(current)
            for (const id of initialExpanded) {
                next.add(id)
            }
            return next
        })
    }, [initialExpanded])

    /*
     * Tree 负责按 searchValue 过滤与按 expandedKeys 展开，这里只把扁平分类转成它要的嵌套结构。
     * parent_id 要显式归一到 null：API 里它是可选字段（undefined 表示顶层），
     * 而 flatToTree 用 `=== null` 判定根节点，undefined 会被当成「父节点缺失」丢进 orphans。
     */
    const treeData = useMemo(
        () => flatToTree(categories.map(category => ({
            ...category,
            parent_id: category.parent_id ?? null,
        }))).roots,
        [categories],
    )
    const expandedKeys = useMemo(() => Array.from(expandedIds), [expandedIds])
    const allRows = useMemo(() => buildAllRows(childrenMap), [childrenMap])
    const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories])
    const entryCountMap = useMemo(() => getEntryCountMap(stats), [stats])
    const normalizedSearch = searchText.trim().toLocaleLowerCase('zh-CN')
    const showProjectHomeRow = !normalizedSearch || '项目主页'.includes(normalizedSearch)
    const showDefaultRow = !normalizedSearch || '默认分类'.includes(normalizedSearch)

    const notifyChanged = useCallback(async () => {
        await onChanged?.()
    }, [onChanged])

    const getRecursiveEntryCount = useCallback((categoryId: string) => {
        const ids = [categoryId, ...collectDescendantIds(categoryId, childrenMap)]
        return ids.reduce((sum, id) => sum + (entryCountMap.get(id) ?? 0), 0)
    }, [childrenMap, entryCountMap])

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
            await notifyChanged()
        } catch (error) {
            await showAlert(`保存分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, notifyChanged, projectId, renameTarget, showAlert])

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
            await notifyChanged()
        } catch (error) {
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, moveTarget, notifyChanged, projectId, showAlert])

    const handleMoveWithinSiblings = useCallback(async (target: Category, direction: SiblingDirection) => {
        const parentId = target.parent_id ?? null
        const siblings = getSortedSiblings(categories, parentId)
        const currentIndex = siblings.findIndex(category => category.id === target.id)
        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) return

        const reordered = [...siblings]
        const [moved] = reordered.splice(currentIndex, 1)
        reordered.splice(nextIndex, 0, moved)

        setBusy(true)
        try {
            await Promise.all(reordered.map((category, index) => (
                category.sort_order === index
                    ? Promise.resolve()
                    : db_update_category({id: category.id, projectId, sortOrder: index})
            )))
            await notifyChanged()
        } catch (error) {
            await showAlert(`调整分类顺序失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, notifyChanged, projectId, showAlert])

    const handleMoveByDrop = useCallback(async (
        draggedId: string,
        target: CategoryDropTarget,
    ) => {
        const dragged = categoryById.get(draggedId)
        const targetCategory = categoryById.get(target.targetId)
        if (!dragged || !targetCategory) {
            logger.info('[移动端分类拖拽] 放弃移动：分类数据缺失', {
                draggedId,
                targetId: target.targetId,
                hasDragged: Boolean(dragged),
                hasTarget: Boolean(targetCategory),
                categoryCount: categories.length,
            })
            return
        }
        logger.info('[移动端分类拖拽] 准备移动', {
            draggedId,
            draggedName: dragged.name,
            targetId: target.targetId,
            targetName: targetCategory.name,
            position: target.position,
            oldParentId: dragged.parent_id ?? null,
            oldSortOrder: dragged.sort_order,
        })

        let nextParentId: string | null
        let orderMap: Map<string, number>

        if (target.position === 'into') {
            nextParentId = target.targetId
            const siblings = categories.filter(category =>
                (category.parent_id ?? null) === nextParentId && category.id !== draggedId
            )
            const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(category => category.sort_order)) : -1
            orderMap = new Map([[draggedId, maxOrder + 1]])
        } else {
            nextParentId = targetCategory.parent_id ?? null
            const siblings = getSortedSiblings(categories, nextParentId)
                .filter(category => category.id !== draggedId)
            const targetIndex = siblings.findIndex(category => category.id === target.targetId)
            if (targetIndex < 0) {
                logger.info('[移动端分类拖拽] 放弃移动：目标不在同级列表中', {
                    draggedId,
                    targetId: target.targetId,
                    nextParentId,
                    siblingIds: siblings.map(category => category.id),
                })
                return
            }

            const reordered = [...siblings]
            reordered.splice(target.position === 'before' ? targetIndex : targetIndex + 1, 0, dragged)
            orderMap = new Map<string, number>()
            reordered.forEach((category, index) => orderMap.set(category.id, index))
        }

        const draggedOrder = orderMap.get(draggedId)
        if (draggedOrder === undefined) {
            logger.info('[移动端分类拖拽] 放弃移动：没有计算出拖拽项顺序', {
                draggedId,
                target,
                orders: Array.from(orderMap.entries()),
            })
            return
        }

        setBusy(true)
        try {
            const parentChanged = (dragged.parent_id ?? null) !== nextParentId
            const updateInputs: Array<{id: string; projectId: string; parentId?: string | null; sortOrder?: number}> = []
            for (const [id, sortOrder] of orderMap) {
                const original = categoryById.get(id)
                if (!original) continue
                if (id === draggedId) {
                    if (parentChanged || original.sort_order !== sortOrder) {
                        updateInputs.push({id, projectId, parentId: nextParentId, sortOrder})
                    }
                    continue
                }
                if (original.sort_order !== sortOrder) {
                    updateInputs.push({id, projectId, sortOrder})
                }
            }

            logger.info('[移动端分类拖拽] 提交移动', {
                draggedId,
                nextParentId,
                updateCount: updateInputs.length,
                updates: updateInputs,
                orders: Array.from(orderMap.entries()),
            })
            if (updateInputs.length === 0) return
            await Promise.all(updateInputs.map(input => db_update_category(input)))
            logger.info('[移动端分类拖拽] 后端更新成功', {
                draggedId,
                updateCount: updateInputs.length,
            })
            if (target.position === 'into') {
                setExpandedIds(current => {
                    const next = new Set(current)
                    next.add(target.targetId)
                    return next
                })
            }
            await notifyChanged()
            logger.info('[移动端分类拖拽] 刷新回调完成', {draggedId})
        } catch (error) {
            logger.error('[移动端分类拖拽] 移动失败', error)
            await showAlert(`移动分类失败：${String(error)}`, 'error', 'nonInvasive', 3000)
        } finally {
            setBusy(false)
        }
    }, [categories, categoryById, notifyChanged, projectId, showAlert])

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
            await notifyChanged()
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
    }, [deleteTarget, notifyChanged, projectId, showAlert])

    const moveCandidates = useMemo(() => {
        if (!moveTarget) return allRows
        const blocked = new Set([moveTarget.id, ...collectDescendantIds(moveTarget.id, childrenMap)])
        return allRows.filter(row => !blocked.has(row.category.id))
    }, [allRows, childrenMap, moveTarget])

    const menuTargetSiblingState = useMemo(() => {
        if (!menuTarget) return {canMoveUp: false, canMoveDown: false}
        const siblings = getSortedSiblings(categories, menuTarget.parent_id ?? null)
        const index = siblings.findIndex(category => category.id === menuTarget.id)
        return {
            canMoveUp: index > 0,
            canMoveDown: index >= 0 && index < siblings.length - 1,
        }
    }, [categories, menuTarget])

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

    /*
     * 拖拽移动交给 Tree（dragActivation='long-press'，长按 430ms 激活）。
     * 原先这里有约 230 行手写手势：drop 命中判定、拖到边缘自动滚动、方向锁、
     * 拖拽后的点击抑制、pointerId 追踪——现在全部由 dnd-kit 承担，
     * 只留下「拖到哪里 → 怎么改 parent_id 与 sort_order」这段业务。
     * Tree 自己会拒绝把节点拖进自己的子孙（沿 parentMap 上溯），不必再挡一次。
     */
    const handleTreeMove = useCallback(async (
        key: string,
        targetKey: string,
        position: DropPosition,
    ) => {
        await handleMoveByDrop(key, {targetId: targetKey, position})
    }, [handleMoveByDrop])

    /* 搜索态下看到的是过滤后的局部顺序，此时排序结果没有意义；写库期间同样不接受新拖拽。 */
    const canDragCategory = useCallback(() => !busy && !normalizedSearch, [busy, normalizedSearch])

    const getCategoryActions = useCallback((node: CategoryTreeNode): TreeActionItem[] => [{
        key: 'manage',
        label: '管理',
        title: `管理分类 ${node.title}`,
        icon: <MobileMoreIcon/>,
        onClick: () => setMenuTarget(categoryById.get(node.key) ?? null),
    }], [categoryById])

    const handleTreeSelect = useCallback((key: string) => {
        const category = categoryById.get(key)
        if (!category) return
        onSelect({kind: 'category', categoryId: category.id}, category.name)
    }, [categoryById, onSelect])

    const handleExpandedKeysChange = useCallback((keys: string[]) => {
        setExpandedIds(new Set(keys))
    }, [])

    return (
        <aside className="mobile-category-drawer" aria-label="分类树">
            <div className="mobile-category-drawer__toolbar">
                <div className="mobile-category-drawer__search">
                    <Input
                        placeholder="搜索分类…"
                        aria-label="搜索分类"
                        value={searchText}
                        onValueChange={setSearchText}
                        prefix={<MobileSearchIcon className="mobile-drawer-search-icon"/>}
                        radius="full"
                        size="lg"
                        allowClear
                    />
                </div>
                <button
                    type="button"
                    className="mobile-category-drawer__add"
                    aria-label="新建根级分类"
                    onClick={() => setRenameTarget({mode: 'create', parentId: null})}
                >
                    <MobileAddIcon/>
                </button>
            </div>

            {/* 「项目主页 / 默认分类」不是分类，不参与拖拽排序，固定在树上方不跟着滚。 */}
            <div className="mobile-category-drawer__fixed-rows">
                {showProjectHomeRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'projectHome'}
                        className={`mobile-category-drawer__row mobile-category-drawer__row--home${selected.kind === 'projectHome' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'projectHome'}, '项目主页')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <ProjectHomeIcon className="mobile-category-drawer__home-icon"/>
                        <span className="mobile-category-drawer__text">项目主页</span>
                    </button>
                )}

                {showDefaultRow && (
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected.kind === 'uncategorized'}
                        className={`mobile-category-drawer__row mobile-category-drawer__row--default${selected.kind === 'uncategorized' ? ' is-active' : ''}`}
                        onClick={() => onSelect({kind: 'uncategorized'}, '默认分类')}
                    >
                        <span className="mobile-category-drawer__toggle-placeholder"/>
                        <span className="mobile-category-drawer__text">默认分类</span>
                    </button>
                )}

            </div>

            <div className="mobile-category-drawer__tree">
                <Tree
                    treeData={treeData}
                    selectedKey={selected.kind === 'category' ? selected.categoryId : ''}
                    onSelectedKeyChange={handleTreeSelect}
                    expandedKeys={expandedKeys}
                    onExpandedKeysChange={handleExpandedKeysChange}
                    onMove={handleTreeMove}
                    onDragStateChange={onDragStateChange}
                    canDrag={canDragCategory}
                    getNodeActions={getCategoryActions}
                    actionDisplayMode="inline"
                    dragActivation="long-press"
                    indentSize={indentSize}
                    indentationLine
                    /* 搜索框是抽屉工具栏里那个定制样式的 Input，这里只把值喂给 Tree 做过滤，
                       不让它渲染自带的搜索框。 */
                    searchable={false}
                    searchValue={searchText}
                />
            </div>

            <MobileCategoryDrawerDialogs
                busy={busy}
                menuTarget={menuTarget}
                onCloseMenu={() => setMenuTarget(null)}
                onOpenCategory={category => onSelect({kind: 'category', categoryId: category.id}, category.name)}
                onCreateChild={category => setRenameTarget({mode: 'create', parentId: category.id})}
                onRenameCategory={category => setRenameTarget({mode: 'rename', category})}
                onChooseMove={setMoveTarget}
                canMoveUp={menuTargetSiblingState.canMoveUp}
                canMoveDown={menuTargetSiblingState.canMoveDown}
                onMoveSibling={(category, direction) => void handleMoveWithinSiblings(category, direction)}
                onChooseDelete={setDeleteTarget}
                renameOpen={!!renameTarget}
                renameTitle={renameTitle}
                renameLabel={renameTarget?.mode === 'create' && renameTarget.parentId ? `父分类：${categoryById.get(renameTarget.parentId)?.name ?? '未知分类'}` : undefined}
                renameInitialValue={renameInitialValue}
                renameConfirmText={renameTarget?.mode === 'create' ? '新建' : '保存'}
                onCloseRename={() => setRenameTarget(null)}
                onConfirmRename={name => void handleConfirmName(name)}
                moveTarget={moveTarget}
                moveCandidates={moveCandidates}
                onCloseMove={() => setMoveTarget(null)}
                onMove={parentId => void handleMoveToParent(parentId)}
                deleteTarget={deleteTarget}
                deleteImpact={deleteImpact}
                onCloseDelete={() => setDeleteTarget(null)}
                onDelete={mode => void handleDelete(mode)}
            />
        </aside>
    )
}
