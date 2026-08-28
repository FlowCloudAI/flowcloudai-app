import {type ChangeEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {
    Button,
    Input,
    RollingBox,
    Select,
    Slider,
    useAlert,
    useContextMenu,
} from 'flowcloudai-ui'
import {
    buildPreviewSceneFromDraft,
    buildPreviewKeyLocations,
    buildPreviewShapes,
    createEmptyShapeDraft,
    createInitialMapShapeEditorViewBox,
    createMapShapeEditorLocalId,
    MAP_MARKER_CLASS_OPTIONS,
    MAP_TERRAIN_KIND_OPTIONS,
    normalizeMapEditorDraft,
    type MapShapeSvgEditorLocationContextMenuDetail,
    type MapShapeSvgEditorShapeContextMenuDetail,
    type MapShapeSvgEditorVertexContextMenuDetail,
    type MapEditorCanvas,
    type MapKeyLocationDraft,
    type MapMarkerClass,
    type MapPreviewKeyLocation,
    type MapPreviewPickDetail,
    type MapPreviewScene,
    type MapPixiLodSetting,
    type MapPixiPerfStats,
    type MapShapeDraft,
    type MapShapeEditorDraft,
    type MapTerrainBrush,
    MapShapeViewport,
    moveShapeInOrder,
    validateMapEditorDraft,
} from './MapShapeEditor'
import {
    type CoastlineParamsPayload,
    db_list_entries,
    type EntryBrief,
    log_message,
    map_delete_map_entry,
    map_list_project_maps,
    map_save_map_entry,
    map_save_scene,
    type MapEntry,
} from '../../../api'
import {FloatingPanel} from '../../../shared/ui/overlay'
import '../../../shared/ui/layout/DockPanelScaffold.css'
import '../../../shared/ui/layout/WorkspaceScaffold.css'
import './WorldMapPanel.css'
import {buildPixiLocationIconAsset, compilePixiMapStyle, getPixiMapStyle} from '../styles/pixi'
import {compactTerrainStrokes, isMapDebugLogEnabled, resolveTerrainStrokesForViewport} from '../styles/common'

function mapLog(msg: string) {
    if (!isMapDebugLogEnabled()) return
    void log_message('info', `[WorldMap] ${msg}`)
}

function isPixiPerfDebugEnabled(): boolean {
    if (typeof window === 'undefined') {
        return import.meta.env.DEV
    }

    try {
        const params = new URLSearchParams(window.location.search)
        const queryValue = params.get('pixiPerf')
        if (queryValue === '1' || queryValue === 'true') {
            return true
        }
        if (queryValue === '0' || queryValue === 'false') {
            return false
        }

        const storedValue = window.localStorage.getItem('fc:pixiPerf')
        if (storedValue === '1' || storedValue === 'true') {
            return true
        }
        if (storedValue === '0' || storedValue === 'false') {
            return false
        }
    } catch {
        return import.meta.env.DEV
    }

    return import.meta.env.DEV
}

function logPixiPerfStats(stats: MapPixiPerfStats) {
    console.info('[WorldMap PixiPerf]', stats)
}

// ── 常量 ─────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type ViewportMode = 'edit' | 'preview'
type MapStyle = 'flat' | 'tolkien' | 'ink'
type MapUtilityPanel = 'help' | 'coastline' | null
type CoastlineParamMode = NonNullable<CoastlineParamsPayload['uiMode']>
type CoastlineQualityPreset = NonNullable<CoastlineParamsPayload['qualityPreset']>

interface CoastlineQualityDefinition {
    label: string
    hint: string
    params: Pick<CoastlineParamsPayload,
        'minSegments' |
        'maxSegments' |
        'segmentBase' |
        'segmentLengthFactor' |
        'segmentEdgeRatioFactor' |
        'relaxPasses' |
        'relaxWeight'
    >
}

type CoastlineAlgorithmChoice = NonNullable<CoastlineParamsPayload['algorithm']>

interface CoastlineSimpleConfig {
    algorithm: CoastlineAlgorithmChoice
    qualityPreset: CoastlineQualityPreset
    scaleFactor: number
    macroNoise: number
    midNoise: number
    microNoise: number
}

const DEFAULT_CANVAS: MapEditorCanvas = {width: 1000, height: 1000}
const MAP_SIZE_PRESETS = [
    {id: 'square', label: '标准方图', width: 1000, height: 1000},
    {id: 'wide', label: '宽屏地图', width: 1600, height: 1000},
    {id: 'hd', label: '高清横图', width: 1920, height: 1080},
] as const
const MAP_STYLE_LABELS: Record<MapStyle, string> = {
    flat: '扁平',
    tolkien: '托尔金',
    ink: '墨线',
}
const PIXI_LOD_LABELS: Record<MapPixiLodSetting, string> = {
    auto: '自动',
    overview: '概览',
    low: '低',
    medium: '中',
    high: '高',
    original: '原始',
}
const COASTLINE_BASE_PARAMS: Required<Pick<CoastlineParamsPayload,
    'amplitudeBase' |
    'amplitudeMin' |
    'amplitudeCanvasRatioMax' |
    'waveAWeight' |
    'waveAStrength' |
    'waveBWeight' |
    'waveBStrength' |
    'waveCWeight' |
    'waveCStrength'
>> = {
    amplitudeBase: 1,
    amplitudeMin: 2,
    amplitudeCanvasRatioMax: 0.025,
    waveAWeight: 0.50,
    waveAStrength: 1,
    waveBWeight: 0.29,
    waveBStrength: 1,
    waveCWeight: 0.30,
    waveCStrength: 1,
}

const COASTLINE_DEFAULT_SIMPLE_CONFIG: CoastlineSimpleConfig = {
    algorithm: 'v1',
    qualityPreset: 'balanced',
    scaleFactor: 1,
    macroNoise: 1,
    midNoise: 1,
    microNoise: 1,
}

const COASTLINE_ALGORITHM_LABELS: Record<CoastlineAlgorithmChoice, string> = {
    v1: '经典 v1',
    v2: '实验 v2',
}

const COASTLINE_ALGORITHM_HINTS: Record<CoastlineAlgorithmChoice, string> = {
    v1: '逐边扰动：成熟稳定，但效果受原始边长影响。',
    v2: '全周长噪声：起伏与原始边长无关，海湾可跨越顶点（实验中）。',
}

/** v2 算法按质量档位映射的采样点数上限（采样步长由后端按最小波长推导）。 */
const COASTLINE_V2_QUALITY_MAX_POINTS: Record<CoastlineQualityPreset, number> = {
    preview: 512,
    rough: 1024,
    balanced: 2048,
    fine: 4096,
    print: 10240,
}

/** v2 算法按质量档位映射的细节波长缩放：越小细节越精细、点数越多。 */
const COASTLINE_V2_QUALITY_DETAIL_SCALE: Record<CoastlineQualityPreset, number> = {
    preview: 1.5,
    rough: 1.2,
    balanced: 1.0,
    fine: 0.7,
    print: 0.5,
}

/** 把简单模式的旋钮（档位/尺度/三层扰动）换算成 v2 参数；波长与基础振幅走后端绝对像素默认值。 */
function buildCoastlineV2Params(config: CoastlineSimpleConfig): NonNullable<CoastlineParamsPayload['v2']> {
    return {
        maxPoints: COASTLINE_V2_QUALITY_MAX_POINTS[config.qualityPreset],
        detailWavelengthScale: COASTLINE_V2_QUALITY_DETAIL_SCALE[config.qualityPreset],
        amplitudeScale: clampNumber(config.scaleFactor, 0.2, 3),
        bandAWeight: clampNumber(config.macroNoise, 0, 2),
        bandBWeight: clampNumber(config.midNoise, 0, 2),
        bandCWeight: clampNumber(config.microNoise, 0, 2),
    }
}

const COASTLINE_QUALITY_PRESETS: Record<CoastlineQualityPreset, CoastlineQualityDefinition> = {
    preview: {
        label: '预览',
        hint: '最快生成，用于确认轮廓和地点关系。',
        params: {
            minSegments: 2,
            maxSegments: 8,
            segmentBase: 4,
            segmentLengthFactor: 2,
            segmentEdgeRatioFactor: 5,
            relaxPasses: 1,
            relaxWeight: 0.18,
        },
    },
    rough: {
        label: '粗糙',
        hint: '较快生成，保留基本海岸线起伏。',
        params: {
            minSegments: 3,
            maxSegments: 16,
            segmentBase: 8,
            segmentLengthFactor: 4,
            segmentEdgeRatioFactor: 10,
            relaxPasses: 1,
            relaxWeight: 0.16,
        },
    },
    balanced: {
        label: '平衡',
        hint: '默认档位，细节和速度比较均衡。',
        params: {
            minSegments: 5,
            maxSegments: 32,
            segmentBase: 15,
            segmentLengthFactor: 8,
            segmentEdgeRatioFactor: 18,
            relaxPasses: 2,
            relaxWeight: 0.16,
        },
    },
    fine: {
        label: '精细',
        hint: '生成更多局部细节，适合定稿前预览。',
        params: {
            minSegments: 8,
            maxSegments: 52,
            segmentBase: 24,
            segmentLengthFactor: 12,
            segmentEdgeRatioFactor: 28,
            relaxPasses: 2,
            relaxWeight: 0.14,
        },
    },
    print: {
        label: '印刷',
        hint: '最高细节，适合输出前使用，生成时间最长。',
        params: {
            minSegments: 10,
            maxSegments: 80,
            segmentBase: 34,
            segmentLengthFactor: 18,
            segmentEdgeRatioFactor: 42,
            relaxPasses: 2,
            relaxWeight: 0.12,
        },
    },
}

const DEFAULT_COASTLINE_PARAMS: CoastlineParamsPayload = buildSimpleCoastlineParams(COASTLINE_DEFAULT_SIMPLE_CONFIG)

// ── 辅助函数 ───────────────────────────────────────────────────────────────────

function emptyDraft(): MapShapeEditorDraft {
    return {shapes: [], keyLocations: [], terrainStrokes: []}
}

function compactDraftTerrain(draft: MapShapeEditorDraft, canvas: MapEditorCanvas): MapShapeEditorDraft {
    const terrainStrokes = compactTerrainStrokes(draft.terrainStrokes, canvas.width, canvas.height)
    return terrainStrokes === draft.terrainStrokes ? draft : {...draft, terrainStrokes}
}

function hasPendingTerrainGeneration(draft: MapShapeEditorDraft, scene: MapPreviewScene | null): boolean {
    return JSON.stringify(draft.terrainStrokes ?? []) !== JSON.stringify(scene?.terrainStrokes ?? [])
}

// 地形类型元数据统一取自 types.ts（与编辑器活笔预览共用同一颜色来源）
const TERRAIN_KIND_OPTIONS = MAP_TERRAIN_KIND_OPTIONS
const DEFAULT_TERRAIN_BRUSH: MapTerrainBrush = {
    kind: 'grass',
    radius: 48,
    mode: 'paint',
    shape: 'round',
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min
    }
    return Math.min(max, Math.max(min, value))
}

function readNumber(value: unknown, fallback: number): number {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
}

function readSliderNumber(value: number | [number, number]): number {
    return Array.isArray(value) ? value[1] : value
}

function readCoastlineSimpleConfig(params: CoastlineParamsPayload): CoastlineSimpleConfig {
    const qualityPreset = params.qualityPreset && params.qualityPreset in COASTLINE_QUALITY_PRESETS
        ? params.qualityPreset
        : COASTLINE_DEFAULT_SIMPLE_CONFIG.qualityPreset

    return {
        algorithm: params.algorithm === 'v2' ? 'v2' : 'v1',
        qualityPreset,
        scaleFactor: clampNumber(
            readNumber(params.scaleFactor, COASTLINE_DEFAULT_SIMPLE_CONFIG.scaleFactor),
            0.2,
            3,
        ),
        macroNoise: clampNumber(
            readNumber(params.macroNoise, COASTLINE_DEFAULT_SIMPLE_CONFIG.macroNoise),
            0,
            2,
        ),
        midNoise: clampNumber(
            readNumber(params.midNoise, COASTLINE_DEFAULT_SIMPLE_CONFIG.midNoise),
            0,
            2,
        ),
        microNoise: clampNumber(
            readNumber(params.microNoise, COASTLINE_DEFAULT_SIMPLE_CONFIG.microNoise),
            0,
            2,
        ),
    }
}

function buildSimpleCoastlineParams(config: CoastlineSimpleConfig): CoastlineParamsPayload {
    const quality = COASTLINE_QUALITY_PRESETS[config.qualityPreset]
    const scaleFactor = clampNumber(config.scaleFactor, 0.2, 3)
    const macroNoise = clampNumber(config.macroNoise, 0, 2)
    const midNoise = clampNumber(config.midNoise, 0, 2)
    const microNoise = clampNumber(config.microNoise, 0, 2)

    return {
        uiMode: 'simple',
        algorithm: config.algorithm,
        v2: config.algorithm === 'v2' ? buildCoastlineV2Params(config) : undefined,
        qualityPreset: config.qualityPreset,
        scaleFactor,
        macroNoise,
        midNoise,
        microNoise,
        ...quality.params,
        amplitudeBase: COASTLINE_BASE_PARAMS.amplitudeBase * scaleFactor,
        amplitudeMin: COASTLINE_BASE_PARAMS.amplitudeMin * Math.sqrt(scaleFactor),
        amplitudeCanvasRatioMax: COASTLINE_BASE_PARAMS.amplitudeCanvasRatioMax * scaleFactor,
        waveAWeight: COASTLINE_BASE_PARAMS.waveAWeight,
        waveAStrength: COASTLINE_BASE_PARAMS.waveAStrength * macroNoise,
        waveBWeight: COASTLINE_BASE_PARAMS.waveBWeight,
        waveBStrength: COASTLINE_BASE_PARAMS.waveBStrength * midNoise,
        waveCWeight: COASTLINE_BASE_PARAMS.waveCWeight,
        waveCStrength: COASTLINE_BASE_PARAMS.waveCStrength * microNoise,
    }
}

function normalizeCoastlineParams(value: CoastlineParamsPayload | null | undefined): CoastlineParamsPayload {
    if (!value) {
        return DEFAULT_COASTLINE_PARAMS
    }

    if (value.uiMode === 'simple') {
        return buildSimpleCoastlineParams(readCoastlineSimpleConfig(value))
    }

    return {
        ...value,
        uiMode: 'advanced',
    }
}

interface NewMapFormState {
    name: string
    presetId: string
    width: string
    height: string
}

function normalizeMapCanvas(canvas: MapEditorCanvas | null | undefined): MapEditorCanvas {
    const width = Math.round(Number(canvas?.width))
    const height = Math.round(Number(canvas?.height))

    if (Number.isFinite(width) && Number.isFinite(height) && width >= 200 && height >= 200) {
        return {width, height}
    }

    return DEFAULT_CANVAS
}

function createDefaultNewMapForm(nextIndex: number): NewMapFormState {
    const preset = MAP_SIZE_PRESETS[0]
    return {
        name: `地图 ${nextIndex}`,
        presetId: preset.id,
        width: String(preset.width),
        height: String(preset.height),
    }
}

function newMapEntry(name: string, canvas: MapEditorCanvas): MapEntry {
    const now = new Date().toISOString()
    return {
        id: createMapShapeEditorLocalId('map'),
        name,
        draftJson: JSON.stringify(emptyDraft()),
        sceneJson: null,
        coastlineParamsJson: JSON.stringify(DEFAULT_COASTLINE_PARAMS),
        style: 'flat',
        canvas,
        backgroundImageUrl: null,
        createdAt: now,
        updatedAt: now,
    }
}

// ── 图标 ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
    )
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <path d="M3 5H13M6 5V3.5H10V5M5.5 5L6 13H10L10.5 5" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    )
}

function CloseIcon({size = 18}: { size?: number }) {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: size, height: size}}>
            <path
                d="M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    )
}

function ImageIcon() {
    return (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={{width: 13, height: 13}}>
            <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor"/>
            <path d="M2 11L5.5 7.5L8.5 10.5L11 8L14 11" fill="none" stroke="currentColor" strokeWidth="1.4"
                  strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    )
}

// ── 主组件 ────────────────────────────────────────────────────────────

interface WorldMapPanelProps {
    projectId: string
    initialMapId?: string | null
    onOpenEntry?: (entry: { id: string; title: string }) => void
    sidebarContainer?: HTMLElement | null
}

function readLinkedEntryId(location: MapKeyLocationDraft | MapPreviewKeyLocation | null): string {
    const value = location?.ext?.linkedEntryId
    return typeof value === 'string' ? value : ''
}

export default function WorldMapPanel({
                                          projectId,
                                          initialMapId,
                                          onOpenEntry,
                                          sidebarContainer,
                                      }: WorldMapPanelProps) {
    const {showAlert} = useAlert()
    const {showContextMenu} = useContextMenu()
    const imageInputRef = useRef<HTMLInputElement>(null)

    // ── 地图列表状态 ────────────────────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(true)
    const [maps, setMaps] = useState<MapEntry[]>([])
    const [activeMapId, setActiveMapId] = useState<string | null>(null)
    const [entryOptions, setEntryOptions] = useState<EntryBrief[]>([])

    // ── 当前地图编辑状态 ───────────────────────────────────────────────
    const [draft, setDraft] = useState<MapShapeEditorDraft>(emptyDraft)
    const [scene, setScene] = useState<MapPreviewScene | null>(null)
    const [style, setStyle] = useState<MapStyle>('flat')
    const [activeCanvas, setActiveCanvas] = useState<MapEditorCanvas>(DEFAULT_CANVAS)
    const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null)
    const [activeMapName, setActiveMapName] = useState('')
    const [sceneDirty, setSceneDirty] = useState(false)
    const [coastlineParams, setCoastlineParams] = useState<CoastlineParamsPayload>(DEFAULT_COASTLINE_PARAMS)

    // ── 编辑器交互状态 ──────────────────────────────────────────────
    const [drawingShape, setDrawingShape] = useState<MapShapeDraft | null>(null)
    const [terrainBrush, setTerrainBrush] = useState<MapTerrainBrush | null>(null)
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
    const [viewBox, setViewBox] = useState(() => createInitialMapShapeEditorViewBox(DEFAULT_CANVAS))
    const [viewportMode, setViewportMode] = useState<ViewportMode>('preview')
    const [pixiLodLevel, setPixiLodLevel] = useState<MapPixiLodSetting>('auto')
    const [newMapForm, setNewMapForm] = useState<NewMapFormState | null>(null)
    const [utilityPanel, setUtilityPanel] = useState<MapUtilityPanel>(null)

    // ── 操作状态 ─────────────────────────────────────────────────────────────
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    const [isGenerating, setIsGenerating] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const markMapUnsaved = useCallback(() => {
        setHasUnsavedChanges(true)
        setSaveStatus('idle')
    }, [])

    const updateDraft = useCallback((updater: MapShapeEditorDraft | ((draft: MapShapeEditorDraft) => MapShapeEditorDraft)) => {
        setDraft(current => typeof updater === 'function'
            ? (updater as (draft: MapShapeEditorDraft) => MapShapeEditorDraft)(current)
            : updater)
        setSceneDirty(true)
        markMapUnsaved()
    }, [markMapUnsaved])

    const loadMapDataRef = useRef<(entry: MapEntry) => void>(() => {
    })

    // ── 挂载时加载地图列表 ────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false
        setIsLoading(true)

        void map_list_project_maps(projectId).then((entries) => {
            if (cancelled) return
            setMaps(entries)
            if (entries.length > 0) {
                loadMapDataRef.current(entries.find(entry => entry.id === initialMapId) ?? entries[0])
            }
            setIsLoading(false)
        }).catch((e: unknown) => {
            if (!cancelled) {
                setErrorMsg(`加载地图列表失败：${e instanceof Error ? e.message : String(e)}`)
                setIsLoading(false)
            }
        })

        return () => {
            cancelled = true
        }
    }, [initialMapId, projectId])

    useEffect(() => {
        let cancelled = false

        void db_list_entries({
            projectId,
            entryType: 'location',
            limit: 1000,
            offset: 0,
        }).then((entries) => {
            if (cancelled) return
            setEntryOptions(entries)
        }).catch(() => {
            if (!cancelled) setEntryOptions([])
        })

        return () => {
            cancelled = true
        }
    }, [projectId])

    // ── 将地图条目加载到编辑器状态 ────────────────────────────────────

    const loadMapData = useCallback((entry: MapEntry) => {
        let nextDraft = emptyDraft()
        try {
            nextDraft = normalizeMapEditorDraft(JSON.parse(entry.draftJson) as MapShapeEditorDraft)
        } catch {
            // 保留空草稿
        }
        let nextScene: MapPreviewScene | null = null
        try {
            nextScene = entry.sceneJson ? JSON.parse(entry.sceneJson) as MapPreviewScene : null
        } catch {
            // 保留空场景
        }
        setDraft(nextDraft)
        setScene(nextScene)
        try {
            setCoastlineParams(
                entry.coastlineParamsJson
                    ? normalizeCoastlineParams(JSON.parse(entry.coastlineParamsJson) as CoastlineParamsPayload)
                    : DEFAULT_COASTLINE_PARAMS,
            )
        } catch {
            setCoastlineParams(DEFAULT_COASTLINE_PARAMS)
        }
        setStyle((entry.style as MapStyle) ?? 'flat')
        const nextCanvas = normalizeMapCanvas(entry.canvas)
        setActiveCanvas(nextCanvas)
        setBackgroundImageUrl(entry.backgroundImageUrl)
        setActiveMapName(entry.name)
        setActiveMapId(entry.id)
        setSceneDirty(hasPendingTerrainGeneration(nextDraft, nextScene))
        setDrawingShape(null)
        setTerrainBrush(null)
        setSelectedShapeId(null)
        setSelectedLocationId(null)
        setViewBox(createInitialMapShapeEditorViewBox(nextCanvas))
        setViewportMode('preview')
        setHasUnsavedChanges(false)
        setSaveStatus('idle')
        setErrorMsg(null)
    }, [])

    useEffect(() => {
        loadMapDataRef.current = loadMapData
    }, [loadMapData])

    // ── 从编辑器状态构建当前条目 ─────────────────────────────────

    const buildCurrentEntry = useCallback((
        existingEntry: MapEntry,
        currentScene: MapPreviewScene | null,
        currentDraft: MapShapeEditorDraft,
        currentStyle: MapStyle,
        currentCanvas: MapEditorCanvas,
        currentBg: string | null,
        currentName: string,
        currentCoastlineParams: CoastlineParamsPayload,
    ): MapEntry => ({
        ...existingEntry,
        name: currentName,
        draftJson: JSON.stringify(compactDraftTerrain(currentDraft, currentCanvas)),
        sceneJson: currentScene ? JSON.stringify({
            ...currentScene,
            terrainStrokes: compactTerrainStrokes(
                currentScene.terrainStrokes,
                currentCanvas.width,
                currentCanvas.height,
            ),
        }) : existingEntry.sceneJson,
        coastlineParamsJson: JSON.stringify(currentCoastlineParams),
        style: currentStyle,
        canvas: currentCanvas,
        backgroundImageUrl: currentBg,
        updatedAt: new Date().toISOString(),
    }), [])

    // ── 自动保存当前地图（静默，切换前调用） ───────────────

    const autoSave = useCallback(async (
        mapId: string,
        currentDraft: MapShapeEditorDraft,
        currentScene: MapPreviewScene | null,
        currentStyle: MapStyle,
        currentCanvas: MapEditorCanvas,
        currentBg: string | null,
        currentName: string,
        currentCoastlineParams: CoastlineParamsPayload,
    ) => {
        const existing = maps.find(m => m.id === mapId)
        if (!existing) return

        const previewScene = buildPreviewSceneFromDraft({
            canvas: currentCanvas,
            shapes: currentDraft.shapes,
            keyLocations: currentDraft.keyLocations,
            terrainStrokes: currentDraft.terrainStrokes,
        })
        const sceneToSave = currentScene
            ? {
                ...currentScene,
                keyLocations: previewScene.keyLocations,
            }
            : null

        const entry = buildCurrentEntry(existing, sceneToSave, currentDraft, currentStyle, currentCanvas, currentBg, currentName, currentCoastlineParams)
        try {
            const saved = await map_save_map_entry(projectId, entry)
            setMaps(prev => prev.map(m => m.id === mapId ? saved : m))
        } catch {
            // 静默 — 不阻塞切换
        }
    }, [maps, projectId, buildCurrentEntry])

    // ── 切换到其他地图 ─────────────────────────────────────────────────

    const handleSwitchMap = useCallback(async (entry: MapEntry) => {
        if (entry.id === activeMapId) return
        if (activeMapId && hasUnsavedChanges) {
            await autoSave(activeMapId, draft, scene, style, activeCanvas, backgroundImageUrl, activeMapName, coastlineParams)
        }
        loadMapData(entry)
    }, [activeMapId, hasUnsavedChanges, draft, scene, style, activeCanvas, backgroundImageUrl, activeMapName, coastlineParams, autoSave, loadMapData])

    // ── 新建地图 ────────────────────────────────────────────────────────

    const handleCreateMap = useCallback(async () => {
        setNewMapForm(createDefaultNewMapForm(maps.length + 1))
    }, [maps.length])

    const handleNewMapPresetChange = useCallback((presetId: string) => {
        const preset = MAP_SIZE_PRESETS.find(item => item.id === presetId)
        setNewMapForm(current => {
            if (!current) return current
            if (!preset) {
                return {...current, presetId}
            }

            return {
                ...current,
                presetId,
                width: String(preset.width),
                height: String(preset.height),
            }
        })
    }, [])

    const handleSubmitCreateMap = useCallback(async () => {
        if (!newMapForm) return

        const name = newMapForm.name.trim() || `地图 ${maps.length + 1}`
        const width = Math.round(Number(newMapForm.width))
        const height = Math.round(Number(newMapForm.height))
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 200 || height < 200) {
            setErrorMsg('地图宽高至少需要 200 像素。')
            return
        }

        if (activeMapId && hasUnsavedChanges) {
            await autoSave(activeMapId, draft, scene, style, activeCanvas, backgroundImageUrl, activeMapName, coastlineParams)
        }

        const entry = newMapEntry(name, {width, height})
        setErrorMsg(null)
        try {
            const saved = await map_save_map_entry(projectId, entry)
            setMaps(prev => [...prev, saved])
            loadMapData(saved)
            setNewMapForm(null)
        } catch (e) {
            setErrorMsg(`新建地图失败：${e instanceof Error ? e.message : String(e)}`)
        }
    }, [activeCanvas, activeMapId, activeMapName, autoSave, backgroundImageUrl, coastlineParams, draft, hasUnsavedChanges, loadMapData, maps.length, newMapForm, projectId, scene, style])

    // ── 删除地图 ──────────────────────────────────────────────────────────

    const handleDeleteMap = useCallback(async (mapId: string) => {
        const target = maps.find(m => m.id === mapId)
        const confirmed = await showAlert(
            `确认删除地图“${target?.name ?? '未命名地图'}”？删除后不可恢复。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        try {
            await map_delete_map_entry(projectId, mapId)
            const remaining = maps.filter(m => m.id !== mapId)
            setMaps(remaining)
            if (activeMapId === mapId) {
                if (remaining.length > 0) {
                    loadMapData(remaining[0])
                } else {
                    setActiveMapId(null)
                    setDraft(emptyDraft())
                    setTerrainBrush(null)
                    setScene(null)
                    setStyle('flat')
                    setActiveCanvas(DEFAULT_CANVAS)
                    setBackgroundImageUrl(null)
                    setActiveMapName('')
                    setSceneDirty(false)
                    setHasUnsavedChanges(false)
                    setSaveStatus('idle')
                }
            }
        } catch (e) {
            setErrorMsg(`删除失败：${e instanceof Error ? e.message : String(e)}`)
        }
    }, [projectId, maps, activeMapId, loadMapData, showAlert])

    const validation = useMemo(
        () => validateMapEditorDraft(draft, {hasDrawingShapeInProgress: Boolean(drawingShape)}),
        [draft, drawingShape],
    )

    const generateMapScene = useCallback(async (sourceDraft = draft): Promise<MapPreviewScene> => {
        const generatedDraft = compactDraftTerrain(sourceDraft, activeCanvas)
        if (generatedDraft !== sourceDraft) setDraft(generatedDraft)
        const response = await map_save_scene({
            canvas: activeCanvas,
            shapes: generatedDraft.shapes,
            keyLocations: generatedDraft.keyLocations,
            terrainStrokes: generatedDraft.terrainStrokes,
        }, coastlineParams)
        setScene(response.scene)
        setSceneDirty(false)
        return response.scene
    }, [activeCanvas, coastlineParams, draft])

    // ── 保存当前地图 ──────────────────────────────────────────────────────

    const handleSave = useCallback(async () => {
        if (!activeMapId) {
            setErrorMsg('请先新建或选择一个地图。')
            return
        }
        if (!validation.isValid) {
            setErrorMsg('当前地图草稿存在无效图形或地点，请先补完绘制或修正字段后再保存。')
            return
        }
        const existing = maps.find(m => m.id === activeMapId)
        if (!existing) return
        const draftToSave = compactDraftTerrain(draft, activeCanvas)
        if (draftToSave !== draft) setDraft(draftToSave)

        const previewScene = buildPreviewSceneFromDraft({
            canvas: activeCanvas,
            shapes: draftToSave.shapes,
            keyLocations: draftToSave.keyLocations,
            terrainStrokes: draftToSave.terrainStrokes,
        })
        let sceneToSave = scene
            ? {
                ...scene,
                keyLocations: previewScene.keyLocations,
            }
            : null

        setSaveStatus('saving')
        setIsGenerating(draftToSave.shapes.length > 0)
        setErrorMsg(null)
        try {
            if (draftToSave.shapes.length > 0) {
                sceneToSave = await generateMapScene(draftToSave)
            }
            const entry = buildCurrentEntry(existing, sceneToSave, draftToSave, style, activeCanvas, backgroundImageUrl, activeMapName, coastlineParams)
            const saved = await map_save_map_entry(projectId, entry)
            setMaps(prev => prev.map(m => m.id === activeMapId ? saved : m))
            setScene(sceneToSave)
            setHasUnsavedChanges(false)
            setSaveStatus('saved')
            setTimeout(() => setSaveStatus('idle'), 2500)
        } catch (e) {
            setSaveStatus('error')
            setErrorMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`)
        } finally {
            setIsGenerating(false)
        }
    }, [activeCanvas, activeMapId, draft, scene, style, backgroundImageUrl, activeMapName, coastlineParams, maps, projectId, buildCurrentEntry, generateMapScene, validation.isValid])

    // ── 重命名当前地图 ─────────────────────────────────────────────────────

    const handleRename = useCallback((name: string) => {
        setActiveMapName(name)
        setMaps(prev => prev.map(m => m.id === activeMapId ? {...m, name} : m))
        markMapUnsaved()
    }, [activeMapId, markMapUnsaved])

    const handleStyleChange = useCallback((nextStyle: MapStyle) => {
        if (style === nextStyle) return
        setStyle(nextStyle)
        markMapUnsaved()
    }, [markMapUnsaved, style])

    const deleteVertex = useCallback((shapeId: string, vertexId: string) => {
        updateDraft(d => ({
            ...d,
            shapes: d.shapes.map(s =>
                s.id === shapeId ? {...s, vertices: s.vertices.filter(v => v.id !== vertexId)} : s,
            ),
        }))
    }, [updateDraft])

    const requestDeleteShape = useCallback(async (shapeId: string) => {
        const target = draft.shapes.find(shape => shape.id === shapeId)
        const confirmed = await showAlert(
            `确认删除图形“${target?.name ?? '未命名图形'}”？关键地点会保留在原位置。`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        updateDraft(d => ({
            ...d,
            shapes: d.shapes.filter(s => s.id !== shapeId),
        }))
        setSelectedShapeId(id => (id === shapeId ? null : id))
    }, [draft.shapes, showAlert, updateDraft])

    const requestDeleteLocation = useCallback(async (locationId: string) => {
        const target = draft.keyLocations.find(location => location.id === locationId)
        const confirmed = await showAlert(
            `确认删除关键地点“${target?.name ?? '未命名地点'}”？`,
            'warning',
            'confirm',
        )
        if (confirmed !== 'yes') return

        updateDraft(d => ({...d, keyLocations: d.keyLocations.filter(l => l.id !== locationId)}))
        setSelectedLocationId(id => (id === locationId ? null : id))
    }, [draft.keyLocations, showAlert, updateDraft])

    const moveShapeToIndex = useCallback((shapeId: string, targetIndex: number) => {
        updateDraft(current => ({
            ...current,
            shapes: moveShapeInOrder(current.shapes, shapeId, targetIndex),
        }))
        setSelectedShapeId(shapeId)
        setSelectedLocationId(null)
    }, [updateDraft])

    const handleShapeContextMenu = useCallback((detail: MapShapeSvgEditorShapeContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '上移一层',
                disabled: detail.isAtFront,
                onClick: () => moveShapeToIndex(detail.shapeId, detail.shapeIndex + 1),
            },
            {
                label: '下移一层',
                disabled: detail.isAtBack,
                onClick: () => moveShapeToIndex(detail.shapeId, detail.shapeIndex - 1),
            },
            {
                label: '移到顶层',
                disabled: detail.isAtFront,
                onClick: () => moveShapeToIndex(detail.shapeId, detail.shapeCount - 1),
            },
            {
                label: '移到底层',
                disabled: detail.isAtBack,
                onClick: () => moveShapeToIndex(detail.shapeId, 0),
            },
            {type: 'divider'},
            {
                label: '删除图形',
                danger: true,
                onClick: () => void requestDeleteShape(detail.shapeId),
            },
        ])
    }, [moveShapeToIndex, requestDeleteShape, showContextMenu])

    const handleVertexContextMenu = useCallback((detail: MapShapeSvgEditorVertexContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '删除顶点',
                danger: true,
                onClick: () => deleteVertex(detail.shapeId, detail.vertexId),
            },
        ])
    }, [deleteVertex, showContextMenu])

    const handleLocationContextMenu = useCallback((detail: MapShapeSvgEditorLocationContextMenuDetail) => {
        showContextMenu(detail.nativeEvent, [
            {
                label: '删除地点',
                danger: true,
                onClick: () => void requestDeleteLocation(detail.locationId),
            },
        ])
    }, [requestDeleteLocation, showContextMenu])

    // ── 生成地图 ──────────────────────────────────────────────────────

    const handleGenerate = useCallback(async (): Promise<boolean> => {
        if (draft.shapes.length === 0) {
            setErrorMsg('请先绘制至少一个图形再生成地图。')
            return false
        }
        if (!validation.isValid) {
            setErrorMsg('当前草稿仍有未闭合图形或无效地点，暂时不能生成地图。')
            return false
        }
        setIsGenerating(true)
        setErrorMsg(null)
        try {
            await generateMapScene()
            setSelectedShapeId(null)
            setSelectedLocationId(null)
            setDrawingShape(null)
            setTerrainBrush(null)
            return true
        } catch (e) {
            setErrorMsg(`生成地图失败：${e instanceof Error ? e.message : String(e)}`)
            return false
        } finally {
            setIsGenerating(false)
        }
    }, [draft.shapes.length, generateMapScene, validation.isValid])

    const handleToggleViewportMode = useCallback(async () => {
        if (viewportMode === 'preview') {
            setViewportMode('edit')
            return
        }

        if (await handleGenerate()) setViewportMode('preview')
    }, [handleGenerate, viewportMode])

    // ── 底图上传 ───────────────────────────────────────────────────────────────

    const handleImageFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            setBackgroundImageUrl(reader.result as string)
            markMapUnsaved()
        }
        reader.readAsDataURL(file)
        if (imageInputRef.current) imageInputRef.current.value = ''
    }, [markMapUnsaved])

    const handleRemoveImage = useCallback(() => {
        setBackgroundImageUrl(null)
        markMapUnsaved()
    }, [markMapUnsaved])

    // ── 图形编辑辅助 ─────────────────────────────────────────────────

    const updateSelectedShape = useCallback((field: 'name' | 'fill' | 'stroke', value: string) => {
        updateDraft(d => ({
            ...d,
            shapes: d.shapes.map(s => (s.id === selectedShapeId ? {...s, [field]: value} : s)),
        }))
    }, [selectedShapeId, updateDraft])

    const updateDrawingShapeField = useCallback((field: 'name' | 'fill' | 'stroke', value: string) => {
        setDrawingShape(ds => ds ? {...ds, [field]: value} : ds)
    }, [])

    const updateSelectedLocation = useCallback((value: string) => {
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => (l.id === selectedLocationId ? {...l, name: value} : l)),
        }))
    }, [selectedLocationId, updateDraft])

    const updateSelectedLocationMarkerClass = useCallback((markerClass: MapMarkerClass) => {
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => (l.id === selectedLocationId ? {...l, markerClass} : l)),
        }))
    }, [selectedLocationId, updateDraft])

    const updateSelectedLocationLinkedEntryId = useCallback((entryId: string | null) => {
        const linkedEntry = entryOptions.find(entry => entry.id === entryId) ?? null
        updateDraft(d => ({
            ...d,
            keyLocations: d.keyLocations.map(l => {
                if (l.id !== selectedLocationId) return l
                return {
                    ...l,
                    ext: entryId ? {
                        ...(l.ext ?? {}),
                        linkedEntryId: entryId,
                        linkedEntryTitle: linkedEntry?.title ?? '',
                        linkedEntryType: linkedEntry?.type ?? '',
                    } : Object.keys(l.ext ?? {}).reduce<Record<string, unknown>>((next, key) => {
                        if (key !== 'linkedEntryId' && key !== 'linkedEntryTitle' && key !== 'linkedEntryType') {
                            next[key] = l.ext?.[key]
                        }
                        return next
                    }, {}),
                }
            }),
        }))
    }, [entryOptions, selectedLocationId, updateDraft])

    const updateCoastlineParam = useCallback((
        field: keyof CoastlineParamsPayload,
        value: string,
    ) => {
        const trimmed = value.trim()
        setCoastlineParams(current => ({
            ...current,
            uiMode: 'advanced',
            [field]: trimmed === '' ? undefined : Number(trimmed),
        }))
        markMapUnsaved()
    }, [markMapUnsaved])

    const updateCoastlineMode = useCallback((mode: CoastlineParamMode) => {
        setCoastlineParams(current => {
            if (mode === 'simple') {
                return buildSimpleCoastlineParams(readCoastlineSimpleConfig(current))
            }

            return {
                ...current,
                uiMode: 'advanced',
            }
        })
        markMapUnsaved()
    }, [markMapUnsaved])

    const updateCoastlineSimpleConfig = useCallback((patch: Partial<CoastlineSimpleConfig>) => {
        setCoastlineParams(current => {
            const nextConfig = {
                ...readCoastlineSimpleConfig(current),
                ...patch,
            }
            return buildSimpleCoastlineParams(nextConfig)
        })
        markMapUnsaved()
    }, [markMapUnsaved])

    const updateCoastlineAlgorithm = useCallback((algorithm: CoastlineAlgorithmChoice) => {
        setCoastlineParams(current => {
            const nextConfig = {
                ...readCoastlineSimpleConfig(current),
                algorithm,
            }
            if (current.uiMode === 'advanced') {
                // 高级模式只补丁算法字段，避免把高级覆盖值重置回档位默认。
                return {
                    ...current,
                    algorithm,
                    v2: algorithm === 'v2' ? buildCoastlineV2Params(nextConfig) : undefined,
                }
            }
            return buildSimpleCoastlineParams(nextConfig)
        })
        markMapUnsaved()
    }, [markMapUnsaved])

    // ── 添加图形/地点 ──────────────────────────────────────────────────

    const handleAddShape = useCallback(() => {
        const next = createEmptyShapeDraft(draft.shapes)
        setTerrainBrush(null)
        setDrawingShape(next)
        setSelectedShapeId(next.id)
        setSelectedLocationId(null)
    }, [draft.shapes])

    const handleFinishDrawingShape = useCallback(() => {
        if (!drawingShape || drawingShape.vertices.length < 3) {
            return
        }

        updateDraft(current => ({
            ...current,
            shapes: [...current.shapes, drawingShape],
        }))
        setDrawingShape(null)
        setSelectedShapeId(drawingShape.id)
        setSelectedLocationId(null)
    }, [drawingShape, updateDraft])

    const handleAddLocation = useCallback(() => {
        const relatedShape = draft.shapes.find(s => s.id === selectedShapeId) ?? draft.shapes[0] ?? null
        const cx = relatedShape
            ? relatedShape.vertices.reduce((sum, v) => sum + v.x, 0) / Math.max(relatedShape.vertices.length, 1)
            : activeCanvas.width / 2
        const cy = relatedShape
            ? relatedShape.vertices.reduce((sum, v) => sum + v.y, 0) / Math.max(relatedShape.vertices.length, 1)
            : activeCanvas.height / 2
        const loc: MapKeyLocationDraft = {
            id: createMapShapeEditorLocalId('loc'),
            name: `地点 ${draft.keyLocations.length + 1}`,
            markerClass: 'marker',
            x: cx,
            y: cy,
        }
        updateDraft(d => ({...d, keyLocations: [...d.keyLocations, loc]}))
        setTerrainBrush(null)
        setSelectedLocationId(loc.id)
    }, [activeCanvas, draft, selectedShapeId, updateDraft])

    // ── 场景与 Pixi 属性 ─────────────────────────────────────────────────

    const previewShapes = useMemo(() => buildPreviewShapes(draft.shapes), [draft.shapes])
    const previewKeyLocations = useMemo(
        () => buildPreviewKeyLocations(draft.keyLocations),
        [draft.keyLocations],
    )

    const baseScene = useMemo(() => {
        const base: MapPreviewScene = scene ?? {
            canvas: activeCanvas,
            shapes: previewShapes,
            keyLocations: previewKeyLocations,
            terrainStrokes: draft.terrainStrokes ?? [],
        }

        const result = {
            ...base,
            // 地点始终即时更新；地形则在编辑态显示草稿语义，预览态只显示上次生成快照。
            keyLocations: previewKeyLocations,
            terrainStrokes: resolveTerrainStrokesForViewport(
                viewportMode,
                draft.terrainStrokes,
                scene?.terrainStrokes,
            ),
        }
        mapLog(`baseScene: shapes=${result.shapes?.length ?? 0} keyLocations=${result.keyLocations?.length ?? 0} hasBg=${!!result.backgroundImage} viewportMode=${viewportMode}`)
        return result
    }, [activeCanvas, scene, previewShapes, previewKeyLocations, draft.terrainStrokes, viewportMode])

    const pixiStyle = useMemo(() => {
        const preset = getPixiMapStyle(style)
        const def = backgroundImageUrl
            ? {
                ...preset,
                background: {
                    kind: 'image' as const,
                    url: backgroundImageUrl,
                    color: preset.palette.ocean,
                    opacity: 1,
                    fit: 'cover' as const,
                },
            }
            : preset
        if (!backgroundImageUrl) {
            mapLog(`pixiStyle: style=${style} bg=none keys=${Object.keys(def).join(',')}`)
        } else {
            mapLog(`pixiStyle: style=${style} bg=image(${backgroundImageUrl.slice(0, 40)}) keys=${Object.keys(def).join(',')}`)
        }

        if (viewportMode !== 'edit') return def

        // 编辑模式只显示固定语义色，不运行各风格自己的地形方案。
        return {
            ...def,
            decorations: [
                ...(def.decorations ?? []).filter(item => item.id !== 'terrain'),
                {
                    id: 'terrain' as const,
                    params: {
                        terrainKinds: Object.fromEntries(MAP_TERRAIN_KIND_OPTIONS.map(option => [
                            option.value,
                            {color: option.color},
                        ])),
                    },
                },
            ],
        }
    }, [style, backgroundImageUrl, viewportMode])

    const compiledPixiStyle = useMemo(() => {
        const result = compilePixiMapStyle({style: pixiStyle, canvas: activeCanvas, scene: baseScene})
        mapLog(`compiledPixiStyle: shapes=${result.scene?.shapes?.length ?? 0} keyLocations=${result.scene?.keyLocations?.length ?? 0} pixiProps=${JSON.stringify(result.pixiProps).slice(0, 120)}`)
        return result
    }, [activeCanvas, pixiStyle, baseScene])

    const renderedScene = compiledPixiStyle.scene
    const entryOptionById = useMemo(
        () => new Map(entryOptions.map(entry => [entry.id, entry])),
        [entryOptions],
    )
    const getLinkedEntryTooltip = useCallback((detail: MapPreviewPickDetail) => {
        if (detail.kind !== 'keyLocation') return undefined
        const entry = entryOptionById.get(readLinkedEntryId(detail.object))
        if (!entry) return undefined
        return {
            text: [
                `词条：${entry.title}`,
                entry.type ? `类型：${entry.type}` : '',
                entry.summary?.trim() ?? '',
            ].filter(Boolean).join('\n'),
            className: 'wm-linked-entry-tooltip',
        }
    }, [entryOptionById])

    const pixiProps = compiledPixiStyle.pixiProps
    const viewportShapeStyle = compiledPixiStyle.shapeStyle
    const viewportKeyLocationStyle = compiledPixiStyle.keyLocationStyle
    const viewportLabelStyle = compiledPixiStyle.labelStyle
    const pixiPerfDebugEnabled = useMemo(() => isPixiPerfDebugEnabled(), [])

    // DEBUG：包装 renderOverlay 以追踪 MapShapeViewport 是否实际调用了它
    const wrappedPixiProps = useMemo(() => {
        const pixiPropsWithLod = {
            ...pixiProps,
            lodLevel: pixiLodLevel,
            getTooltip: getLinkedEntryTooltip,
        }
        const originalOnPerfStats = pixiPropsWithLod.onPerfStats
        const basePixiProps = pixiPerfDebugEnabled
            ? {
                ...pixiPropsWithLod,
                debugPerf: true,
                onPerfStats: (stats: MapPixiPerfStats) => {
                    originalOnPerfStats?.(stats)
                    logPixiPerfStats(stats)
                },
            }
            : pixiPropsWithLod

        // 非调试态直接用原始 renderOverlay，跳过纯用于日志追踪的包装
        //（避免每次渲染多一层间接调用与模板字符串构造）。
        if (!isMapDebugLogEnabled()) {
            return basePixiProps
        }

        if (!basePixiProps.renderOverlay) {
            mapLog('wrapRenderOverlay: no renderOverlay to wrap')
            return basePixiProps
        }
        const original = basePixiProps.renderOverlay
        mapLog('wrapRenderOverlay: wrapping renderOverlay')
        return {
            ...basePixiProps,
            renderOverlay: (ctx: Parameters<typeof original>[0]) => {
                mapLog('wrapRenderOverlay: CALLED')
                const result = original(ctx)
                mapLog(`wrapRenderOverlay: RETURNED type=${typeof result} isNull=${result === null}`)
                return result
            }
        }
    }, [getLinkedEntryTooltip, pixiLodLevel, pixiProps, pixiPerfDebugEnabled])

    const viewportRenderKey = `${viewportMode}-${style}-${activeCanvas.width}x${activeCanvas.height}-${backgroundImageUrl ? 'custom-bg' : 'style-bg'}`

    useEffect(() => {
        const mspLog = {
            mode: viewportMode,
            sceneShapes: renderedScene?.shapes?.length ?? 0,
            sceneKeyLocs: renderedScene?.keyLocations?.length ?? 0,
            sceneHasBg: !!renderedScene?.backgroundImage,
            pixiPropsKeys: pixiProps ? Object.keys(pixiProps) : 'null',
            pixiPropsShowLabels: pixiProps?.showLabels,
            pixiPropsRenderOverlay: !!pixiProps?.renderOverlay,
            pixiPropsKeyLocationRenderMode: pixiProps?.keyLocationRenderMode,
            shapeStyle: viewportShapeStyle,
            keyLocationStyle: viewportKeyLocationStyle,
            labelStyle: viewportLabelStyle,
        }
        mapLog(`renderEffect: ${JSON.stringify(mspLog)}`)
    }, [viewportRenderKey, style, viewportMode, renderedScene, pixiProps, viewportShapeStyle, viewportKeyLocationStyle, viewportLabelStyle])

    const svgProps = useMemo(() => ({
        draft,
        selectedShapeId,
        selectedLocationId,
        drawingShape,
        terrainBrush,
        invalidShapeIds: [] as string[],
        invalidKeyLocationIds: [] as string[],
        onDraftChange: updateDraft,
        onSelectedShapeChange: (id: string | null) => {
            setSelectedShapeId(id);
            if (id) setSelectedLocationId(null)
        },
        onSelectedLocationChange: (id: string | null) => {
            setSelectedLocationId(id);
            if (id) setSelectedShapeId(null)
        },
        onDrawingShapeChange: setDrawingShape,
        onRequestShapeDelete: requestDeleteShape,
        onRequestVertexDelete: deleteVertex,
        onRequestLocationDelete: requestDeleteLocation,
        onShapeContextMenu: handleShapeContextMenu,
        onVertexContextMenu: handleVertexContextMenu,
        onLocationContextMenu: handleLocationContextMenu,
    }), [draft, selectedShapeId, selectedLocationId, drawingShape, terrainBrush, requestDeleteShape, deleteVertex, requestDeleteLocation, handleShapeContextMenu, handleVertexContextMenu, handleLocationContextMenu, updateDraft])

    // ── 派生数据 ───────────────────────────────────────────────────────────────

    const selectedShape = draft.shapes.find(s => s.id === selectedShapeId) ?? null
    const selectedLocation = draft.keyLocations.find(l => l.id === selectedLocationId) ?? null
    const selectedMarkerClass = selectedLocation?.markerClass ?? null
    const markerClassOptions = useMemo(() => {
        const pixiStyle = getPixiMapStyle(style)
        return MAP_MARKER_CLASS_OPTIONS.map(option => {
            const asset = pixiStyle.locations.markerAssets?.[option.value]
            const iconSet = asset?.iconSet ?? pixiStyle.locations.iconSet
            const icon = iconSet ? buildPixiLocationIconAsset({
                iconSet,
                asset: asset?.asset ?? option.value,
                color: asset?.color ?? pixiStyle.locations.marker.color,
            }) : undefined
            return {...option, iconUrl: icon?.url}
        })
    }, [style])
    const selectedLinkedEntryId = readLinkedEntryId(selectedLocation)
    const selectedLinkedEntry = entryOptionById.get(selectedLinkedEntryId) ?? null
    const linkedEntryOptions = useMemo(() => [
        {value: '', label: '未关联'},
        ...entryOptions.map(entry => ({value: entry.id, label: entry.title})),
    ], [entryOptions])

    const saveStatusLabel = useMemo(() => {
        if (saveStatus === 'saving') return '保存中…'
        if (saveStatus === 'saved') return '已保存'
        if (saveStatus === 'error') return '保存失败'
        if (hasUnsavedChanges) return '未保存'
        const active = maps.find(m => m.id === activeMapId)
        if (active?.updatedAt) {
            const d = new Date(active.updatedAt)
            if (!Number.isNaN(d.getTime())) {
                return `上次保存 ${new Intl.DateTimeFormat('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(d)}`
            }
        }
        return '未保存'
    }, [saveStatus, hasUnsavedChanges, maps, activeMapId])

    const coastlineMode = coastlineParams.uiMode === 'advanced' ? 'advanced' : 'simple'
    const coastlineSimpleConfig = readCoastlineSimpleConfig(coastlineParams)
    const activeQuality = COASTLINE_QUALITY_PRESETS[coastlineSimpleConfig.qualityPreset]
    const coastlineParamFields = (
        <div className="wm-coastline-fields">
            <div className="wm-coastline-mode">
                <div className="wm-segmented">
                    {(['simple', 'advanced'] as CoastlineParamMode[]).map(mode => (
                        <button
                            key={mode}
                            type="button"
                            className={`wm-segmented__item${coastlineMode === mode ? ' is-active' : ''}`}
                            onClick={() => updateCoastlineMode(mode)}
                        >
                            {mode === 'simple' ? '简单' : '高级'}
                        </button>
                    ))}
                </div>
            </div>
            <div className="wm-field">
                <label>算法引擎</label>
                <div className="wm-segmented">
                    {(['v1', 'v2'] as CoastlineAlgorithmChoice[]).map(algorithm => (
                        <button
                            key={algorithm}
                            type="button"
                            className={`wm-segmented__item${coastlineSimpleConfig.algorithm === algorithm ? ' is-active' : ''}`}
                            onClick={() => updateCoastlineAlgorithm(algorithm)}
                        >
                            {COASTLINE_ALGORITHM_LABELS[algorithm]}
                        </button>
                    ))}
                </div>
                <div className="wm-sidebar-hint">{COASTLINE_ALGORITHM_HINTS[coastlineSimpleConfig.algorithm]}</div>
            </div>
            {coastlineMode === 'simple' ? (
                <>
                    <div className="wm-field">
                        <label>细化程度</label>
                        <div className="wm-coastline-quality-grid">
                            {(Object.keys(COASTLINE_QUALITY_PRESETS) as CoastlineQualityPreset[]).map(preset => (
                                <button
                                    key={preset}
                                    type="button"
                                    className={`wm-chip${coastlineSimpleConfig.qualityPreset === preset ? ' is-active' : ''}`}
                                    onClick={() => updateCoastlineSimpleConfig({qualityPreset: preset})}
                                >
                                    {COASTLINE_QUALITY_PRESETS[preset].label}
                                </button>
                            ))}
                        </div>
                        <div className="wm-sidebar-hint">{activeQuality.hint}</div>
                    </div>
                    <div className="wm-range-field">
                        <label>尺度系数 <span>{coastlineSimpleConfig.scaleFactor.toFixed(2)}</span></label>
                        <Slider
                            min={0.2}
                            max={3}
                            step={0.05}
                            value={coastlineSimpleConfig.scaleFactor}
                            tooltip
                            onValueChange={value => updateCoastlineSimpleConfig({scaleFactor: readSliderNumber(value)})}
                        />
                    </div>
                    <div className="wm-range-field">
                        <label>大尺度扰动 <span>{coastlineSimpleConfig.macroNoise.toFixed(2)}</span></label>
                        <Slider
                            min={0}
                            max={2}
                            step={0.05}
                            value={coastlineSimpleConfig.macroNoise}
                            tooltip
                            onValueChange={value => updateCoastlineSimpleConfig({macroNoise: readSliderNumber(value)})}
                        />
                    </div>
                    <div className="wm-range-field">
                        <label>中尺度扰动 <span>{coastlineSimpleConfig.midNoise.toFixed(2)}</span></label>
                        <Slider
                            min={0}
                            max={2}
                            step={0.05}
                            value={coastlineSimpleConfig.midNoise}
                            tooltip
                            onValueChange={value => updateCoastlineSimpleConfig({midNoise: readSliderNumber(value)})}
                        />
                    </div>
                    <div className="wm-range-field">
                        <label>细节扰动 <span>{coastlineSimpleConfig.microNoise.toFixed(2)}</span></label>
                        <Slider
                            min={0}
                            max={2}
                            step={0.05}
                            value={coastlineSimpleConfig.microNoise}
                            tooltip
                            onValueChange={value => updateCoastlineSimpleConfig({microNoise: readSliderNumber(value)})}
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className="wm-field">
                        <label>最小段数</label>
                        <input
                            type="number"
                            step={1}
                            value={coastlineParams.minSegments ?? ''}
                            onChange={e => updateCoastlineParam('minSegments', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>最大段数</label>
                        <input
                            type="number"
                            step={1}
                            value={coastlineParams.maxSegments ?? ''}
                            onChange={e => updateCoastlineParam('maxSegments', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>细分基础</label>
                        <input
                            type="number"
                            step={1}
                            value={coastlineParams.segmentBase ?? ''}
                            onChange={e => updateCoastlineParam('segmentBase', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>长度因子</label>
                        <input
                            type="number"
                            step={1}
                            value={coastlineParams.segmentLengthFactor ?? ''}
                            onChange={e => updateCoastlineParam('segmentLengthFactor', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>长边因子</label>
                        <input
                            type="number"
                            step={1}
                            value={coastlineParams.segmentEdgeRatioFactor ?? ''}
                            onChange={e => updateCoastlineParam('segmentEdgeRatioFactor', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>振幅基础</label>
                        <input
                            type="number"
                            step={0.1}
                            value={coastlineParams.amplitudeBase ?? ''}
                            onChange={e => updateCoastlineParam('amplitudeBase', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>振幅最小</label>
                        <input
                            type="number"
                            step={0.5}
                            value={coastlineParams.amplitudeMin ?? ''}
                            onChange={e => updateCoastlineParam('amplitudeMin', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>振幅上限比例</label>
                        <input
                            type="number"
                            step={0.001}
                            value={coastlineParams.amplitudeCanvasRatioMax ?? ''}
                            onChange={e => updateCoastlineParam('amplitudeCanvasRatioMax', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>平滑轮数</label>
                        <input
                            type="number"
                            step={1}
                            min={0}
                            value={coastlineParams.relaxPasses ?? ''}
                            onChange={e => updateCoastlineParam('relaxPasses', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>平滑权重</label>
                        <input
                            type="number"
                            step={0.01}
                            min={0}
                            max={0.5}
                            value={coastlineParams.relaxWeight ?? ''}
                            onChange={e => updateCoastlineParam('relaxWeight', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave A 权重</label>
                        <input
                            type="number"
                            step={0.01}
                            value={coastlineParams.waveAWeight ?? ''}
                            onChange={e => updateCoastlineParam('waveAWeight', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave A 强度</label>
                        <input
                            type="number"
                            step={0.05}
                            value={coastlineParams.waveAStrength ?? ''}
                            onChange={e => updateCoastlineParam('waveAStrength', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave B 权重</label>
                        <input
                            type="number"
                            step={0.01}
                            value={coastlineParams.waveBWeight ?? ''}
                            onChange={e => updateCoastlineParam('waveBWeight', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave B 强度</label>
                        <input
                            type="number"
                            step={0.05}
                            value={coastlineParams.waveBStrength ?? ''}
                            onChange={e => updateCoastlineParam('waveBStrength', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave C 权重</label>
                        <input
                            type="number"
                            step={0.01}
                            value={coastlineParams.waveCWeight ?? ''}
                            onChange={e => updateCoastlineParam('waveCWeight', e.target.value)}
                        />
                    </div>
                    <div className="wm-field">
                        <label>Wave C 强度</label>
                        <input
                            type="number"
                            step={0.05}
                            value={coastlineParams.waveCStrength ?? ''}
                            onChange={e => updateCoastlineParam('waveCStrength', e.target.value)}
                        />
                    </div>
                </>
            )}
            <div className="wm-sidebar-hints">
                <div className="wm-sidebar-hint">细化程度主要决定生成时间和最终点数。</div>
                <div className="wm-sidebar-hint">尺度系数控制海岸线偏离原始边界的幅度。</div>
                <div className="wm-sidebar-hint">三层扰动现在会映射到后端 Wave 强度；高级模式可直接编辑原始参数。</div>
            </div>
        </div>
    )

    if (isLoading) {
        return <div className="wm-panel">
            <div className="wm-loading">加载地图中…</div>
        </div>
    }

    // ── 渲染 ────────────────────────────────────────────────────────────────

    const renderMapSidebarInExternalContainer = Boolean(sidebarContainer)
    const mapListSection = (
        <div className="wm-sidebar__section wm-map-list-panel">
            <div className="wm-sidebar__section-header">
                <span className="wm-sidebar__section-title">地图列表</span>
                <button type="button" className="wm-icon-btn" onClick={() => void handleCreateMap()}
                        title="新建地图">
                    <PlusIcon/>
                </button>
            </div>
            <div className="wm-map-list">
                {maps.length === 0 && (
                    <div className="wm-map-list__empty">暂无地图，点击 + 新建</div>
                )}
                {maps.map(m => (
                    <div key={m.id}
                         className={`wm-map-item${m.id === activeMapId ? ' is-active' : ''}`}
                         onClick={() => void handleSwitchMap(m)}
                    >
                        <span className="wm-map-item__name">{m.name}</span>
                        <button
                            type="button"
                            className="wm-map-item__delete"
                            title="删除此地图"
                            onClick={e => {
                                e.stopPropagation();
                                void handleDeleteMap(m.id)
                            }}
                        >
                            <TrashIcon/>
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )

    const mapSidebar = (
        <div className={`wm-sidebar${renderMapSidebarInExternalContainer ? ' wm-sidebar--external' : ''}`}>
            {mapListSection}
            <div className="wm-sidebar__sep"/>

            {/* 属性区域 */}
            <div className="wm-sidebar__section wm-sidebar__section--flex">
                <div className="wm-sidebar__section-header">
                    <span className="wm-sidebar__section-title">
                        {drawingShape ? '绘制中图形' : selectedShape ? '图形属性' : selectedLocation ? '地点属性' : activeMapId ? '地图属性' : '操作提示'}
                    </span>
                </div>
                <RollingBox axis="y"
                    className="wm-sidebar__body"
                    thumbSize="thin"
                    interceptWheel={(event) => {
                        event.stopPropagation()
                        return false
                    }}
                >
                    {/* 当前地图名称 */}
                    {activeMapId && !drawingShape && !selectedShape && (!selectedLocation || viewportMode === 'preview') && (
                        <>
                            <div className="wm-field">
                                <label>地图名称</label>
                                <input value={activeMapName} onChange={e => handleRename(e.target.value)}/>
                            </div>
                            <div className="wm-meta-row">
                                <span>地图大小</span><strong>{activeCanvas.width} × {activeCanvas.height}</strong>
                            </div>
                            <div className="wm-meta-row">
                                <span>图形 / 地点</span><strong>{draft.shapes.length} / {draft.keyLocations.length}</strong>
                            </div>
                            {draft.shapes.length === 0 && draft.keyLocations.length === 0 && (
                                <div className="wm-sidebar-hints">
                                    <div className="wm-sidebar-hint">切换到编辑模式后，可绘制区域、添加地点或上传底图。</div>
                                </div>
                            )}
                            {!validation.isValid && (
                                <div className="wm-sidebar-hint wm-sidebar-hint--error">
                                    当前草稿还没通过校验，完善图形或地点后才能生成地图。
                                </div>
                            )}
                        </>
                    )}
                    {!activeMapId && (
                        <div className="wm-sidebar-hints">
                            <div className="wm-sidebar-hint">点击上方 + 新建第一张地图</div>
                        </div>
                    )}

                    {/* 绘制中的图形编辑器 */}
                    {drawingShape && (
                        <>
                            <div className="wm-field">
                                <label>名称</label>
                                <input value={drawingShape.name ?? ''}
                                       onChange={e => updateDrawingShapeField('name', e.target.value)}/>
                            </div>
                            <div className="wm-field">
                                <label>填充色</label>
                                <div className="wm-color-row">
                                    <span className="wm-color-swatch"
                                          style={{background: drawingShape.fill ?? 'var(--fc-color-border)'}}/>
                                    <input value={drawingShape.fill ?? ''} placeholder="#cccccc"
                                           onChange={e => updateDrawingShapeField('fill', e.target.value)}/>
                                </div>
                            </div>
                            <div className="wm-field">
                                <label>描边色</label>
                                <div className="wm-color-row">
                                    <span className="wm-color-swatch"
                                          style={{background: drawingShape.stroke ?? 'var(--fc-color-text-tertiary)'}}/>
                                    <input value={drawingShape.stroke ?? ''} placeholder="#888888"
                                           onChange={e => updateDrawingShapeField('stroke', e.target.value)}/>
                                </div>
                            </div>
                            <div className="wm-meta-row">
                                <span>已落点</span><strong>{drawingShape.vertices.length}</strong>
                            </div>
                            <div className="wm-sidebar-sep"/>
                            <button type="button" className="wm-chip is-active is-full"
                                    onClick={handleFinishDrawingShape}
                                    disabled={drawingShape.vertices.length < 3}>完成图形
                            </button>
                            <button type="button" className="wm-chip is-full"
                                    onClick={() => setDrawingShape(null)}>取消绘制
                            </button>
                        </>
                    )}

                    {/* 已选图形编辑器 */}
                    {!drawingShape && selectedShape && viewportMode === 'edit' && (
                        <>
                            <div className="wm-field">
                                <label>名称</label>
                                <input value={selectedShape.name ?? ''}
                                       onChange={e => updateSelectedShape('name', e.target.value)}/>
                            </div>
                            <div className="wm-field">
                                <label>填充色</label>
                                <div className="wm-color-row">
                                    <span className="wm-color-swatch"
                                          style={{background: selectedShape.fill ?? 'var(--fc-color-border)'}}/>
                                    <input value={selectedShape.fill ?? ''} placeholder="#cccccc"
                                           onChange={e => updateSelectedShape('fill', e.target.value)}/>
                                </div>
                            </div>
                            <div className="wm-field">
                                <label>描边色</label>
                                <div className="wm-color-row">
                                    <span className="wm-color-swatch"
                                          style={{background: selectedShape.stroke ?? 'var(--fc-color-text-tertiary)'}}/>
                                    <input value={selectedShape.stroke ?? ''} placeholder="#888888"
                                           onChange={e => updateSelectedShape('stroke', e.target.value)}/>
                                </div>
                            </div>
                            <div className="wm-meta-row">
                                <span>顶点数</span><strong>{selectedShape.vertices.length}</strong>
                            </div>
                            <div className="wm-sidebar-sep"/>
                            <button type="button" className="wm-chip is-danger is-full"
                                    onClick={() => void requestDeleteShape(selectedShape.id)}>删除图形
                            </button>
                        </>
                    )}

                    {/* 已选地点编辑器 */}
                    {!drawingShape && !selectedShape && selectedLocation && viewportMode === 'edit' && (
                        <>
                            <div className="wm-field">
                                <label>名称</label>
                                <Input
                                    value={selectedLocation.name}
                                    onValueChange={updateSelectedLocation}
                                />
                            </div>
                            <div className="wm-field">
                                <label>显示元素</label>
                                <div className="wm-marker-grid" role="radiogroup" aria-label="显示元素">
                                    {markerClassOptions.map(option => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={selectedMarkerClass === option.value}
                                            className={`wm-marker-option${selectedMarkerClass === option.value ? ' is-active' : ''}`}
                                            onClick={() => updateSelectedLocationMarkerClass(option.value)}
                                            title={option.label}
                                        >
                                            {option.iconUrl && (
                                                <img src={option.iconUrl} alt="" draggable={false}/>
                                            )}
                                            <span>{option.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="wm-field">
                                <label>关联词条</label>
                                <Select
                                    options={linkedEntryOptions}
                                    value={selectedLinkedEntryId}
                                    onValueChange={value => updateSelectedLocationLinkedEntryId(
                                        typeof value === 'string' && value ? value : null,
                                    )}
                                    searchable={entryOptions.length > 0}
                                    disabled={entryOptions.length === 0}
                                />
                            </div>
                            {entryOptions.length === 0 && (
                                <div className="wm-sidebar-hint">
                                    当前项目还没有类型为 location 的词条，暂时无法关联地点。
                                </div>
                            )}
                            {selectedLinkedEntry && (
                                <div className="wm-sidebar-actions">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onOpenEntry?.({
                                            id: selectedLinkedEntry.id,
                                            title: selectedLinkedEntry.title
                                        })}
                                    >
                                        打开词条
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => updateSelectedLocationLinkedEntryId(null)}
                                    >
                                        清除关联
                                    </Button>
                                </div>
                            )}
                            <div className="wm-meta-row">
                                <span>坐标</span>
                                <strong>{selectedLocation.x.toFixed(1)} / {selectedLocation.y.toFixed(1)}</strong>
                            </div>
                            <div className="wm-sidebar-sep"/>
                            <Button
                                size="sm"
                                variant="danger"
                                block
                                onClick={() => void requestDeleteLocation(selectedLocation.id)}
                            >
                                删除地点
                            </Button>
                        </>
                    )}
                </RollingBox>
            </div>
        </div>
    )

    return (
        <div className="wm-panel">
            {renderMapSidebarInExternalContainer && sidebarContainer ? createPortal(mapSidebar, sidebarContainer) : null}

            {/* 隐藏的文件输入框 */}
            <input ref={imageInputRef} type="file" accept="image/*" style={{display: 'none'}}
                   onChange={handleImageFileChange}/>

            {newMapForm && (
        <FloatingPanel
            open
            onClose={() => setNewMapForm(null)}
            title="新建地图"
            className="wm-create-map-dialog"
            ariaLabel="新建地图"
        >
            <div className="wm-create-map-dialog__body">
                            <div className="wm-field">
                                <label>地图名称</label>
                                <input
                                    value={newMapForm.name}
                                    onChange={event => setNewMapForm(current => current ? {
                                        ...current,
                                        name: event.target.value,
                                    } : current)}
                                    autoFocus
                                />
                            </div>
                            <div className="wm-field">
                                <label>地图大小</label>
                                <select value={newMapForm.presetId} onChange={event => handleNewMapPresetChange(event.target.value)}>
                                    {MAP_SIZE_PRESETS.map(preset => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.label}（{preset.width} × {preset.height}）
                                        </option>
                                    ))}
                                    <option value="custom">自定义</option>
                                </select>
                            </div>
                            <div className="wm-create-map-dialog__size-row">
                                <div className="wm-field">
                                    <label>宽度</label>
                                    <input
                                        type="number"
                                        min={200}
                                        step={50}
                                        value={newMapForm.width}
                                        onChange={event => setNewMapForm(current => current ? {
                                            ...current,
                                            presetId: 'custom',
                                            width: event.target.value,
                                        } : current)}
                                    />
                                </div>
                                <div className="wm-field">
                                    <label>高度</label>
                                    <input
                                        type="number"
                                        min={200}
                                        step={50}
                                        value={newMapForm.height}
                                        onChange={event => setNewMapForm(current => current ? {
                                            ...current,
                                            presetId: 'custom',
                                            height: event.target.value,
                                        } : current)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="wm-create-map-dialog__footer">
                            <Button type="button" size="sm" radius="full" variant="outline" onClick={() => setNewMapForm(null)}>
                                取消
                            </Button>
                            <Button type="button" size="sm" radius="full" onClick={() => void handleSubmitCreateMap()}>
                                创建地图
                            </Button>
                        </div>
                </FloatingPanel>
            )}

            {utilityPanel && (
        <FloatingPanel
            open
            onClose={() => setUtilityPanel(null)}
            title={utilityPanel === 'help' ? '操作说明' : '海岸线生成参数'}
            className={`wm-utility-dialog${utilityPanel === 'coastline' ? ' wm-utility-dialog--wide' : ''}`}
            ariaLabel={utilityPanel === 'help' ? '操作说明' : '海岸线生成参数'}
        >
            {utilityPanel === 'help' ? (
                        <div className="wm-sidebar-hints">
                            <div className="wm-sidebar-hint">点击「绘制图形」在画布上逐点绘制区域。</div>
                            <div className="wm-sidebar-hint">双击画布或点击侧栏「完成图形」结束绘制。</div>
                            <div className="wm-sidebar-hint">编辑模式显示地形语义色，「生成地图」会更新海岸线与风格化地形。</div>
                            <div className="wm-sidebar-hint">右键图形、顶点或地点可打开对应操作菜单。</div>
                            <div className="wm-sidebar-hint">地图引擎和尺寸在创建时确定，创建后不在运行时切换。</div>
                        </div>
                    ) : (
                        <>
                            {coastlineParamFields}
                            <div className="wm-create-map-dialog__footer">
                                <Button
                                    type="button"
                                    size="sm"
                                    radius="full"
                                    variant="outline"
                                    onClick={() => {
                                        setCoastlineParams(DEFAULT_COASTLINE_PARAMS)
                                        markMapUnsaved()
                                    }}
                                >
                                    恢复默认
                                </Button>
                                <Button type="button" size="sm" radius="full" onClick={() => setUtilityPanel(null)}>
                                    完成
                                </Button>
                            </div>
                        </>
                    )}
                </FloatingPanel>
            )}

            {/* ── 顶部导航栏 ── */}
            <div className="wm-header">
                <div className="wm-header__title-block fc-page-title-block">
                    <h2 className="wm-title">世界地图</h2>
                </div>
                <div className="wm-style-switcher">
                    {(['flat', 'tolkien', 'ink'] as MapStyle[]).map(s => (
                        <button key={s} type="button"
                                className={`wm-style-btn${style === s ? ' is-active' : ''}`}
                                onClick={() => handleStyleChange(s)}>{MAP_STYLE_LABELS[s]}</button>
                    ))}
                </div>
                <div className="wm-header-actions">
                    {sceneDirty && <span className="wm-save-status">地图待生成</span>}
                    <span className={`wm-save-status${saveStatus !== 'idle' ? ` is-${saveStatus}` : ''}`}>
                        {saveStatusLabel}
                    </span>
                    <button type="button" className="wm-chip"
                            onClick={() => void handleSave()}
                            disabled={saveStatus === 'saving' || isGenerating || !activeMapId}>
                        保存地图
                    </button>
                </div>
            </div>

            {/* ── 工具栏 ── */}
            <div className="wm-toolbar">
                <button type="button"
                        className={`wm-chip${viewportMode === 'preview' ? ' is-active' : ''}`}
                        onClick={() => void handleToggleViewportMode()}
                        disabled={isGenerating || saveStatus === 'saving'}>
                    {viewportMode === 'edit' ? '切换预览' : '切换编辑'}
                </button>
                <div className="wm-toolbar-sep"/>
                <button type="button" className="wm-chip" onClick={() => setUtilityPanel('help')}>
                    操作说明
                </button>
                <label className="wm-toolbar-select">
                    <span>LOD</span>
                    <select
                        value={pixiLodLevel}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                            setPixiLodLevel(event.target.value as MapPixiLodSetting)
                        }}
                    >
                        {(Object.keys(PIXI_LOD_LABELS) as MapPixiLodSetting[]).map(level => (
                            <option key={level} value={level}>{PIXI_LOD_LABELS[level]}</option>
                        ))}
                    </select>
                </label>
                {viewportMode === 'edit' && (
                    <>
                        <div className="wm-toolbar-sep"/>
                        <button type="button"
                                className={`wm-chip${drawingShape ? ' is-active' : ''}`}
                                onClick={drawingShape ? () => setDrawingShape(null) : handleAddShape}
                                disabled={!activeMapId}>
                            {drawingShape ? '取消绘制' : '绘制图形'}
                        </button>
                        <button type="button" className="wm-chip" onClick={handleAddLocation} disabled={!activeMapId}>
                            新增地点
                        </button>
                        <button
                            type="button"
                            className={`wm-chip${terrainBrush ? ' is-active' : ''}`}
                            title="地形笔刷"
                            aria-pressed={Boolean(terrainBrush)}
                            onClick={() => {
                                setDrawingShape(null)
                                setSelectedShapeId(null)
                                setSelectedLocationId(null)
                                setTerrainBrush(current => current ? null : {...DEFAULT_TERRAIN_BRUSH})
                            }}
                            disabled={!activeMapId}
                        >
                            地形笔刷
                        </button>
                        {terrainBrush && (
                            <div className="wm-terrain-tools">
                                <div className="wm-terrain-kinds" role="group" aria-label="地形类型">
                                    {TERRAIN_KIND_OPTIONS.map(option => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`wm-terrain-kind${terrainBrush.kind === option.value ? ' is-active' : ''}`}
                                            title={option.label}
                                            aria-label={option.label}
                                            aria-pressed={terrainBrush.kind === option.value}
                                            onClick={() => setTerrainBrush(current => current
                                                ? {...current, kind: option.value}
                                                : current)}
                                        >
                                            <span
                                                className="wm-terrain-kind__swatch"
                                                style={{'--wm-terrain-color': option.color} as CSSProperties}
                                            />
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="wm-terrain-modes" role="group" aria-label="笔刷模式">
                                    <button
                                        type="button"
                                        className={terrainBrush.mode === 'paint' ? 'is-active' : ''}
                                        aria-pressed={terrainBrush.mode === 'paint'}
                                        onClick={() => setTerrainBrush(current => current
                                            ? {...current, mode: 'paint'}
                                            : current)}
                                    >画</button>
                                    <button
                                        type="button"
                                        className={terrainBrush.mode === 'erase' ? 'is-active' : ''}
                                        aria-pressed={terrainBrush.mode === 'erase'}
                                        onClick={() => setTerrainBrush(current => current
                                            ? {...current, mode: 'erase'}
                                            : current)}
                                    >擦</button>
                                </div>
                                <div className="wm-terrain-modes" role="group" aria-label="笔刷形状">
                                    <button
                                        type="button"
                                        className={terrainBrush.shape === 'round' ? 'is-active' : ''}
                                        aria-pressed={terrainBrush.shape === 'round'}
                                        onClick={() => setTerrainBrush(current => current
                                            ? {...current, shape: 'round'}
                                            : current)}
                                    >圆</button>
                                    <button
                                        type="button"
                                        className={terrainBrush.shape === 'square' ? 'is-active' : ''}
                                        aria-pressed={terrainBrush.shape === 'square'}
                                        onClick={() => setTerrainBrush(current => current
                                            ? {...current, shape: 'square'}
                                            : current)}
                                    >方</button>
                                </div>
                                <label className="wm-terrain-radius">
                                    <span>半径 {Math.round(terrainBrush.radius)}</span>
                                    <Slider
                                        min={12}
                                        max={120}
                                        step={4}
                                        value={terrainBrush.radius}
                                        tooltip
                                        onValueChange={value => setTerrainBrush(current => current
                                            ? {...current, radius: readSliderNumber(value)}
                                            : current)}
                                    />
                                </label>
                                <button
                                    type="button"
                                    className="wm-chip"
                                    onClick={() => updateDraft(current => ({
                                        ...current,
                                        terrainStrokes: (current.terrainStrokes ?? []).slice(0, -1),
                                    }))}
                                    disabled={(draft.terrainStrokes?.length ?? 0) === 0}
                                >
                                    撤销末笔
                                </button>
                            </div>
                        )}
                        <div className="wm-toolbar-sep"/>
                        <button type="button" className="wm-chip"
                                onClick={() => imageInputRef.current?.click()} disabled={!activeMapId}>
                            <ImageIcon/>{backgroundImageUrl ? '更换底图' : '上传底图'}
                        </button>
                        {backgroundImageUrl && (
                            <button type="button" className="wm-chip is-danger" onClick={handleRemoveImage}>
                                移除底图
                            </button>
                        )}
                        <div className="wm-toolbar-sep"/>
                        <button type="button" className="wm-chip" onClick={() => setUtilityPanel('coastline')} disabled={!activeMapId}>
                            生成参数
                        </button>
                        <button type="button" className="wm-chip"
                                onClick={() => void handleGenerate()}
                                disabled={!activeMapId || isGenerating || !validation.isValid || draft.shapes.length === 0}>
                            {isGenerating ? '生成中…' : '生成地图'}
                        </button>
                    </>
                )}
            </div>

            {/* ── 错误提示 ── */}
            {errorMsg && (
                <div className="wm-error-banner fc-status-banner fc-status-banner--error">
                    {errorMsg}
                    <button
                        type="button"
                        className="wm-error-banner__close"
                        onClick={() => setErrorMsg(null)}
                        aria-label="关闭错误提示"
                    >
                        <CloseIcon size={16}/>
                    </button>
                </div>
            )}

            {/* ── 主体 ── */}
            <div className="wm-body">
                {!renderMapSidebarInExternalContainer && mapSidebar}

                {/* ── 视口 ── */}
                <div className="wm-viewport-container">
                    {activeMapId ? (
                        <MapShapeViewport
                            key={viewportRenderKey}
                            mode={viewportMode}
                            canvas={activeCanvas}
                            scene={renderedScene}
                            viewBox={viewBox}
                            onViewBoxChange={setViewBox}
                            shapeStyle={viewportShapeStyle}
                            keyLocationStyle={viewportKeyLocationStyle}
                            labelStyle={viewportLabelStyle}
                            svgProps={svgProps}
                            pixiProps={wrappedPixiProps}
                        />
                    ) : (
                        <div className="wm-viewport-empty">
                            点击侧边栏中的 + 新建第一张地图
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
