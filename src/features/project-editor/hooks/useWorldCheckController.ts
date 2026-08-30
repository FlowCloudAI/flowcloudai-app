/**
 * 设定检测的双端页面控制层。
 *
 * 负责插件与模型选择、检测任务、历史报告和报告讨论上下文；桌面与移动端只保留各自布局。
 */
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {
    ai_delete_world_check_report,
    ai_get_world_check_report_entry,
    ai_list_world_check_reports,
    db_get_entry,
    db_list_entries,
    type EntryBrief,
    type StoredWorldCheckReport,
    type WorldCheckFinding,
    type WorldCheckKind,
    type WorldCheckReport,
    type WorldCheckReportHistoryItem,
} from '../../../api'
import {logger} from '../../../shared/logger'
import type {ReportConversationContext} from '../../ai-chat/model/AiControllerTypes'
import {
    refreshAiPluginStore,
    useAiPluginStore,
} from '../../ai-chat/stores/aiPluginStore'
import {normalizeEntryLookupTitle} from '../../entries/lib/entryCommon'
import {
    cancelWorldCheckTask,
    closeWorldCheckTaskMonitor,
    openWorldCheckTaskMonitor,
    startWorldCheckTask,
    useWorldCheckTaskStore,
} from '../stores/worldCheckTaskStore'

export const WORLD_CHECK_KIND_OPTIONS: Array<{value: WorldCheckKind; label: string}> = [
    {value: 'contradiction', label: '矛盾检测'},
    {value: 'entry_alignment', label: '单词条契合度'},
    {value: 'publication_risk', label: '出版风险'},
]

export const WORLD_CHECK_KIND_DESCRIPTIONS: Record<WorldCheckKind, string> = {
    contradiction: '核对词条、关系与时间线中的冲突证据',
    entry_alignment: '评估指定词条与整体世界规则的匹配程度',
    publication_risk: '检查公开发布前的敏感、争议与合规风险',
}

export function worldCheckKindLabel(kind: WorldCheckKind): string {
    return WORLD_CHECK_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? '设定检测'
}

export function formatWorldCheckDateTime(value: string): string {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsed)
}

export function worldCheckSeverityLabel(severity: WorldCheckFinding['severity']): string {
    switch (severity) {
        case 'critical':
            return '严重'
        case 'high':
            return '高'
        case 'medium':
            return '中'
        default:
            return '低'
    }
}

export function worldCheckCategoryLabel(category: string | null | undefined): string {
    switch (category) {
        case 'timeline': return '时间线'
        case 'relationship': return '人物关系'
        case 'geography': return '地理空间'
        case 'ability': return '能力规则'
        case 'faction': return '阵营立场'
        case 'rule_mismatch': return '规则契合'
        case 'timeline_fit': return '时间契合'
        case 'relationship_context': return '关系上下文'
        case 'geography_fit': return '地理契合'
        case 'terminology': return '术语体系'
        case 'tone_style': return '风格语气'
        case 'missing_context': return '待补上下文'
        case 'copyright_similarity': return '版权相似'
        case 'trademark_brand': return '商标品牌'
        case 'real_person_org': return '现实指涉'
        case 'defamation_privacy': return '名誉隐私'
        case 'sensitive_content': return '敏感内容'
        case 'age_rating': return '分级风险'
        case 'legal_compliance': return '合规风险'
        case 'platform_policy': return '平台审核'
        default: return '其他'
    }
}

export function worldCheckReportStatus(report: WorldCheckReport, kind: WorldCheckKind): string {
    if (kind === 'entry_alignment' && typeof report.score === 'number') return `契合度 ${Math.round(report.score)}`
    if (kind === 'publication_risk' && typeof report.score === 'number') return `风险指数 ${Math.round(report.score)}`
    if (report.findings.some((finding) => finding.severity === 'critical')) return '高风险'
    if (report.findings.some((finding) => finding.severity === 'high')) return '需重点处理'
    if (report.findings.length > 0) return '存在问题'
    if (report.unresolvedQuestions.length > 0) return '待补证据'
    return '整体稳定'
}

export function buildWorldCheckConversationContext(record: StoredWorldCheckReport): ReportConversationContext {
    return {
        reportId: record.reportId,
        projectId: record.projectId,
        projectName: record.projectName,
        scopeSummary: record.scopeSummary,
        sourceEntryIds: record.sourceEntryIds,
        truncated: record.truncated,
        reportJson: JSON.stringify(record.report, null, 2),
    }
}

export interface WorldCheckDiscussionParams {
    title: string
    pluginId: string
    model: string
    reportContext: ReportConversationContext
}

interface UseWorldCheckControllerOptions {
    projectId: string
    projectName: string
    aiPluginId?: string | null
    aiModel?: string | null
    activeEntryId?: string | null
    activeEntryTitle?: string | null
    onStartDiscussion?: (params: WorldCheckDiscussionParams) => void | Promise<void>
    /**
     * 只使用生成表单：跳过历史列表与报告详情的拉取，生成表单直接处于打开态。
     * 移动端把「生成新报告」拆成了独立页面，那一页不需要历史数据。
     */
    formOnly?: boolean
    /** formOnly 下的初始检测类型。 */
    initialCheckKind?: WorldCheckKind
}

export function useWorldCheckController({
    projectId,
    projectName,
    aiPluginId = null,
    aiModel = null,
    activeEntryId = null,
    activeEntryTitle = null,
    onStartDiscussion,
    formOnly = false,
    initialCheckKind,
}: UseWorldCheckControllerOptions) {
    const {showAlert} = useAlert()
    const [checkKind, setCheckKind] = useState<WorldCheckKind>(initialCheckKind ?? 'contradiction')
    const [targetEntryId, setTargetEntryId] = useState('')
    const [targetEntryQuery, setTargetEntryQuery] = useState(activeEntryTitle ?? '')
    const [projectEntries, setProjectEntries] = useState<EntryBrief[]>([])
    const [entriesLoading, setEntriesLoading] = useState(false)
    const [localPluginId, setLocalPluginId] = useState<string | null>(null)
    const [localModel, setLocalModel] = useState<string | null>(null)
    const [historyItems, setHistoryItems] = useState<WorldCheckReportHistoryItem[]>([])
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
    const [activeRecord, setActiveRecord] = useState<StoredWorldCheckReport | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [generateDialogOpen, setGenerateDialogOpen] = useState(formOnly)
    const [entryTitleMap, setEntryTitleMap] = useState<Record<string, string>>({})
    const pluginState = useAiPluginStore()
    const {tasks: worldCheckTasks} = useWorldCheckTaskStore()
    const task = worldCheckTasks[projectId] ?? null
    const taskRunning = task?.status === 'running' || task?.status === 'cancelling'
    const effectivePluginId = localPluginId ?? aiPluginId ?? pluginState.selectedPlugin
    const effectiveModel = localModel ?? aiModel ?? pluginState.selectedModel
    const selectedPluginInfo = pluginState.plugins.find((plugin) => plugin.id === effectivePluginId) ?? null

    useEffect(() => {
        if (pluginState.pluginsReady) return
        refreshAiPluginStore().catch((error) => logger.warn('[WorldCheck] 获取插件列表失败', error))
    }, [pluginState.pluginsReady])

    const selectedTargetEntry = useMemo(
        () => projectEntries.find((entry) => entry.id === targetEntryId) ?? null,
        [projectEntries, targetEntryId],
    )
    const targetEntryOptions = useMemo(() => {
        const query = normalizeEntryLookupTitle(targetEntryQuery)
        const entries = query
            ? projectEntries.filter((entry) => normalizeEntryLookupTitle(entry.title).startsWith(query))
            : projectEntries
        return entries.slice(0, 3)
    }, [projectEntries, targetEntryQuery])

    useEffect(() => {
        if (checkKind === 'entry_alignment' && !targetEntryId && activeEntryId) {
            setTargetEntryId(activeEntryId)
            setTargetEntryQuery(activeEntryTitle ?? '')
        }
    }, [activeEntryId, activeEntryTitle, checkKind, targetEntryId])

    useEffect(() => {
        if (!generateDialogOpen || checkKind !== 'entry_alignment' || projectEntries.length > 0) return
        let cancelled = false
        setEntriesLoading(true)
        db_list_entries({projectId, limit: 1000, offset: 0})
            .then((entries) => {
                if (!cancelled) setProjectEntries(entries)
            })
            .catch(async (error) => {
                if (cancelled) return
                logger.error('加载词条候选失败', error)
                await showAlert(`加载词条候选失败：${String(error)}`, 'error', 'nonInvasive', 2400)
            })
            .finally(() => {
                if (!cancelled) setEntriesLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [checkKind, generateDialogOpen, projectEntries.length, projectId, showAlert])

    useEffect(() => setProjectEntries([]), [projectId])

    useEffect(() => {
        if (selectedTargetEntry && !targetEntryQuery.trim()) setTargetEntryQuery(selectedTargetEntry.title)
    }, [selectedTargetEntry, targetEntryQuery])

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true)
        try {
            const items = await ai_list_world_check_reports(projectId, null)
            setHistoryItems(items)
            setSelectedReportId((current) => current && items.some((item) => item.reportId === current)
                ? current
                : items[0]?.reportId ?? null)
            if (items.length === 0) setActiveRecord(null)
        } catch (error) {
            logger.error('加载设定检测历史失败', error)
            await showAlert(`加载设定检测历史失败：${String(error)}`, 'error', 'nonInvasive', 2600)
        } finally {
            setHistoryLoading(false)
        }
    }, [projectId, showAlert])

    useEffect(() => {
        if (formOnly) return
        void loadHistory()
    }, [formOnly, loadHistory])

    useEffect(() => {
        if (formOnly || task?.status !== 'success' || !task.record) return
        setSelectedReportId(task.record.reportId)
        setActiveRecord(task.record)
        void loadHistory()
    }, [formOnly, loadHistory, task?.record, task?.status])

    useEffect(() => {
        if (formOnly || !selectedReportId) return
        let cancelled = false
        setDetailLoading(true)
        ai_get_world_check_report_entry(selectedReportId)
            .then((record) => {
                if (!cancelled) setActiveRecord(record)
            })
            .catch(async (error) => {
                if (cancelled) return
                logger.error('加载设定检测报告失败', error)
                await showAlert(`加载报告失败：${String(error)}`, 'error', 'nonInvasive', 2600)
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [formOnly, selectedReportId, showAlert])

    const selectPlugin = useCallback((pluginId: string) => {
        setLocalPluginId(pluginId)
        setLocalModel(null)
    }, [])

    const selectTargetEntry = useCallback((entry: EntryBrief) => {
        setTargetEntryId(entry.id)
        setTargetEntryQuery(entry.title)
    }, [])

    const updateTargetEntryQuery = useCallback((value: string) => {
        setTargetEntryQuery(value)
        const selected = projectEntries.find((entry) => entry.id === targetEntryId)
        if (selected?.title !== value) setTargetEntryId('')
    }, [projectEntries, targetEntryId])

    /** 返回是否真的把任务发出去了；调用方据此决定要不要关闭表单/返回上一页。 */
    const generate = useCallback(async (): Promise<boolean> => {
        if (!effectivePluginId || !effectiveModel) {
            await showAlert('请先选择 AI 插件和模型。', 'warning', 'nonInvasive', 2200)
            return false
        }
        const resolvedTargetEntryId = targetEntryId.trim()
        if (checkKind === 'entry_alignment' && !resolvedTargetEntryId) {
            await showAlert('单词条契合度检测需要先选择目标词条。', 'warning', 'nonInvasive', 2400)
            return false
        }
        const request = {
            sessionId: `world_check_${checkKind}_${Date.now()}`,
            pluginId: effectivePluginId,
            model: effectiveModel,
            projectId,
            checkKind,
            targetEntryId: checkKind === 'entry_alignment' ? resolvedTargetEntryId : null,
        }
        logger.log('[WorldCheck] start session', request)
        setGenerateDialogOpen(false)
        try {
            await startWorldCheckTask({request, projectName})
            return true
        } catch (error) {
            logger.error('[WorldCheck] 启动检测失败', error)
            await showAlert(`启动设定检测失败：${String(error)}`, 'error', 'nonInvasive', 2600)
            return false
        }
    }, [checkKind, effectiveModel, effectivePluginId, projectId, projectName, showAlert, targetEntryId])

    const deleteReport = useCallback(async (reportId: string) => {
        const confirmed = await showAlert('删除后将无法在历史中恢复这份报告。是否继续？', 'warning', 'confirm')
        if (confirmed !== 'yes') return
        try {
            await ai_delete_world_check_report(reportId)
            setHistoryItems((items) => items.filter((item) => item.reportId !== reportId))
            if (selectedReportId === reportId) {
                const next = historyItems.find((item) => item.reportId !== reportId)
                setSelectedReportId(next?.reportId ?? null)
                if (!next) setActiveRecord(null)
            }
            await showAlert('报告已删除。', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('删除设定检测报告失败', error)
            await showAlert(`删除报告失败：${String(error)}`, 'error', 'nonInvasive', 2600)
        }
    }, [historyItems, selectedReportId, showAlert])

    const startDiscussionForRecord = useCallback(async (record: StoredWorldCheckReport) => {
        if (!onStartDiscussion) return
        const model = record.model ?? effectiveModel
        if (!model) {
            await showAlert('当前缺少可用模型，无法创建报告讨论对话。', 'warning', 'nonInvasive', 2200)
            return
        }
        await onStartDiscussion({
            title: `${worldCheckKindLabel(record.checkKind)}：${record.projectName}`,
            pluginId: record.pluginId,
            model,
            reportContext: buildWorldCheckConversationContext(record),
        })
    }, [effectiveModel, onStartDiscussion, showAlert])

    const startDiscussion = useCallback(async () => {
        if (activeRecord) await startDiscussionForRecord(activeRecord)
    }, [activeRecord, startDiscussionForRecord])

    const openGenerate = useCallback((kind?: WorldCheckKind) => {
        if (taskRunning) {
            openWorldCheckTaskMonitor(projectId)
            return
        }
        if (kind) setCheckKind(kind)
        setGenerateDialogOpen(true)
    }, [projectId, taskRunning])

    const openTaskReport = useCallback(() => {
        if (!task?.record) return
        setSelectedReportId(task.record.reportId)
        setActiveRecord(task.record)
        closeWorldCheckTaskMonitor(projectId)
    }, [projectId, task])

    const retryTask = useCallback(() => {
        if (!task) return
        closeWorldCheckTaskMonitor(projectId)
        setCheckKind(task.checkKind)
        setGenerateDialogOpen(true)
    }, [projectId, task])

    useEffect(() => {
        if (!activeRecord) {
            setEntryTitleMap({})
            return
        }
        const ids = new Set(activeRecord.report.findings.flatMap((finding) => finding.relatedEntryIds))
        if (ids.size === 0) return
        const idList = [...ids]
        Promise.allSettled(idList.map((id) => db_get_entry(id, projectId))).then((results) => {
            const map: Record<string, string> = {}
            idList.forEach((id, index) => {
                const result = results[index]
                map[id] = result.status === 'fulfilled' ? result.value.title : id
            })
            setEntryTitleMap(map)
        }).catch(() => {})
    }, [activeRecord, projectId])

    const summary = useMemo(() => {
        if (!activeRecord) return null
        const findings = activeRecord.report.findings
        return {
            findingCount: findings.length,
            unresolvedCount: activeRecord.report.unresolvedQuestions.length,
            status: worldCheckReportStatus(activeRecord.report, activeRecord.checkKind),
            severityDist: {
                critical: findings.filter((item) => item.severity === 'critical').length,
                high: findings.filter((item) => item.severity === 'high').length,
                medium: findings.filter((item) => item.severity === 'medium').length,
                low: findings.filter((item) => item.severity === 'low').length,
            },
        }
    }, [activeRecord])

    return {
        checkKind,
        setCheckKind,
        targetEntryId,
        targetEntryQuery,
        targetEntryOptions,
        selectedTargetEntry,
        entriesLoading,
        updateTargetEntryQuery,
        selectTargetEntry,
        plugins: pluginState.plugins,
        selectedPluginInfo,
        effectivePluginId,
        effectiveModel,
        selectPlugin,
        selectModel: setLocalModel,
        historyItems,
        selectedReportId,
        setSelectedReportId,
        activeRecord,
        historyLoading,
        detailLoading,
        loadHistory,
        generateDialogOpen,
        closeGenerate: () => setGenerateDialogOpen(false),
        generate,
        deleteReport,
        task,
        taskRunning,
        openGenerate,
        openTaskMonitor: () => openWorldCheckTaskMonitor(projectId),
        closeTaskMonitor: () => closeWorldCheckTaskMonitor(projectId),
        cancelTask: () => cancelWorldCheckTask(projectId),
        openTaskReport,
        retryTask,
        startDiscussion,
        startDiscussionForRecord,
        entryTitleMap,
        summary,
    }
}
