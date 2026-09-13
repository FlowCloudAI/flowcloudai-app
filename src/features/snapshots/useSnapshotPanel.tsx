import {logger} from '../../shared/logger'
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button, Input, Select, useAlert} from 'flowcloudai-ui'
import {
    dbCreateBranch,
    dbGetSnapshotGraph,
    dbListBranches,
    dbRollbackTo,
    dbSnapshot,
    dbSnapshotWithMessage,
    dbSwitchBranch,
    formatApiError,
    type SnapshotBranchInfo,
    type SnapshotGraph,
    type SnapshotGraphNode,
    toApiError,
} from '../../api'
import '../../shared/ui/layout/WorkspaceScaffold.css'
import '../../shared/ui/layout/DockPanelScaffold.css'
import {DockPanelIconButton, DockPanelSide, DockPanelTitle, DockPanelTopbar} from '../../shared/ui/layout/DockPanelScaffold'
import {FloatingPanel} from '../../shared/ui/overlay'
import './components/SnapshotPanel.css'

interface UseSnapshotPanelOptions {
    projectId?: string | null
    onToggleCollapsed?: () => void
    onVersionApplied?: (projectId: string) => void
    dirtyEntryCount?: number
}

interface SnapshotGraphRow {
    node: SnapshotGraphNode
    lane: number
    laneCount: number
    lanePresenceAbove: boolean[]
    lanePresenceBelow: boolean[]
    connections: number[]
}

const GRAPH_COLORS = [
    'var(--fc-color-primary)',
    'var(--fc-color-purple)',
    'var(--fc-color-teal)',
    'var(--fc-color-orange)',
    'var(--fc-color-pink)',
    'var(--fc-color-success)',
]

const LANE_GAP = 22
const LANE_R = LANE_GAP / 2
const GRAPH_PAD = LANE_R
const BRANCH_NAME_MAX_LENGTH = 20

function formatSnapshotTime(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date)
}

function formatSnapshotMessage(message: string): string {
    const [type, ...rest] = message.split(' ')
    if (type === 'auto') return '自动保存'
    if (type === 'manual') return rest.join(' ') || '保存版本'
    return message
}

function getFirstEmptyLane(lanes: Array<string | null>): number {
    const index = lanes.findIndex(lane => lane === null)
    if (index >= 0) return index
    lanes.push(null)
    return lanes.length - 1
}

function buildGraphRows(nodes: SnapshotGraphNode[]): SnapshotGraphRow[] {
    const activeLanes: Array<string | null> = []
    const rows: SnapshotGraphRow[] = []

    for (const node of nodes) {
        let lane = activeLanes.findIndex(entry => entry === node.id)
        let isNewLane = false
        if (lane < 0) {
            lane = getFirstEmptyLane(activeLanes)
            activeLanes[lane] = node.id
            isNewLane = true
        }

        const lanePresenceAbove = activeLanes.map(entry => entry !== null)
        if (isNewLane) lanePresenceAbove[lane] = false
        const nextLanes = [...activeLanes]
        const connections: number[] = []
        const [firstParent, ...otherParents] = node.parents

        if (firstParent) {
            const existing = nextLanes.findIndex(entry => entry === firstParent)
            if (existing >= 0 && existing !== lane) {
                nextLanes[lane] = null
                connections.push(existing)
            } else {
                nextLanes[lane] = firstParent
                connections.push(lane)
            }
        } else {
            nextLanes[lane] = null
        }

        for (const parentId of otherParents) {
            const existing = nextLanes.findIndex(entry => entry === parentId)
            if (existing >= 0) {
                connections.push(existing)
            } else {
                const nl = getFirstEmptyLane(nextLanes)
                nextLanes[nl] = parentId
                connections.push(nl)
            }
        }

        while (nextLanes.length > 0 && nextLanes[nextLanes.length - 1] === null) {
            nextLanes.pop()
        }

        rows.push({
            node,
            lane,
            laneCount: Math.max(lanePresenceAbove.length, nextLanes.length, lane + 1),
            lanePresenceAbove,
            lanePresenceBelow: nextLanes.map(entry => entry !== null),
            connections,
        })

        activeLanes.splice(0, activeLanes.length, ...nextLanes)
    }

    return rows
}

function laneX(lane: number): number {
    return GRAPH_PAD + lane * LANE_GAP
}

function clampBranchName(value: string): string {
    return Array.from(value).slice(0, BRANCH_NAME_MAX_LENGTH).join('')
}

function buildBranchMembership(graph: SnapshotGraph): Map<string, string[]> {
    const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
    const membership = new Map<string, string[]>()

    for (const branch of graph.branches) {
        if (!branch.target) continue
        const stack = [branch.target]
        const visited = new Set<string>()
        while (stack.length > 0) {
            const id = stack.pop()
            if (!id || visited.has(id)) continue
            visited.add(id)
            const node = nodesById.get(id)
            if (!node) continue
            const names = membership.get(id) ?? []
            if (!names.includes(branch.name)) names.push(branch.name)
            membership.set(id, names)
            for (const parent of node.parents) stack.push(parent)
        }
    }

    return membership
}

export interface SnapshotPanelSlots {
    main: ReactNode
}

export function useSnapshotPanel({
                                     projectId = null,
                                     onToggleCollapsed,
                                     onVersionApplied,
                                     dirtyEntryCount = 0,
                                 }: UseSnapshotPanelOptions = {}): SnapshotPanelSlots {
    const {showAlert} = useAlert()
    const [branches, setBranches] = useState<SnapshotBranchInfo[]>([])
    const [graph, setGraph] = useState<SnapshotGraph>({activeBranch: '', branches: [], nodes: []})
    const [activeBranch, setActiveBranch] = useState('')
    const [loading, setLoading] = useState(false)
    const [actionId, setActionId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [branchSwitching, setBranchSwitching] = useState(false)
    const [message, setMessage] = useState('')
    const [branchDialogNode, setBranchDialogNode] = useState<SnapshotGraphNode | null>(null)
    const [branchNameDraft, setBranchNameDraft] = useState('')
    const [branchCreating, setBranchCreating] = useState(false)
    const loadRequestIdRef = useRef(0)

    const load = useCallback(async () => {
        const requestId = loadRequestIdRef.current + 1
        loadRequestIdRef.current = requestId
        if (!projectId) {
            setBranches([])
            setGraph({activeBranch: '', branches: [], nodes: []})
            setActiveBranch('')
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const [branchList, snapshotGraph] = await Promise.all([
                dbListBranches(projectId),
                dbGetSnapshotGraph(projectId),
            ])
            if (loadRequestIdRef.current !== requestId) return
            setBranches(branchList)
            setGraph(snapshotGraph)
            setActiveBranch(snapshotGraph.activeBranch)
        } catch (error) {
            if (loadRequestIdRef.current !== requestId) return
            logger.error('加载快照图失败', error)
            void showAlert('加载历史版本失败', 'error')
        } finally {
            if (loadRequestIdRef.current === requestId) {
                setLoading(false)
            }
        }
    }, [projectId, showAlert])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        setBranchDialogNode(null)
        setBranchNameDraft('')
    }, [projectId])

    const hasDirtyEntries = dirtyEntryCount > 0
    const requireProjectContext = useCallback(() => {
        if (projectId) return true
        void showAlert('请先打开一个项目再操作历史版本。', 'warning')
        return false
    }, [projectId, showAlert])

    const blockWhenDirty = useCallback(() => {
        if (!hasDirtyEntries) return false
        void showAlert(
            `有 ${dirtyEntryCount} 个词条存在未保存更改，请先保存或关闭后再操作历史版本。`,
            'warning',
        )
        return true
    }, [dirtyEntryCount, hasDirtyEntries, showAlert])

    const handleSnapshot = useCallback(async () => {
        if (!requireProjectContext()) return
        if (blockWhenDirty()) return
        setSaving(true)
        try {
            const trimmedMessage = message.trim()
            const created = trimmedMessage
                ? await dbSnapshotWithMessage(trimmedMessage, projectId)
                : await dbSnapshot(projectId)
            setMessage('')
            void showAlert(created ? '版本已保存' : '没有新变化，无需保存', created ? 'success' : 'info', 'nonInvasive', 2200)
            if (created) await load()
        } catch (error) {
            logger.error('保存版本失败', error)
            void showAlert('保存版本失败', 'error')
        } finally {
            setSaving(false)
        }
    }, [blockWhenDirty, load, message, projectId, requireProjectContext, showAlert])

    const handleSwitchBranch = useCallback(async (branchName: string, fromHistory = false) => {
        if (!requireProjectContext()) return
        const currentProjectId = projectId
        if (!currentProjectId) return
        if (!branchName || branchName === activeBranch) return
        if (blockWhenDirty()) return

        const confirmed = await showAlert(
            fromHistory
                ? `将切换到「${branchName}」分支路线的最新版本。\n不会停留在当前选中的历史版本。是否继续？`
                : `将切换到「${branchName}」分支路线的最新版本。是否继续？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setBranchSwitching(true)
        try {
            await dbSwitchBranch(branchName, currentProjectId)
            onVersionApplied?.(currentProjectId)
            void showAlert(`已切换到「${branchName}」分支路线`, 'success', 'nonInvasive', 2200)
            await load()
        } catch (error) {
            logger.error('切换分支路线失败', error)
            void showAlert('切换分支路线失败', 'error')
        } finally {
            setBranchSwitching(false)
        }
    }, [activeBranch, blockWhenDirty, load, onVersionApplied, projectId, requireProjectContext, showAlert])

    const openBranchDialog = useCallback((node: SnapshotGraphNode) => {
        setBranchDialogNode(node)
        setBranchNameDraft('')
    }, [])

    const closeBranchDialog = useCallback(() => {
        if (branchCreating) return
        setBranchDialogNode(null)
        setBranchNameDraft('')
    }, [branchCreating])

    const handleCreateBranchFromNode = useCallback(async () => {
        if (!requireProjectContext()) return
        const currentProjectId = projectId
        if (!currentProjectId || !branchDialogNode) return
        if (blockWhenDirty()) return
        const branchName = clampBranchName(branchNameDraft.trim())
        if (!branchName) {
            void showAlert('请输入分支名称', 'warning')
            return
        }
        if (Array.from(branchName).length > BRANCH_NAME_MAX_LENGTH) {
            void showAlert(`分支名称不能超过 ${BRANCH_NAME_MAX_LENGTH} 个字。`, 'warning')
            return
        }
        if (/[\\:*?"<>|]/.test(branchName) || branchName.includes('..') || branchName.includes('//') || branchName.startsWith('/') || branchName.endsWith('/')) {
            void showAlert('分支名称不能包含非法字符。', 'warning')
            return
        }
        if (branches.some(branch => branch.name === branchName)) {
            void showAlert('分支名称已存在。', 'warning')
            return
        }

        setBranchCreating(true)
        setActionId(branchDialogNode.id)
        try {
            await dbCreateBranch(branchName, branchDialogNode.id, currentProjectId)
            await dbSwitchBranch(branchName, currentProjectId)
            onVersionApplied?.(currentProjectId)
            setBranchDialogNode(null)
            setBranchNameDraft('')
            void showAlert(`已创建并切换到「${branchName}」分支路线`, 'success', 'nonInvasive', 2200)
            await load()
        } catch (error) {
            logger.error('创建分支路线失败', error)
            void showAlert(formatApiError(toApiError(error)) || '创建分支路线失败', 'error')
        } finally {
            setActionId(null)
            setBranchCreating(false)
        }
    }, [blockWhenDirty, branchDialogNode, branchNameDraft, branches, load, onVersionApplied, projectId, requireProjectContext, showAlert])

    const handleRollback = useCallback(async (snapshot: Pick<SnapshotGraphNode, 'id' | 'message'>) => {
        if (!requireProjectContext()) return
        const currentProjectId = projectId
        if (!currentProjectId) return
        if (blockWhenDirty()) return
        const confirmed = await showAlert(
            `回到「${formatSnapshotMessage(snapshot.message)}」？\n当前路线会回到这个版本，后面的版本将不再显示。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        setActionId(snapshot.id)
        try {
            await dbRollbackTo(snapshot.id, currentProjectId)
            onVersionApplied?.(currentProjectId)
            void showAlert('已回到所选版本', 'success', 'nonInvasive', 2200)
            await load()
        } catch (error) {
            logger.error('回到版本失败', error)
            void showAlert(formatApiError(toApiError(error)) || '回到版本失败', 'error')
        } finally {
            setActionId(null)
        }
    }, [blockWhenDirty, load, onVersionApplied, projectId, requireProjectContext, showAlert])

    const branchOptions = useMemo(() => (
        branches.map(branch => ({
            value: branch.name,
            label: branch.isActive ? `${branch.name}（当前）` : branch.name,
        }))
    ), [branches])

    const graphRows = useMemo(() => buildGraphRows(graph.nodes), [graph.nodes])
    const branchMembership = useMemo(() => buildBranchMembership(graph), [graph])

    const maxRailWidth = useMemo(() => {
        return graphRows.reduce((max, row) => {
            const w = Math.max(LANE_GAP + GRAPH_PAD * 2, GRAPH_PAD * 2 + row.laneCount * LANE_GAP)
            return Math.max(max, w)
        }, 0)
    }, [graphRows])

    const RAIL_PX = 32
    const RAIL_OVERLAP = 2
    const midY = RAIL_PX / 2

    const sideSections = (
        <>
            <div className="snapshot-side__section">
                <div className="snapshot-side__section-title">当前路线</div>
                <div className="snapshot-side__branch-row">
                    <Select
                        options={branchOptions}
                        value={activeBranch}
                        onValueChange={(value) => void handleSwitchBranch(String(value))}
                        style={{flex: 1}}
                        disabled={!projectId || loading || branchSwitching || branches.length === 0}
                    />
                    <span className="snapshot-side__branch-badge">{activeBranch || '未初始化'}</span>
                </div>
            </div>

            <div className="snapshot-side__section">
                <div className="snapshot-side__section-title">保存版本</div>
                <div className="snapshot-side__save-row">
                    <textarea
                        className="snapshot-side__save-textarea"
                        placeholder="可选：输入本次版本说明"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        rows={4}
                    />
                    <div className="snapshot-side__save-actions">
                        <Button type="button" variant="primary" size="sm"
                                onClick={() => void handleSnapshot()}
                                disabled={!projectId || loading || saving}>
                            保存
                        </Button>
                    </div>
                </div>
            </div>
        </>
    )

    const mainTopbar = (
        <DockPanelTopbar className="snapshot-main__topbar">
            <DockPanelTitle className="snapshot-main__title">保存历史</DockPanelTitle>
            <div className="snapshot-main__topbar-actions">
                <DockPanelIconButton
                    type="button"
                    className="snapshot-main__icon-btn"
                    onClick={() => onToggleCollapsed?.()}
                    title="最小化"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                         strokeWidth="1.5">
                        <path d="M6 4l4 4-4 4"/>
                    </svg>
                </DockPanelIconButton>
            </div>
        </DockPanelTopbar>
    )

    const mainViewport = (
        <div className="snapshot-main__viewport">
                {loading && graphRows.length === 0 ? (
                    <div className="snapshot-main__empty">
                        <p className="snapshot-main__empty-title">正在加载保存历史…</p>
                    </div>
                ) : graphRows.length === 0 ? (
                    <div className="snapshot-main__empty">
                        <p className="snapshot-main__empty-title">
                            {projectId
                                ? (activeBranch ? `「${activeBranch}」分支路线暂无保存历史` : '暂无保存历史')
                                : '请先打开一个项目'}
                        </p>
                        <p className="snapshot-main__empty-copy">
                            {projectId
                                ? '先保存一个版本，或切换到已有分支路线查看保存历史。'
                                : '保存历史按世界观独立保存。'}
                        </p>
                    </div>
                ) : (
                    <div className="snapshot-main__graph"
                         style={{'--rail-width': `${maxRailWidth}px`} as React.CSSProperties}>
                        {graphRows.map((row) => {
                            const circleColor = row.node.isActiveTip
                                ? 'var(--fc-color-primary)'
                                : GRAPH_COLORS[row.lane % GRAPH_COLORS.length]
                            const circleR = row.node.isActiveTip || row.node.isCurrentHead ? 6 : 5
                            const containingBranches = branchMembership.get(row.node.id) ?? []
                            const isOnActiveBranch = activeBranch ? containingBranches.includes(activeBranch) : false
                            const switchBranchName = containingBranches.find(branchName => branchName !== activeBranch)
                            const showRollback = isOnActiveBranch && !row.node.isActiveTip
                            const showSwitch = !isOnActiveBranch && !!switchBranchName
                            return (
                                <div
                                    key={row.node.id}
                                    className={`snapshot-main__graph-row${row.node.isActiveTip ? ' is-active' : ''}`}
                                >
                                    <div className="snapshot-main__graph-rail"
                                         style={{width: `${maxRailWidth}px`}}>
                                        <svg
                                            width={maxRailWidth}
                                            height={RAIL_PX + RAIL_OVERLAP * 2}
                                            viewBox={`0 ${-RAIL_OVERLAP} ${maxRailWidth} ${RAIL_PX + RAIL_OVERLAP * 2}`}
                                            style={{overflow: 'visible'}}
                                        >
                                            {Array.from({length: row.laneCount}, (_, lane) => {
                                                const color = GRAPH_COLORS[lane % GRAPH_COLORS.length]
                                                const x = laneX(lane)
                                                const hasTop = lane < row.lanePresenceAbove.length && row.lanePresenceAbove[lane]
                                                const hasBot = lane < row.lanePresenceBelow.length && row.lanePresenceBelow[lane]
                                                return (
                                                    <g key={`${row.node.id}-lane-${lane}`}>
                                                        {hasTop &&
                                                            <line
                                                                x1={x}
                                                                y1={-RAIL_OVERLAP * 2}
                                                                x2={x}
                                                                y2={midY + 1}
                                                                stroke={color}
                                                                strokeWidth="1.5"
                                                            />}
                                                        {hasBot && <line
                                                            x1={x}
                                                            y1={midY - 1}
                                                            x2={x}
                                                            y2={RAIL_PX + RAIL_OVERLAP * 2}
                                                            stroke={color}
                                                            strokeWidth="1.5"
                                                        />}
                                                    </g>
                                                )
                                            })}
                                            {row.connections
                                                .filter(parentLane => parentLane !== row.lane)
                                                .map(parentLane => {
                                                    const fromX = laneX(row.lane)
                                                    const toX = laneX(parentLane)
                                                    const color = GRAPH_COLORS[parentLane % GRAPH_COLORS.length]
                                                    return (
                                                        <path
                                                            key={`${row.node.id}-${parentLane}`}
                                                            d={`M ${fromX} ${midY} C ${fromX} ${RAIL_PX * 0.78}, ${toX} ${RAIL_PX * 0.78}, ${toX} ${RAIL_PX + RAIL_OVERLAP * 2}`}
                                                            fill="none"
                                                            stroke={color}
                                                            strokeWidth="1.5"
                                                        />
                                                    )
                                                })}
                                        </svg>
                                        <div
                                            className="snapshot-main__graph-node"
                                            style={{
                                                width: circleR * 2,
                                                height: circleR * 2,
                                                left: laneX(row.lane) - circleR,
                                                background: circleColor,
                                            }}
                                        />
                                    </div>
                                    <div className="snapshot-main__item">
                                        <span className="snapshot-main__item-message">
                                            {formatSnapshotMessage(row.node.message)}
                                        </span>
                                        <span className="snapshot-main__item-branches">
                                            {row.node.branchNames.map(branchName => (
                                                <span
                                                    key={`${row.node.id}-${branchName}`}
                                                    className="snapshot-main__branch-tag"
                                                >
                                                    {branchName}
                                                </span>
                                            ))}
                                        </span>
                                        <span className="snapshot-main__item-actions">
                                            {showRollback && (
                                                <Button type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={actionId === row.node.id}
                                                        onClick={() => void handleRollback(row.node)}
                                                >
                                                    回到
                                                </Button>
                                            )}
                                            {showSwitch && switchBranchName && (
                                                <Button type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={branchSwitching}
                                                        onClick={() => void handleSwitchBranch(switchBranchName, true)}
                                                >
                                                    切换
                                                </Button>
                                            )}
                                            <Button type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={actionId === row.node.id || branchCreating}
                                                    onClick={() => openBranchDialog(row.node)}
                                            >
                                                分支
                                            </Button>
                                        </span>
                                        <span className="snapshot-main__item-time">
                                            {formatSnapshotTime(row.node.timestamp)}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
        </div>
    )

    const branchDialog = (
        <FloatingPanel
            open={!!branchDialogNode}
            onClose={closeBranchDialog}
            dismissible={!branchCreating}
            title="从此版本创建分支路线"
            className="snapshot-branch-dialog"
        >
            <form
                className="snapshot-branch-dialog__body"
                onSubmit={(event) => {
                    event.preventDefault()
                    void handleCreateBranchFromNode()
                }}
            >
                <p className="snapshot-branch-dialog__copy">
                    新分支路线会从「{branchDialogNode ? formatSnapshotMessage(branchDialogNode.message) : '当前版本'}」开始继续编辑，原路线不会被修改。
                </p>
                <Input
                    autoFocus
                    maxLength={BRANCH_NAME_MAX_LENGTH}
                    placeholder="新分支名称"
                    value={branchNameDraft}
                    onValueChange={(value) => setBranchNameDraft(clampBranchName(value))}
                />
                <div className="snapshot-branch-dialog__meta">
                    {Array.from(branchNameDraft).length}/{BRANCH_NAME_MAX_LENGTH}
                </div>
                <div className="snapshot-branch-dialog__actions">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        radius="full"
                        disabled={branchCreating}
                        onClick={closeBranchDialog}
                    >
                        取消
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        radius="full"
                        disabled={branchCreating || branchNameDraft.trim().length === 0}
                    >
                        创建并切换
                    </Button>
                </div>
            </form>
        </FloatingPanel>
    )

    return {
        main: (
            <div className="snapshot-panel">
                {mainTopbar}
                <DockPanelSide className="snapshot-side">
                    {sideSections}
                </DockPanelSide>
                {mainViewport}
                {branchDialog}
            </div>
        ),
    }
}
