import {useCallback, useEffect, useMemo, useState, type CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import {convertFileSrc} from '../../../api/assets'
import {Button, ButtonGroup, ButtonToolbar, Input, Slider} from 'flowcloudai-ui'
import {FloatingPanel} from '../../../shared/ui/overlay'
import {RelationGraph} from './RelationGraph/RelationGraph'
import EntryTypeIcon from '../../project-editor/components/EntryTypeIcon'
import type {
    LayoutFunction,
    LayoutRequest,
    LayoutResponse,
    RelationLayoutParams,
    RelationLayoutState,
    RelationNodeInput,
} from './RelationGraph/types'
import {
    compute_layout,
    db_get_project_setting,
    db_get_relation_graph_data,
    db_list_all_entry_types,
    db_list_entries,
    db_set_project_setting,
    entryTypeKey,
    type EntryTypeView,
    type RelationGraphEdge,
    type RelationGraphNode,
} from '../../../api'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectRelationGraph.css'

interface ProjectRelationGraphProps {
    projectId: string
    sidebarContainer?: HTMLElement | null
    /*
     * 移动端把「布局参数」搬到了独立页面：给了容器就把面板正文 portal 过去，
     * 不再自己弹 FloatingPanel（重操作不进浮层，见移动端页面约定）。
     */
    layoutContainer?: HTMLElement | null
    /** 移动端在自己的顶栏里放这些动作，组件不再画一遍标题栏。 */
    hideHeader?: boolean
    /** 布局参数在独立页面时，「取消 / 应用」要把那一页关掉。 */
    onLayoutClose?: () => void
    onRelationSelect?: (relationId: string) => void
}

const INITIAL_LAYOUT_STATE: RelationLayoutState = {
    layoutReady: false,
    layoutLoading: false,
    layoutError: null,
}

type ProjectRelationNode = RelationNodeInput & RelationGraphNode & {entryType?: string | null}

/** 一次性拉取的词条数量上限，用于把 type 映射到图节点；超出的节点回退为无类型样式。 */
const ENTRY_TYPE_LOOKUP_LIMIT = 2000
const DEFAULT_LAYOUT_LOOSENESS = 1
/** 项目级设置键：关系图谱布局参数。 */
const RELATION_GRAPH_LAYOUT_SETTING_KEY = 'relation_graph_layout'

type LayoutParamMode = 'simple' | 'advanced'

type LayoutParamKey =
    | 'collisionPadding'
    | 'nodeGap'
    | 'collisionPassesPerIteration'
    | 'finalCollisionPasses'
    | 'edgeClearanceMargin'
    | 'edgeClearanceRadiusFactor'
    | 'edgeClearanceStrength'
    | 'edgeClearancePasses'
    | 'edgeLengthAlphaRho'
    | 'edgeLengthAlphaCv'
    | 'edgeLengthMin'
    | 'edgeLengthMax'
    | 'twoWayEdgeLengthFactor'
    | 'twoWayAttractionWeight'
    | 'degreeEdgeLengthScale'
    | 'degreeEdgeLengthMaxFactor'
    | 'initialTemperatureGamma'
    | 'minTemperatureGamma'
    | 'minTemperatureRatio'
    | 'iterationBase'
    | 'iterationSqrtScale'
    | 'iterationRhoScale'
    | 'iterationMin'
    | 'iterationMax'
    | 'initRadiusBetaRmax'
    | 'estimatedAreaBetaRho'
    | 'estimatedAreaBetaCv'
    | 'pathishEdgeLengthReduction'
    | 'pathishInitRadiusReduction'
    | 'pathishAxisCompactionMax'
    | 'pathishRadialPullMax'
    | 'pathishLeafPullMax'
    | 'pathishBranchSmoothingMax'
    | 'postLayoutCompactionPasses'
    | 'aspectCompactionTrigger'
    | 'aspectCompactionMax'
    | 'earlyStopThreshold'
    | 'earlyStopStreak'
    | 'componentGap'
    | 'shelfRowMaxWidth'
    | 'isolatedNodeHorizontalGap'
    | 'clusterBoxGap'
    | 'clusterLinkDistanceBase'
    | 'clusterRepulsionSoft'
    | 'clusterCenterPull'
    | 'clusterTemperatureInitial'
    | 'clusterTemperatureDecay'
    | 'clusterIterations'
    | 'clusterTwoWayBonus'
    | 'clusterHorizontalStretch'
    | 'orientationLinearityThreshold'
    | 'viewportAspect'
    | 'shapeSlackWeight'

interface LayoutParamField {
    key: LayoutParamKey
    label: string
    min?: number
    max?: number
    step?: number
    integer?: boolean
}

const LAYOUT_PARAM_DEFAULTS: Record<LayoutParamKey, number> = {
    collisionPadding: 40,
    nodeGap: 28,
    collisionPassesPerIteration: 5,
    finalCollisionPasses: 40,
    edgeClearanceMargin: 8,
    edgeClearanceRadiusFactor: 0.7,
    edgeClearanceStrength: 0.5,
    edgeClearancePasses: 12,
    edgeLengthAlphaRho: 0.7,
    edgeLengthAlphaCv: 0.5,
    edgeLengthMin: 100,
    edgeLengthMax: 320,
    twoWayEdgeLengthFactor: 0.84,
    twoWayAttractionWeight: 1.68,
    degreeEdgeLengthScale: 0.12,
    degreeEdgeLengthMaxFactor: 1.7,
    initialTemperatureGamma: 0.26,
    minTemperatureGamma: 0.08,
    minTemperatureRatio: 1.5,
    iterationBase: 54,
    iterationSqrtScale: 28,
    iterationRhoScale: 150,
    iterationMin: 72,
    iterationMax: 360,
    initRadiusBetaRmax: 1,
    estimatedAreaBetaRho: 0.9,
    estimatedAreaBetaCv: 0.65,
    pathishEdgeLengthReduction: 0.32,
    pathishInitRadiusReduction: 0.34,
    pathishAxisCompactionMax: 0.36,
    pathishRadialPullMax: 0.2,
    pathishLeafPullMax: 0.34,
    pathishBranchSmoothingMax: 0.28,
    postLayoutCompactionPasses: 5,
    aspectCompactionTrigger: 1.6,
    aspectCompactionMax: 0.22,
    earlyStopThreshold: 0.14,
    earlyStopStreak: 12,
    componentGap: 84,
    shelfRowMaxWidth: 1800,
    isolatedNodeHorizontalGap: 56,
    clusterBoxGap: 56,
    clusterLinkDistanceBase: 100,
    clusterRepulsionSoft: 14,
    clusterCenterPull: 0.02,
    clusterTemperatureInitial: 42,
    clusterTemperatureDecay: 0.95,
    clusterIterations: 80,
    clusterTwoWayBonus: 0.35,
    clusterHorizontalStretch: 1.3,
    orientationLinearityThreshold: 0.35,
    viewportAspect: 1.7,
    shapeSlackWeight: 0.125,
}

const ADVANCED_LAYOUT_GROUPS: Array<{title: string; fields: LayoutParamField[]}> = [
    {
        title: '间距',
        fields: [
            {key: 'collisionPadding', label: '碰撞留白', min: 0, step: 4},
            {key: 'nodeGap', label: '节点空隙', min: 0, step: 4},
            {key: 'componentGap', label: '分量间距', min: 0, step: 8},
            {key: 'isolatedNodeHorizontalGap', label: '孤立节点间距', min: 0, step: 4},
            {key: 'clusterBoxGap', label: '簇盒间距', min: 0, step: 4},
            {key: 'shelfRowMaxWidth', label: '单行宽度', min: 300, step: 50},
        ],
    },
    {
        title: '边净空',
        fields: [
            {key: 'edgeClearanceMargin', label: '净空余量', min: 0, step: 2},
            {key: 'edgeClearanceRadiusFactor', label: '半径折算', min: 0, max: 2, step: 0.05},
            {key: 'edgeClearanceStrength', label: '推移强度', min: 0, max: 1, step: 0.05},
            {key: 'edgeClearancePasses', label: '遍数', min: 0, step: 1, integer: true},
        ],
    },
    {
        title: '边长',
        fields: [
            {key: 'edgeLengthMin', label: '最小边长', min: 20, step: 10},
            {key: 'edgeLengthMax', label: '最大边长', min: 40, step: 10},
            {key: 'edgeLengthAlphaRho', label: '密度放大', min: 0, step: 0.05},
            {key: 'edgeLengthAlphaCv', label: '离散放大', min: 0, step: 0.05},
            {key: 'twoWayEdgeLengthFactor', label: '双向边长度因子', min: 0.2, max: 1.5, step: 0.02},
            {key: 'twoWayAttractionWeight', label: '双向边吸引权重', min: 0.1, step: 0.05},
            {key: 'degreeEdgeLengthScale', label: '枢纽边长放大', min: 0, max: 0.5, step: 0.02},
            {key: 'degreeEdgeLengthMaxFactor', label: '枢纽边长上限', min: 1, max: 3, step: 0.05},
        ],
    },
    {
        title: '迭代',
        fields: [
            {key: 'iterationBase', label: '基础轮数', min: 0, step: 2},
            {key: 'iterationSqrtScale', label: '节点数轮数系数', min: 0, step: 2},
            {key: 'iterationRhoScale', label: '密度轮数系数', min: 0, step: 10},
            {key: 'iterationMin', label: '最少轮数', min: 1, step: 4, integer: true},
            {key: 'iterationMax', label: '最多轮数', min: 1, step: 10, integer: true},
            {key: 'collisionPassesPerIteration', label: '每轮碰撞修正', min: 0, step: 1, integer: true},
            {key: 'finalCollisionPasses', label: '最终碰撞修正', min: 0, step: 2, integer: true},
            {key: 'earlyStopThreshold', label: '早停阈值', min: 0, step: 0.01},
            {key: 'earlyStopStreak', label: '早停连续轮数', min: 1, step: 1, integer: true},
        ],
    },
    {
        title: '链状结构',
        fields: [
            {key: 'pathishEdgeLengthReduction', label: '链状边长回缩', min: 0, max: 1, step: 0.02},
            {key: 'pathishInitRadiusReduction', label: '链状初始回缩', min: 0, max: 1, step: 0.02},
            {key: 'pathishAxisCompactionMax', label: '主轴压缩', min: 0, max: 1, step: 0.02},
            {key: 'pathishRadialPullMax', label: '外圈回收', min: 0, max: 1, step: 0.02},
            {key: 'pathishLeafPullMax', label: '叶节点回拽', min: 0, max: 1, step: 0.02},
            {key: 'pathishBranchSmoothingMax', label: '枝条平滑', min: 0, max: 1, step: 0.02},
            {key: 'postLayoutCompactionPasses', label: '后处理压缩轮数', min: 0, step: 1, integer: true},
            {key: 'aspectCompactionTrigger', label: '长宽比触发阈值', min: 1, max: 5, step: 0.1},
            {key: 'aspectCompactionMax', label: '长宽比压实强度', min: 0, max: 0.42, step: 0.02},
        ],
    },
    {
        title: '簇布局',
        fields: [
            {key: 'clusterLinkDistanceBase', label: '簇连接距离', min: 0, step: 10},
            {key: 'clusterRepulsionSoft', label: '簇斥力', min: 0, step: 1},
            {key: 'clusterCenterPull', label: '簇向心力', min: 0, step: 0.01},
            {key: 'clusterTemperatureInitial', label: '簇初始温度', min: 0, step: 2},
            {key: 'clusterTemperatureDecay', label: '簇温度衰减', min: 0.5, max: 0.999, step: 0.005},
            {key: 'clusterIterations', label: '簇迭代轮数', min: 1, step: 5, integer: true},
            {key: 'clusterTwoWayBonus', label: '跨簇双向奖励', min: 0, step: 0.05},
            {key: 'clusterHorizontalStretch', label: '簇横向偏置', min: 1, max: 2.5, step: 0.05},
            {key: 'orientationLinearityThreshold', label: '簇朝向线性阈值', min: 0, max: 1.01, step: 0.05},
            // 0 = 退回按包围盒面积评分（旧行为）。取值应接近关系图面板的实际宽高比。
            {key: 'viewportAspect', label: '目标视口宽高比', min: 0, max: 3, step: 0.05},
            {key: 'shapeSlackWeight', label: '非约束方向收缩权重', min: 0, max: 1, step: 0.025},
        ],
    },
]

function normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : '未知错误')
}

function fallbackCover(seed: string, title: string): string {
    const mark = title.trim().slice(0, 2) || '词条'
    const hue = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
        <rect width="96" height="96" rx="18" fill="hsl(${hue} 62% 44%)" />
        <circle cx="70" cy="26" r="16" fill="rgba(255,255,255,0.16)" />
        <text x="48" y="58" fill="white" font-size="22" font-family="Microsoft YaHei, sans-serif" font-weight="700" text-anchor="middle">${mark}</text>
      </svg>
    `.trim()
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function coverSrc(node: RelationGraphNode): string {
    const cover = node.coverImage
    if (!cover) return fallbackCover(node.id, node.title)
    if (/^(https?:|data:|blob:|asset:|fcimg:)/i.test(cover)) return cover
    return convertFileSrc(String(cover), 'fcimg')
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function roundLayoutParam(value: number): number {
    return Number(value.toFixed(4))
}

function cloneDefaultLayoutParams(): RelationLayoutParams {
    return {...LAYOUT_PARAM_DEFAULTS}
}

function normalizeLayoutParams(params: RelationLayoutParams): RelationLayoutParams {
    const next: RelationLayoutParams = {}
    for (const [key, value] of Object.entries(params) as Array<[keyof RelationLayoutParams, unknown]>) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            next[key] = value
        }
    }
    return next
}

function buildSimpleLayoutParams(looseness: number): RelationLayoutParams {
    const scale = clampNumber(looseness, 0.65, 1.8)
    const edgeScale = Math.pow(scale, 1.08)

    return {
        collisionPadding: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.collisionPadding * scale),
        nodeGap: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.nodeGap * scale),
        edgeLengthMin: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.edgeLengthMin * edgeScale),
        edgeLengthMax: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.edgeLengthMax * edgeScale),
        componentGap: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.componentGap * scale),
        isolatedNodeHorizontalGap: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.isolatedNodeHorizontalGap * scale),
        clusterBoxGap: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.clusterBoxGap * scale),
        clusterLinkDistanceBase: roundLayoutParam(LAYOUT_PARAM_DEFAULTS.clusterLinkDistanceBase * scale),
    }
}

function parseLayoutParamInput(rawValue: string, integer?: boolean): number | undefined {
    const trimmed = rawValue.trim()
    if (!trimmed) return undefined

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return undefined

    return integer ? Math.round(parsed) : parsed
}

interface PersistedLayoutConfig {
    mode: LayoutParamMode
    looseness: number
    advanced: RelationLayoutParams
}

/** 解析持久化的布局配置；脏数据或缺字段时安全回退。 */
function parsePersistedLayoutConfig(raw: string | null): PersistedLayoutConfig | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as Partial<PersistedLayoutConfig>
        const mode: LayoutParamMode = parsed.mode === 'advanced' ? 'advanced' : 'simple'
        const looseness = typeof parsed.looseness === 'number' && Number.isFinite(parsed.looseness)
            ? clampNumber(parsed.looseness, 0.65, 1.8)
            : DEFAULT_LAYOUT_LOOSENESS
        const advanced = parsed.advanced && typeof parsed.advanced === 'object'
            ? normalizeLayoutParams(parsed.advanced as RelationLayoutParams)
            : {}
        return {mode, looseness, advanced}
    } catch {
        return null
    }
}

export default function ProjectRelationGraph({
    projectId,
    sidebarContainer,
    layoutContainer,
    hideHeader = false,
    onLayoutClose,
    onRelationSelect,
}: ProjectRelationGraphProps) {
    const [graphKey, setGraphKey] = useState(0)
    const [nodes, setNodes] = useState<ProjectRelationNode[]>([])
    const [edges, setEdges] = useState<RelationGraphEdge[]>([])
    const [entryTypes, setEntryTypes] = useState<EntryTypeView[]>([])
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
    const [dataLoading, setDataLoading] = useState(false)
    const [dataError, setDataError] = useState<Error | null>(null)
    const [layoutState, setLayoutState] = useState<RelationLayoutState>(INITIAL_LAYOUT_STATE)
    const [layoutPanelOpen, setLayoutPanelOpen] = useState(false)
    const [layoutParamMode, setLayoutParamMode] = useState<LayoutParamMode>('simple')
    const [layoutLooseness, setLayoutLooseness] = useState(DEFAULT_LAYOUT_LOOSENESS)
    const [advancedLayoutParams, setAdvancedLayoutParams] = useState<RelationLayoutParams>(() => cloneDefaultLayoutParams())
    const [appliedLayoutParams, setAppliedLayoutParams] = useState<RelationLayoutParams>(
        () => buildSimpleLayoutParams(DEFAULT_LAYOUT_LOOSENESS),
    )

    // 词条类型以 type key 索引，供节点解析颜色与图标。
    const entryTypeByKey = useMemo(() => {
        const map = new Map<string, EntryTypeView>()
        for (const et of entryTypes) {
            map.set(entryTypeKey(et), et)
        }
        return map
    }, [entryTypes])

    const loadGraphData = useCallback(async () => {
        setDataLoading(true)
        setDataError(null)

        try {
            // 图节点数据不含 type，需并行拉取词条列表（取 id→type）、类型定义（取 color/icon/name），
            // 以及该项目持久化的布局参数。
            const [data, entries, types, savedLayout] = await Promise.all([
                db_get_relation_graph_data(projectId),
                db_list_entries({projectId, limit: ENTRY_TYPE_LOOKUP_LIMIT, offset: 0}),
                db_list_all_entry_types(projectId),
                db_get_project_setting(projectId, RELATION_GRAPH_LAYOUT_SETTING_KEY),
            ])
            const typeById = new Map(entries.map((entry) => [entry.id, entry.type ?? null]))
            setNodes(data.nodes.map((node) => ({...node, entryType: typeById.get(node.id) ?? null})))
            setEdges(data.edges)
            setSelectedEdgeId(null)
            setEntryTypes(types)

            // 恢复持久化的布局参数；无记录则回到默认，避免不同项目之间串档。
            const savedConfig = parsePersistedLayoutConfig(savedLayout)
            if (savedConfig) {
                const mergedAdvanced = {...cloneDefaultLayoutParams(), ...savedConfig.advanced}
                setLayoutParamMode(savedConfig.mode)
                setLayoutLooseness(savedConfig.looseness)
                setAdvancedLayoutParams(mergedAdvanced)
                setAppliedLayoutParams(
                    savedConfig.mode === 'simple'
                        ? buildSimpleLayoutParams(savedConfig.looseness)
                        : normalizeLayoutParams(mergedAdvanced),
                )
            } else {
                setLayoutParamMode('simple')
                setLayoutLooseness(DEFAULT_LAYOUT_LOOSENESS)
                setAdvancedLayoutParams(cloneDefaultLayoutParams())
                setAppliedLayoutParams(buildSimpleLayoutParams(DEFAULT_LAYOUT_LOOSENESS))
            }

            setLayoutState(INITIAL_LAYOUT_STATE)
            setGraphKey((prev) => prev + 1)
        } catch (error) {
            setDataError(normalizeError(error))
        } finally {
            setDataLoading(false)
        }
    }, [projectId])

    useEffect(() => {
        void loadGraphData()
    }, [loadGraphData])

    const layoutFn = useCallback<LayoutFunction>(async (request: LayoutRequest): Promise<LayoutResponse> => {
        const response = await compute_layout({
            nodeOrigin: request.nodeOrigin ?? null,
            nodes: request.nodes,
            edges: request.edges,
            params: request.params ?? appliedLayoutParams,
        })

        return {
            positions: response.positions,
            bounds: response.bounds ?? undefined,
            layoutHash: response.layoutHash ?? undefined,
        }
    }, [appliedLayoutParams])

    const handleRefresh = useCallback(() => {
        void loadGraphData()
    }, [loadGraphData])

    const handleAdvancedLayoutParamChange = useCallback((
        key: LayoutParamKey,
        rawValue: string,
        integer?: boolean,
    ) => {
        const value = parseLayoutParamInput(rawValue, integer)
        setAdvancedLayoutParams((current) => ({
            ...current,
            [key]: value,
        }))
    }, [])

    const handleLayoutLoosenessChange = useCallback((value: number | [number, number]) => {
        setLayoutLooseness(Array.isArray(value) ? value[0] : value)
    }, [])

    const handleResetLayoutParams = useCallback(() => {
        if (layoutParamMode === 'simple') {
            setLayoutLooseness(DEFAULT_LAYOUT_LOOSENESS)
            return
        }

        setAdvancedLayoutParams(cloneDefaultLayoutParams())
    }, [layoutParamMode])

    const handleApplyLayoutParams = useCallback(() => {
        const nextParams = layoutParamMode === 'simple'
            ? buildSimpleLayoutParams(layoutLooseness)
            : normalizeLayoutParams(advancedLayoutParams)

        setAppliedLayoutParams(nextParams)
        setLayoutState(INITIAL_LAYOUT_STATE)
        setGraphKey((prev) => prev + 1)
        setLayoutPanelOpen(false)
        onLayoutClose?.()

        // 持久化到项目级设置（失败不阻塞布局）。
        const persisted: PersistedLayoutConfig = {
            mode: layoutParamMode,
            looseness: layoutLooseness,
            advanced: advancedLayoutParams,
        }
        void db_set_project_setting(
            projectId,
            RELATION_GRAPH_LAYOUT_SETTING_KEY,
            JSON.stringify(persisted),
        ).catch(() => {
            // 忽略持久化错误，避免影响交互。
        })
    }, [advancedLayoutParams, layoutLooseness, layoutParamMode, onLayoutClose, projectId])

    const nodeTitleById = useMemo(() => {
        const map = new Map<string, string>()
        nodes.forEach((node) => map.set(node.id, node.title || node.label || node.id))
        return map
    }, [nodes])

    const statusItems = [
        dataLoading ? '数据加载中' : null,
        dataError ? '数据加载失败' : null,
        layoutState.layoutLoading ? '布局计算中' : null,
        layoutState.layoutError ? '布局失败' : null,
    ].filter(Boolean)

    const renderNode = useCallback((data: RelationNodeInput, selected: boolean) => {
        const node = data as unknown as ProjectRelationNode
        const entryType = node.entryType ? entryTypeByKey.get(node.entryType) ?? null : null
        const accentStyle = entryType?.color
            ? ({'--rg-accent': entryType.color} as CSSProperties)
            : undefined

        return (
            <div
                className={selected ? 'rg-node rg-node--selected' : 'rg-node'}
                style={accentStyle}
            >
                <div className="rg-node__accent" aria-hidden="true"/>
                <div className="rg-node__cover-wrap">
                    <img
                        className="rg-node__cover"
                        src={coverSrc(node)}
                        alt={node.title}
                        loading="lazy"
                    />
                    {entryType && (
                        <span className="rg-node__type-badge" title={entryType.name}>
                            <EntryTypeIcon entryType={entryType} className="rg-node__type-icon"/>
                        </span>
                    )}
                </div>
                <div className="rg-node__body">
                    <div className="rg-node__title" title={node.title}>
                        {node.title}
                    </div>
                    <div className="rg-node__summary" title={node.summary}>
                        {node.summary}
                    </div>
                </div>
            </div>
        )
    }, [entryTypeByKey])

    /*
     * 布局参数正文单独拿出来：桌面仍旧塞进 FloatingPanel，移动端 portal 到独立页面。
     * 两条路径共用同一份表单，避免各写一套控件之后参数慢慢对不上。
     */
    const closeLayoutPanel = useCallback(() => {
        setLayoutPanelOpen(false)
        onLayoutClose?.()
    }, [onLayoutClose])

    const layoutPanelBody = (
        <>
            <div className="rg-layout-dialog__body">
                        <ButtonGroup className="rg-layout-mode">
                            <Button
                                type="button"
                                size="sm"
                                variant={layoutParamMode === 'simple' ? 'primary' : 'secondary'}
                                onClick={() => setLayoutParamMode('simple')}
                            >
                                简单
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={layoutParamMode === 'advanced' ? 'primary' : 'secondary'}
                                onClick={() => setLayoutParamMode('advanced')}
                            >
                                高级
                            </Button>
                        </ButtonGroup>

                        {layoutParamMode === 'simple' ? (
                            <div className="rg-layout-simple">
                                <div className="rg-layout-slider">
                                    <label>
                                        松散程度
                                        <span>{layoutLooseness.toFixed(2)}x</span>
                                    </label>
                                    <Slider
                                        value={layoutLooseness}
                                        min={0.65}
                                        max={1.8}
                                        step={0.05}
                                        tooltip
                                        onValueChange={handleLayoutLoosenessChange}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="rg-layout-advanced">
                                {ADVANCED_LAYOUT_GROUPS.map((group) => (
                                    <section key={group.title} className="rg-layout-group">
                                        <h4>{group.title}</h4>
                                        <div className="rg-layout-field-grid">
                                            {group.fields.map((field) => (
                                                <label key={field.key} className="rg-layout-field">
                                                    <span>{field.label}</span>
                                                    <Input
                                                        size="sm"
                                                        type="number"
                                                        min={field.min}
                                                        max={field.max}
                                                        step={field.step ?? (field.integer ? 1 : 0.01)}
                                                        value={advancedLayoutParams[field.key] ?? ''}
                                                        showNumberStepper
                                                        onValueChange={(value) => handleAdvancedLayoutParamChange(
                                                            field.key,
                                                            value,
                                                            field.integer,
                                                        )}
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                    </section>
                                ))}
                            </div>
                        )}
                    </div>

                    <ButtonToolbar align="right" className="rg-layout-dialog__footer">
                        <Button type="button" size="sm" radius="full" variant="outline" onClick={handleResetLayoutParams}>
                            恢复默认
                        </Button>
                        <Button type="button" size="sm" radius="full" variant="outline" onClick={closeLayoutPanel}>
                            取消
                        </Button>
                        <Button type="button" size="sm" radius="full" onClick={handleApplyLayoutParams}>
                            应用并重新布局
                        </Button>
                    </ButtonToolbar>
        </>
    )

    const layoutPanel = layoutContainer
        ? createPortal(layoutPanelBody, layoutContainer)
        : layoutPanelOpen && (
            <FloatingPanel
                open
                onClose={closeLayoutPanel}
                title="布局参数"
                className="rg-layout-dialog"
                ariaLabel="布局参数"
            >
                {layoutPanelBody}
            </FloatingPanel>
        )

    const relationSidebar = (
        <div className="rg-sidebar">
            <div className="rg-sidebar__stats">
                <div className="rg-sidebar__stat">
                    <span>词条</span>
                    <strong>{nodes.length}</strong>
                </div>
                <div className="rg-sidebar__stat">
                    <span>关系</span>
                    <strong>{edges.length}</strong>
                </div>
            </div>
            <div className="rg-sidebar__section">
                <div className="rg-sidebar__section-title">已有关系</div>
                <div className="rg-sidebar__list">
                    {edges.length === 0 ? (
                        <div className="rg-sidebar__empty">暂无关系</div>
                    ) : (
                        edges.map((edge) => (
                            <button
                                key={edge.id}
                                type="button"
                                className={`rg-sidebar__relation${edge.id === selectedEdgeId ? ' is-selected' : ''}`}
                                aria-pressed={edge.id === selectedEdgeId}
                                onClick={() => {
                                    setSelectedEdgeId(edge.id)
                                    onRelationSelect?.(edge.id)
                                }}
                            >
                                <div className="rg-sidebar__relation-main">
                                    <span title={nodeTitleById.get(edge.source) ?? edge.source}>
                                        {nodeTitleById.get(edge.source) ?? edge.source}
                                    </span>
                                    <span className="rg-sidebar__relation-arrow">→</span>
                                    <span title={nodeTitleById.get(edge.target) ?? edge.target}>
                                        {nodeTitleById.get(edge.target) ?? edge.target}
                                    </span>
                                </div>
                                <div className="rg-sidebar__relation-label" title={edge.label}>
                                    {edge.label || edge.kind}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    )

    return (
        <div className="project-relation-graph fc-op-panel">
            {sidebarContainer ? createPortal(relationSidebar, sidebarContainer) : null}

            {/* ── 顶部 ── */}
            {!hideHeader && (
                <div className="fc-op-header">
                    <div className="fc-op-header__title-block">
                        <h2 className="fc-op-header__title">关系图谱</h2>
                    </div>
                    <div className="fc-op-header__actions">
                        <Button type="button" size="sm" variant="outline" onClick={() => setLayoutPanelOpen(true)}>
                            布局参数
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={handleRefresh} disabled={dataLoading}>
                            {dataLoading ? '刷新中' : '刷新'}
                        </Button>
                    </div>
                </div>
            )}

            {/* ── 工具栏（状态） ── */}
            {statusItems.length > 0 && (
                <div className="fc-op-toolbar">
                    {statusItems.map((item, index) => (
                        <span
                            key={index}
                            className={`fc-op-status${dataError || layoutState.layoutError ? ' fc-op-status--error' : ''}`}
                        >
                            {item}
                        </span>
                    ))}
                </div>
            )}

            {/* ── 错误提示 ── */}
            {dataError && (
                <div className="fc-status-banner fc-status-banner--error">
                    数据加载失败：{dataError.message}
                </div>
            )}

            {layoutState.layoutError && (
                <div className="fc-status-banner fc-status-banner--error">
                    布局失败：{layoutState.layoutError.message}
                </div>
            )}

            {layoutPanel}

            {/* ── 视口 ── */}
            <div className="fc-op-viewport">
                {dataLoading && nodes.length === 0 ? (
                    <div className="fc-op-viewport-empty">正在加载项目关系数据…</div>
                ) : dataError ? (
                    <div className="fc-op-viewport-empty">无法展示关系图，请先处理数据加载错误。</div>
                ) : nodes.length === 0 ? (
                    <div className="fc-op-viewport-empty">当前项目还没有可展示的词条关系，请先为词条建立关系连接。</div>
                ) : (
                    <RelationGraph
                        key={graphKey}
                        nodes={nodes}
                        edges={edges}
                        layoutFn={layoutFn}
                        renderNode={renderNode}
                        fitPadding={0.12}
                        fitDuration={500}
                        onLayoutStateChange={setLayoutState}
                        selectedEdgeId={selectedEdgeId}
                        onSelectedEdgeChange={setSelectedEdgeId}
                    />
                )}
            </div>
        </div>
    )
}
