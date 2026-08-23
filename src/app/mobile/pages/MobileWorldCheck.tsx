/**
 * 移动端设定检测页。
 *
 * 业务状态与桌面端共用 useWorldCheckController；本文件只负责手机上的报告列表、独立详情和浮层布局。
 */
import {useCallback, useEffect, useState} from 'react'
import {Button, Input, Select, useAlert} from 'flowcloudai-ui'
import type {WorldCheckKind, WorldCheckReportHistoryItem} from '../../../api'
import {
    WORLD_CHECK_KIND_DESCRIPTIONS,
    WORLD_CHECK_KIND_OPTIONS,
    formatWorldCheckDateTime,
    type WorldCheckDiscussionParams,
    useWorldCheckController,
    worldCheckCategoryLabel,
    worldCheckKindLabel,
    worldCheckSeverityLabel,
} from '../../../features/project-editor/hooks/useWorldCheckController'
import {
    getWorldCheckPhaseStatus,
    WORLD_CHECK_PHASES,
    type WorldCheckTask,
    type WorldCheckTaskPhase,
} from '../../../features/project-editor/stores/worldCheckTaskModel'
import {useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {ActionMenu, FloatingPanel} from '../../../shared/ui/overlay'
import {
    MobileAddIcon,
    MobileBackIcon,
    MobileMoreIcon,
    MobilePageTopBar,
    MobileSearchIcon,
    MobileTopActionPill,
} from '../components/MobileTopControls'
import type {MobileBeforeLeave} from '../mobileBackNavigation'
import type {MobilePage, MobileProjectScopedPageParams} from '../usePageStack'
import './MobileWorldCheck.css'

interface Props {
    params: MobileProjectScopedPageParams
    pop: () => void
    push: (page: MobilePage) => void
    setBeforeLeave: (handler: MobileBeforeLeave | null) => void
    startReportDiscussion: (params: WorldCheckDiscussionParams) => Promise<void>
}

const PHASE_LABELS: Record<WorldCheckTaskPhase, string> = {
    prepare: '准备资料',
    analyze: 'AI 分析',
    validate: '校验报告',
    persist: '保存报告',
}

function taskStatusLabel(task: WorldCheckTask): string {
    switch (task.status) {
        case 'success': return '已完成'
        case 'failed': return '检测失败'
        case 'cancelled': return '已取消'
        case 'cancelling': return '停止中'
        default: return '检测中'
    }
}

function taskProgressLabel(task: WorldCheckTask): string {
    const progress = `${WORLD_CHECK_PHASES.indexOf(task.phase) + 1}/${WORLD_CHECK_PHASES.length}`
    return task.status === 'running' ? `${PHASE_LABELS[task.phase]} ${progress}` : `${taskStatusLabel(task)} ${progress}`
}

function historyStatusLabel(item: WorldCheckReportHistoryItem): string {
    if (item.findingCount > 0) return `发现 ${item.findingCount} 项问题`
    if (item.unresolvedCount > 0) return `${item.unresolvedCount} 项需要确认`
    return '整体稳定'
}

function formatHistoryDate(value: string): string {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric'}).format(parsed)
}

function RefreshIcon() {
    return (
        <svg className="mobile-top-control-svg" viewBox="0 0 24 24" focusable="false">
            <path d="M19 7v5h-5"/>
            <path d="M18.2 12a6.5 6.5 0 1 0-1.1 4.9"/>
        </svg>
    )
}

export default function MobileWorldCheck({params, pop, push, setBeforeLeave, startReportDiscussion}: Props) {
    const projectId = params.projectId
    const {showAlert} = useAlert()
    const [view, setView] = useState<'list' | 'detail'>('list')
    const [reportMenuOpen, setReportMenuOpen] = useState(false)
    const projectDetail = useProjectDetailStore(projectId)
    const projectName = projectDetail.project?.name ?? '当前项目'
    const handleStartDiscussion = useCallback(async (discussion: WorldCheckDiscussionParams) => {
        try {
            await startReportDiscussion(discussion)
        } catch (error) {
            await showAlert(`创建报告讨论失败：${String(error)}`, 'error', 'nonInvasive', 2800)
        }
    }, [showAlert, startReportDiscussion])
    const controller = useWorldCheckController({
        projectId,
        projectName,
        onStartDiscussion: handleStartDiscussion,
    })
    const {
        checkKind,
        setCheckKind,
        targetEntryId,
        targetEntryQuery,
        targetEntryOptions,
        selectedTargetEntry,
        entriesLoading,
        updateTargetEntryQuery,
        selectTargetEntry,
        plugins,
        selectedPluginInfo,
        effectivePluginId,
        effectiveModel,
        selectPlugin,
        selectModel,
        historyItems,
        selectedReportId,
        setSelectedReportId,
        activeRecord,
        historyLoading,
        detailLoading,
        loadHistory,
        generateDialogOpen,
        closeGenerate,
        generate,
        deleteReport,
        task,
        taskRunning,
        openGenerate,
        openTaskMonitor,
        closeTaskMonitor,
        cancelTask,
        openTaskReport,
        retryTask,
        startDiscussion,
        startDiscussionForRecord,
        entryTitleMap,
        summary,
    } = controller

    const latestReport = historyItems[0] ?? null
    const earlierReports = historyItems.slice(1)
    const reportReady = !!activeRecord && activeRecord.reportId === selectedReportId
    const returnToList = useCallback(() => {
        setReportMenuOpen(false)
        setView('list')
    }, [])
    const openReport = useCallback((reportId: string) => {
        setSelectedReportId(reportId)
        setView('detail')
    }, [setSelectedReportId])
    const handleOpenTaskReport = useCallback(() => {
        openTaskReport()
        setView('detail')
    }, [openTaskReport])

    useEffect(() => {
        setView('list')
    }, [projectId])

    useEffect(() => {
        if (view !== 'detail') {
            setBeforeLeave(null)
            return
        }
        setBeforeLeave((intent) => {
            if (intent !== 'back') return true
            returnToList()
            return false
        })
        return () => setBeforeLeave(null)
    }, [returnToList, setBeforeLeave, view])

    return (
        <div className="mobile-page mobile-world-check">
            <MobilePageTopBar
                className="mobile-world-check__topbar"
                sticky
                edgeToEdge
                ariaLabel="设定检测操作"
                left={(
                    <MobileTopActionPill actions={[{
                        key: 'back',
                        label: view === 'detail' ? '返回报告列表' : '返回',
                        icon: <MobileBackIcon/>,
                        onClick: view === 'detail' ? returnToList : pop,
                    }]}/>
                )}
                center={<span className="mobile-world-check__topbar-title">{view === 'detail' ? '报告详情' : '设定检测'}</span>}
                right={(
                    view === 'detail' ? (
                        <MobileTopActionPill actions={[{
                            key: 'more',
                            label: '更多报告操作',
                            icon: <MobileMoreIcon/>,
                            onClick: () => setReportMenuOpen(true),
                        }]}/>
                    ) : (
                        <MobileTopActionPill actions={[
                            {
                                key: 'refresh',
                                label: '刷新历史',
                                icon: <RefreshIcon/>,
                                disabled: historyLoading,
                                onClick: () => void loadHistory(),
                            },
                            {
                                key: 'generate',
                                label: taskRunning ? '查看检测进度' : '生成新报告',
                                icon: <MobileAddIcon/>,
                                kind: 'add',
                                onClick: () => openGenerate(),
                            },
                        ]}/>
                    )
                )}
            />

            {view === 'list' ? (
                <main className="mobile-world-check__list-content">
                    {task && task.status !== 'success' && (
                        <button
                            type="button"
                            className={`mobile-world-check__task is-${task.status}`}
                            onClick={openTaskMonitor}
                        >
                            <span className="mobile-world-check__task-icon" aria-hidden="true"><RefreshIcon/></span>
                            <strong>{worldCheckKindLabel(task.checkKind)} · {taskProgressLabel(task)}</strong>
                            <span className="mobile-world-check__chevron" aria-hidden="true"><MobileBackIcon/></span>
                        </button>
                    )}

                    {historyLoading && historyItems.length === 0 ? (
                        <div className="mobile-page__loading">正在读取报告…</div>
                    ) : latestReport ? (
                        <>
                            <section className="mobile-world-check__latest" aria-labelledby="mobile-world-check-latest-title">
                                <div className="mobile-world-check__section-title">
                                    <h2 id="mobile-world-check-latest-title">最新报告</h2>
                                </div>
                                <button
                                    type="button"
                                    className="mobile-world-check__featured-report"
                                    onClick={() => openReport(latestReport.reportId)}
                                >
                                    <span className="mobile-world-check__report-icon" aria-hidden="true"><MobileSearchIcon/></span>
                                    <span className="mobile-world-check__report-copy">
                                        <strong>{worldCheckKindLabel(latestReport.checkKind)}</strong>
                                        <span className="mobile-world-check__report-meta">
                                            <b>{reportReady && activeRecord.reportId === latestReport.reportId ? summary?.status : historyStatusLabel(latestReport)}</b>
                                            <span>·</span>
                                            <span>{formatWorldCheckDateTime(latestReport.createdAt)}</span>
                                        </span>
                                        <span className="mobile-world-check__report-overview">{latestReport.overview}</span>
                                    </span>
                                    <span className="mobile-world-check__featured-end">
                                        <strong>{latestReport.findingCount} 项问题</strong>
                                        <span className="mobile-world-check__chevron" aria-hidden="true"><MobileBackIcon/></span>
                                    </span>
                                </button>
                            </section>

                            {earlierReports.length > 0 && (
                                <details className="mobile-world-check__history" open>
                                    <summary>
                                        <strong>以前的报告</strong>
                                        <span>{earlierReports.length} 份</span>
                                    </summary>
                                    <div className="mobile-world-check__history-list">
                                        {earlierReports.map((item) => (
                                            <button key={item.reportId} type="button" onClick={() => openReport(item.reportId)}>
                                                <span className="mobile-world-check__history-icon" aria-hidden="true"><MobileSearchIcon/></span>
                                                <span className="mobile-world-check__history-copy">
                                                    <strong>{worldCheckKindLabel(item.checkKind)}</strong>
                                                    <small>{historyStatusLabel(item)}</small>
                                                </span>
                                                <time>{formatHistoryDate(item.createdAt)}</time>
                                                <span className="mobile-world-check__chevron" aria-hidden="true"><MobileBackIcon/></span>
                                            </button>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </>
                    ) : (
                        <section className="mobile-world-check__launch" aria-labelledby="mobile-world-check-launch-title">
                            <div className="mobile-world-check__section-head">
                                <div>
                                    <span className="mobile-world-check__eyebrow">还没有报告</span>
                                    <h2 id="mobile-world-check-launch-title">选择检测方式</h2>
                                </div>
                            </div>
                            <div className="mobile-world-check__launch-list">
                                {WORLD_CHECK_KIND_OPTIONS.map((option) => {
                                    const currentTask = taskRunning && task?.checkKind === option.value
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            disabled={taskRunning && !currentTask}
                                            onClick={() => openGenerate(option.value)}
                                        >
                                            <span>
                                                <strong>{option.label}</strong>
                                                <small>{WORLD_CHECK_KIND_DESCRIPTIONS[option.value]}</small>
                                            </span>
                                            <b>{currentTask ? '查看进度' : taskRunning ? '等待中' : '开始'}</b>
                                        </button>
                                    )
                                })}
                            </div>
                        </section>
                    )}
                </main>
            ) : detailLoading || !reportReady ? (
                <div className="mobile-page__loading">正在加载报告详情…</div>
            ) : (
                <article className="mobile-world-check__report">
                    {taskRunning && (
                        <button type="button" className="mobile-world-check__detail-task" onClick={openTaskMonitor}>
                            <strong>{taskProgressLabel(task!)}</strong>
                            <span>查看进度</span>
                        </button>
                    )}
                    <header className="mobile-world-check__report-hero">
                        <div className="mobile-world-check__report-meta">
                            <span>{worldCheckKindLabel(activeRecord.checkKind)}</span>
                            <span>{formatWorldCheckDateTime(activeRecord.createdAt)}</span>
                            {activeRecord.truncated && <span className="is-warning">资料已裁剪</span>}
                        </div>
                        <h2>{summary?.status}</h2>
                        <p>{activeRecord.report.overview}</p>
                        <small>范围：{activeRecord.scopeSummary}</small>
                        <div className="mobile-world-check__report-actions">
                            <Button type="button" variant="primary" onClick={() => void startDiscussion()}>
                                讨论报告
                            </Button>
                            <Button type="button" variant="outline" onClick={returnToList}>
                                返回列表
                            </Button>
                        </div>
                    </header>

                    <div className="mobile-world-check__stats" aria-label="报告统计">
                        <div><strong>{summary?.findingCount ?? 0}</strong><span>问题</span></div>
                        <div><strong>{summary?.unresolvedCount ?? 0}</strong><span>待确认</span></div>
                        <div><strong>{activeRecord.sourceEntryIds.length}</strong><span>来源词条</span></div>
                    </div>

                    <section className="mobile-world-check__report-section">
                        <div className="mobile-world-check__section-head">
                            <h3>检测结论</h3>
                            <small>{activeRecord.report.findings.length} 项</small>
                        </div>
                        {activeRecord.report.findings.length === 0 ? (
                            <div className="mobile-world-check__empty">当前范围内没有发现明确问题。</div>
                        ) : (
                            <div className="mobile-world-check__finding-list">
                                {activeRecord.report.findings.map((finding) => (
                                    <article
                                        key={finding.findingId}
                                        className={`mobile-world-check__finding is-${finding.severity}`}
                                    >
                                        <div className="mobile-world-check__finding-head">
                                            <span data-severity={finding.severity}>{worldCheckSeverityLabel(finding.severity)}</span>
                                            {finding.category && <span>{worldCheckCategoryLabel(finding.category)}</span>}
                                        </div>
                                        <h4>{finding.title}</h4>
                                        <p>{finding.description}</p>
                                        {finding.relatedEntryIds.length > 0 && (
                                            <div className="mobile-world-check__entry-links">
                                                {finding.relatedEntryIds.map((entryId) => (
                                                    <button
                                                        key={entryId}
                                                        type="button"
                                                        onClick={() => push({
                                                            type: 'entryDetail',
                                                            params: {
                                                                projectId,
                                                                entryId,
                                                                displayName: entryTitleMap[entryId] ?? entryId,
                                                                mode: 'view',
                                                            },
                                                        })}
                                                    >
                                                        {entryTitleMap[entryId] ?? entryId}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {finding.evidence.length > 0 && (
                                            <details className="mobile-world-check__evidence">
                                                <summary>查看证据（{finding.evidence.length}）</summary>
                                                {finding.evidence.map((evidence, index) => (
                                                    <blockquote key={`${finding.findingId}-${index}`}>
                                                        <strong>{evidence.entryTitle}</strong>
                                                        <p>“{evidence.quote}”</p>
                                                        {evidence.note && <small>{evidence.note}</small>}
                                                    </blockquote>
                                                ))}
                                            </details>
                                        )}
                                        {finding.recommendation && (
                                            <div className="mobile-world-check__recommendation">
                                                <strong>建议</strong>
                                                <span>{finding.recommendation}</span>
                                            </div>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="mobile-world-check__report-section mobile-world-check__scope">
                        <div className="mobile-world-check__section-head"><h3>资料范围</h3></div>
                        <p>{activeRecord.scopeSummary}{activeRecord.truncated ? '，部分资料已裁剪。' : '，资料未裁剪。'}</p>
                    </section>

                    {activeRecord.report.unresolvedQuestions.length > 0 && (
                        <ReportList title="待确认问题" items={activeRecord.report.unresolvedQuestions}/>
                    )}
                    {activeRecord.report.suggestions.length > 0 && (
                        <ReportList title="修订建议" items={activeRecord.report.suggestions}/>
                    )}
                </article>
            )}

            {task?.monitorOpen && (
                <FloatingPanel
                    open
                    onClose={closeTaskMonitor}
                    dismissible
                    title={`${worldCheckKindLabel(task.checkKind)} · ${projectName}`}
                    closeLabel="收起并继续后台运行"
                    className="mobile-world-check-task-panel"
                >
                    <div className="mobile-world-check-task-panel__status">
                        <strong>{taskStatusLabel(task)}</strong>
                        <span>{task.currentActivity}</span>
                    </div>
                    <div className="mobile-world-check-task-panel__phases">
                        {WORLD_CHECK_PHASES.map((phase) => (
                            <div key={phase} data-status={getWorldCheckPhaseStatus(task, phase)}>
                                <i/>
                                <span>
                                    <strong>{PHASE_LABELS[phase]}</strong>
                                    <small>{phase === task.phase ? task.currentActivity : getWorldCheckPhaseStatus(task, phase) === 'done' ? '已完成' : '等待中'}</small>
                                </span>
                            </div>
                        ))}
                    </div>
                    {task.errors[0] && (
                        <div className="mobile-world-check-task-panel__error" role="alert">
                            <strong>{task.errors[0].code}</strong>
                            <span>{task.errors[0].message}</span>
                        </div>
                    )}
                    <div className="mobile-world-check-task-panel__metrics">
                        <span>{task.toolCallCount} 次工具调用</span>
                        <span>输出 {task.outputChars} 字符</span>
                        {task.retryCount > 0 && <span>{task.retryCount} 次重试</span>}
                    </div>
                    <details className="mobile-world-check-task-panel__events">
                        <summary>运行记录（{task.events.length}）</summary>
                        <ol>
                            {task.events.map((event) => (
                                <li key={event.id} data-level={event.level}>
                                    <strong>{event.title}</strong>
                                    <span>{event.detail}</span>
                                </li>
                            ))}
                        </ol>
                    </details>
                    <div className="mobile-world-check-task-panel__actions">
                        {task.status === 'running' && (
                            <>
                                <Button type="button" variant="outline" onClick={() => void cancelTask()}>停止检测</Button>
                                <Button type="button" variant="primary" onClick={closeTaskMonitor}>收起</Button>
                            </>
                        )}
                        {task.status === 'cancelling' && <Button type="button" disabled>正在停止…</Button>}
                        {(task.status === 'failed' || task.status === 'cancelled') && (
                            <Button type="button" variant="primary" onClick={retryTask}>重新检测</Button>
                        )}
                        {task.status === 'success' && (
                            <>
                                <Button type="button" variant="outline" onClick={handleOpenTaskReport}>查看报告</Button>
                                <Button type="button" variant="primary" onClick={() => void startDiscussionForRecord(task.record!)}>
                                    讨论报告
                                </Button>
                            </>
                        )}
                    </div>
                </FloatingPanel>
            )}

            <ActionMenu
                open={reportMenuOpen && reportReady}
                onClose={() => setReportMenuOpen(false)}
                title={activeRecord ? `${worldCheckKindLabel(activeRecord.checkKind)}报告` : '报告操作'}
                ariaLabel="报告操作"
                items={activeRecord ? [{
                    key: 'delete',
                    label: '删除报告',
                    danger: true,
                    onSelect: () => void deleteReport(activeRecord.reportId),
                }] : []}
            />

            {generateDialogOpen && (
                <FloatingPanel
                    open
                    onClose={closeGenerate}
                    dismissible
                    title="生成新报告"
                    className="mobile-world-check-generate"
                >
                    <div className="mobile-world-check-generate__body">
                        <label>
                            <span>检测类型</span>
                            <Select
                                options={WORLD_CHECK_KIND_OPTIONS}
                                value={checkKind}
                                onValueChange={(value) => setCheckKind(String(value) as WorldCheckKind)}
                                placeholder="检测类型"
                                radius="md"
                            />
                            <small>{WORLD_CHECK_KIND_DESCRIPTIONS[checkKind]}</small>
                        </label>
                        {checkKind === 'entry_alignment' && (
                            <div className="mobile-world-check-generate__field">
                                <span>目标词条</span>
                                <Input
                                    value={targetEntryQuery}
                                    aria-label="目标词条"
                                    onValueChange={updateTargetEntryQuery}
                                    placeholder="输入词条名前缀搜索"
                                    radius="md"
                                />
                                {selectedTargetEntry && <small>已选择：{selectedTargetEntry.title}</small>}
                                <div className="mobile-world-check-generate__entries" role="listbox" aria-label="目标词条候选">
                                    {entriesLoading ? (
                                        <span>正在加载词条…</span>
                                    ) : targetEntryOptions.length > 0 ? targetEntryOptions.map((entry) => (
                                        <button
                                            key={entry.id}
                                            type="button"
                                            role="option"
                                            aria-selected={entry.id === targetEntryId}
                                            className={entry.id === targetEntryId ? 'is-active' : ''}
                                            onClick={() => selectTargetEntry(entry)}
                                        >
                                            <strong>{entry.title}</strong>
                                            {entry.summary && <small>{entry.summary}</small>}
                                        </button>
                                    )) : <span>{targetEntryQuery.trim() ? '没有匹配的词条' : '输入前缀开始搜索'}</span>}
                                </div>
                            </div>
                        )}
                        <label>
                            <span>AI 插件</span>
                            <Select
                                options={plugins.map((plugin) => ({value: plugin.id, label: plugin.name}))}
                                value={effectivePluginId ?? ''}
                                onValueChange={(value) => selectPlugin(String(value))}
                                placeholder="选择插件"
                                radius="md"
                            />
                        </label>
                        <label>
                            <span>模型</span>
                            <Select
                                options={(selectedPluginInfo?.models ?? []).map((model) => ({value: model, label: model}))}
                                value={effectiveModel ?? ''}
                                onValueChange={(value) => selectModel(String(value))}
                                placeholder="选择模型"
                                radius="md"
                            />
                        </label>
                    </div>
                    <div className="mobile-world-check-generate__actions">
                        <Button type="button" variant="outline" onClick={closeGenerate}>取消</Button>
                        <Button type="button" variant="primary" onClick={() => void generate()}>开始检测</Button>
                    </div>
                </FloatingPanel>
            )}
        </div>
    )
}

function ReportList({title, items}: {title: string; items: string[]}) {
    return (
        <section className="mobile-world-check__report-section">
            <div className="mobile-world-check__section-head">
                <h3>{title}</h3>
                <small>{items.length} 项</small>
            </div>
            {items.length === 0 ? (
                <div className="mobile-world-check__empty">无</div>
            ) : (
                <ol className="mobile-world-check__plain-list">
                    {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
                </ol>
            )}
        </section>
    )
}
