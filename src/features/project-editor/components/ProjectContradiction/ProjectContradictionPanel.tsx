import {memo} from 'react'
import {createPortal} from 'react-dom'
import {Button, Input, RollingBox, Select} from 'flowcloudai-ui'
import type {WorldCheckKind} from '../../../../api'
import {FloatingPanel} from '../../../../shared/ui/overlay'
import {
    WORLD_CHECK_KIND_DESCRIPTIONS as CHECK_KIND_DESCRIPTIONS,
    WORLD_CHECK_KIND_OPTIONS as CHECK_KIND_OPTIONS,
    formatWorldCheckDateTime as formatDateTime,
    type WorldCheckDiscussionParams,
    useWorldCheckController,
    worldCheckCategoryLabel as categoryLabel,
    worldCheckKindLabel as checkKindLabel,
    worldCheckSeverityLabel as severityLabel,
} from '../../hooks/useWorldCheckController'
import {WorldCheckTaskCard, WorldCheckTaskMonitor} from './WorldCheckTaskViews'
import '../../../../shared/ui/layout/WorkspaceScaffold.css'
import './ProjectContradictionPanel.css'

interface ProjectContradictionPanelProps {
    projectId: string
    projectName: string
    aiPluginId?: string | null
    aiModel?: string | null
    activeEntryId?: string | null
    activeEntryTitle?: string | null
    sidebarContainer?: HTMLElement | null
    onStartDiscussion?: (params: WorldCheckDiscussionParams) => void
    onOpenEntry?: (entry: { id: string; title: string }) => void
}

function ProjectContradictionPanel({
                                        projectId,
                                        projectName,
                                        aiPluginId = null,
                                        aiModel = null,
                                        activeEntryId = null,
                                        activeEntryTitle = null,
                                        sidebarContainer,
                                        onStartDiscussion,
                                        onOpenEntry,
                                    }: ProjectContradictionPanelProps) {
    const controller = useWorldCheckController({
        projectId,
        projectName,
        aiPluginId,
        aiModel,
        activeEntryId,
        activeEntryTitle,
        onStartDiscussion,
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
        generate: handleGenerate,
        deleteReport: handleDelete,
        task,
        taskRunning,
        openGenerate: handleOpenGenerate,
        openTaskMonitor,
        closeTaskMonitor,
        cancelTask,
        openTaskReport: handleOpenTaskReport,
        retryTask: handleRetryTask,
        startDiscussion: handleStartDiscussion,
        startDiscussionForRecord,
        entryTitleMap,
        summary,
    } = controller

    const renderSidebarExternally = Boolean(sidebarContainer)
    const historyPanel = (
        <div className="pe-contradiction-sidebar">
            {task && !taskRunning && (
                <section className="pe-contradiction-recent-task" aria-label="最近检测任务">
                    <div className="pe-contradiction-section__header">
                        <h3 className="pe-contradiction-section__title fc-section-title">最近任务</h3>
                    </div>
                    <WorldCheckTaskCard task={task} onOpen={openTaskMonitor}/>
                </section>
            )}
            <section className="pe-contradiction-history">
                <div className="pe-contradiction-section__header">
                    <h3 className="pe-contradiction-section__title fc-section-title">历史报告</h3>
                    <span className="pe-contradiction-section__meta">{historyItems.length} 份</span>
                </div>
                <RollingBox axis="y" className="pe-contradiction-history__scroll" thumbSize="thin">
                    <div className="pe-contradiction-history__list">
                        {historyLoading && historyItems.length === 0 ? (
                            <div className="pe-contradiction-empty">正在加载历史报告…</div>
                        ) : historyItems.length === 0 ? (
                            <div className="pe-contradiction-empty">还没有生成过检测报告。</div>
                        ) : historyItems.map((item) => (
                            <article
                                key={item.reportId}
                                className={`pe-contradiction-history__item fc-op-item${item.reportId === selectedReportId ? ' is-active' : ''}`}
                            >
                                <button
                                    type="button"
                                    className="fc-op-item__content"
                                    onClick={() => setSelectedReportId(item.reportId)}
                                >
                                    <div className="pe-contradiction-history__topline">
                                        <span className="fc-op-item__meta">{formatDateTime(item.createdAt)}</span>
                                        <span className="fc-op-count">{item.findingCount} 个问题</span>
                                        <span className="fc-op-count">{checkKindLabel(item.checkKind)}</span>
                                    </div>
                                    <div className="fc-op-item__title">{item.overview}</div>
                                    <div className="fc-op-item__meta">
                                        <span>{item.scopeSummary}</span>
                                        {item.truncated && <span className="fc-op-hint--error">已裁剪</span>}
                                    </div>
                                </button>
                                <div className="fc-op-item__actions">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handleDelete(item.reportId)}
                                    >
                                        删除
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </div>
                </RollingBox>
            </section>
        </div>
    )

    return (
        <div className="pe-contradiction-panel">
            {renderSidebarExternally && sidebarContainer ? createPortal(historyPanel, sidebarContainer) : null}

            <div className="pe-contradiction-toolbar fc-op-header">
                <div className="pe-contradiction-toolbar__left">
                    <div className="fc-op-header__title-block">
                        <h2 className="pe-contradiction-title fc-op-header__title">设定检测</h2>
                    </div>
                </div>
                <div className="pe-contradiction-toolbar__actions fc-op-header__actions">
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadHistory()}
                            disabled={historyLoading}>
                        刷新历史
                    </Button>
                    <Button type="button" variant="primary" size="sm" onClick={() => handleOpenGenerate()}>
                        {taskRunning ? '查看检测进度' : '生成新报告'}
                    </Button>
                </div>
            </div>

            {task && taskRunning && (
                <div className="pe-contradiction-task-summary">
                    <WorldCheckTaskCard task={task} onOpen={openTaskMonitor}/>
                </div>
            )}

            <div className={`pe-contradiction-layout${renderSidebarExternally ? ' pe-contradiction-layout--single' : ''}`}>
                {!renderSidebarExternally && historyPanel}
                <section className="pe-contradiction-report">
                    {!activeRecord ? (
                        <div className="pe-contradiction-launch">
                            <div className="pe-contradiction-launch__header">
                                <h3>开始检测</h3>
                                <p>同一项目同时运行一个 AI 检测任务，开始后可收起并继续其他工作。</p>
                            </div>
                            <div className="pe-contradiction-launch__list">
                                {CHECK_KIND_OPTIONS.map((option) => {
                                    const isCurrentTask = taskRunning && task?.checkKind === option.value
                                    return (
                                        <div key={option.value} className="pe-contradiction-launch__item">
                                            <div>
                                                <strong>{option.label}</strong>
                                                <span>{CHECK_KIND_DESCRIPTIONS[option.value]}</span>
                                            </div>
                                            <Button
                                                type="button"
                                                variant={isCurrentTask ? 'primary' : 'outline'}
                                                size="sm"
                                                disabled={taskRunning && !isCurrentTask}
                                                onClick={() => handleOpenGenerate(option.value)}
                                            >
                                                {isCurrentTask ? '查看当前任务' : taskRunning ? '等待当前任务' : '开始检测'}
                                            </Button>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : detailLoading ? (
                        <div className="pe-contradiction-empty pe-contradiction-empty--large">
                            正在加载报告详情…
                        </div>
                    ) : (
                        <div className="pe-contradiction-report__body">
                            <RollingBox axis="y" className="pe-contradiction-report__scroll" thumbSize="thin">
                                <div className="pe-contradiction-report__content">
                                    <div className="pe-contradiction-report__hero">
                                        <div className="pe-contradiction-report__hero-main">
                                            <div className="pe-contradiction-report__meta">
                                                <span>{formatDateTime(activeRecord.createdAt)}</span>
                                                <span>{checkKindLabel(activeRecord.checkKind)}</span>
                                                <span>范围：{activeRecord.scopeSummary}</span>
                                                {activeRecord.truncated && <span
                                                    className="pe-contradiction-report__warning">本次资料已裁剪</span>}
                                            </div>
                                            <h3 className="pe-contradiction-report__title">{summary?.status}</h3>
                                            <p className="pe-contradiction-report__overview">{activeRecord.report.overview}</p>
                                        </div>
                                        <div className="pe-contradiction-report__hero-actions">
                                            <Button type="button" variant="outline" size="sm"
                                                    onClick={() => void handleStartDiscussion()}>
                                                在右侧继续讨论
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="pe-contradiction-stats">
                                        <div className="pe-contradiction-stat-card">
                                            <span className="pe-contradiction-stat-card__value">{summary?.findingCount ?? 0}</span>
                                            <span className="pe-contradiction-stat-card__label">问题条目</span>
                                            {(summary?.findingCount ?? 0) > 0 && (
                                                <div className="pe-contradiction-severity-dist">
                                                    {summary!.severityDist.critical > 0 && (
                                                        <span className="pe-contradiction-severity-pill is-critical">{summary!.severityDist.critical} 严重</span>
                                                    )}
                                                    {summary!.severityDist.high > 0 && (
                                                        <span className="pe-contradiction-severity-pill is-high">{summary!.severityDist.high} 高</span>
                                                    )}
                                                    {summary!.severityDist.medium > 0 && (
                                                        <span className="pe-contradiction-severity-pill is-medium">{summary!.severityDist.medium} 中</span>
                                                    )}
                                                    {summary!.severityDist.low > 0 && (
                                                        <span className="pe-contradiction-severity-pill is-low">{summary!.severityDist.low} 低</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="pe-contradiction-stat-card">
                                            <span className="pe-contradiction-stat-card__value">{summary?.unresolvedCount ?? 0}</span>
                                            <span className="pe-contradiction-stat-card__label">待确认问题</span>
                                        </div>
                                        <div className="pe-contradiction-stat-card">
                                            <span className="pe-contradiction-stat-card__value">{activeRecord.sourceEntryIds.length}</span>
                                            <span className="pe-contradiction-stat-card__label">来源词条</span>
                                        </div>
                                    </div>

                                    <section className="pe-contradiction-report__section">
                                        <div className="pe-contradiction-section__header">
                                            <h4 className="pe-contradiction-section__title fc-section-title">问题清单</h4>
                                            <span
                                                className="pe-contradiction-section__meta">{activeRecord.report.findings.length} 项</span>
                                        </div>
                                        <div className="pe-contradiction-issue-list">
                                            {activeRecord.report.findings.length === 0 ? (
                                                <div
                                                    className="pe-contradiction-empty">当前范围内没有发现明确问题。</div>
                                            ) : activeRecord.report.findings.map((finding) => (
                                                <article key={finding.findingId}
                                                         className={`pe-contradiction-issue-card is-severity-${finding.severity}`}>
                                                    <div className="pe-contradiction-issue-card__header">
                                                        <div className="pe-contradiction-issue-card__title-group">
                                                        <span
                                                            className={`pe-contradiction-issue-card__severity is-${finding.severity}`}>
                                                            {severityLabel(finding.severity)}
                                                        </span>
                                                            {finding.category && (
                                                                <span className="pe-contradiction-issue-card__category">
                                                                {categoryLabel(finding.category)}
                                                            </span>
                                                            )}
                                                            <h5 className="pe-contradiction-issue-card__title">{finding.title}</h5>
                                                        </div>
                                                        <span
                                                            className="pe-contradiction-issue-card__id">{finding.findingId}</span>
                                                    </div>
                                                    <p className="pe-contradiction-issue-card__desc">{finding.description}</p>
                                                    {finding.relatedEntryIds.length > 0 && (
                                                        <div className="pe-contradiction-chip-list">
                                                            <span className="pe-contradiction-chip-list__label">相关词条</span>
                                                            {finding.relatedEntryIds.map((entryId) => (
                                                                <button
                                                                    key={`${finding.findingId}-${entryId}`}
                                                                    type="button"
                                                                    className="pe-contradiction-chip pe-contradiction-chip--entry"
                                                                    onClick={() => onOpenEntry?.({
                                                                        id: entryId,
                                                                        title: entryTitleMap[entryId] ?? entryId,
                                                                    })}
                                                                >
                                                                    {entryTitleMap[entryId] ?? entryId}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="pe-contradiction-evidence-list">
                                                        {finding.evidence.map((evidence, index) => (
                                                            <div key={`${finding.findingId}-${index}`}
                                                                 className="pe-contradiction-evidence-card">
                                                                <div
                                                                    className="pe-contradiction-evidence-card__title">{evidence.entryTitle}</div>
                                                                <div
                                                                    className="pe-contradiction-evidence-card__quote">“{evidence.quote}”
                                                                </div>
                                                                {evidence.note && (
                                                                    <div
                                                                        className="pe-contradiction-evidence-card__note">{evidence.note}</div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    {finding.recommendation && (
                                                        <div className="pe-contradiction-issue-card__recommendation">
                                                            <strong>建议：</strong>{finding.recommendation}
                                                        </div>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    </section>

                                    <div className="pe-contradiction-report__grid">
                                        <section className="pe-contradiction-report__section">
                                            <div className="pe-contradiction-section__header">
                                                <h4 className="pe-contradiction-section__title fc-section-title">待确认问题</h4>
                                                <span
                                                    className="pe-contradiction-section__meta">{activeRecord.report.unresolvedQuestions.length} 项</span>
                                            </div>
                                            {activeRecord.report.unresolvedQuestions.length === 0 ? (
                                                <div className="pe-contradiction-empty">没有待确认问题。</div>
                                            ) : (
                                                <div className="pe-contradiction-list">
                                                    {activeRecord.report.unresolvedQuestions.map((question, index) => (
                                                        <div key={`${activeRecord.reportId}-question-${index}`}
                                                             className="pe-contradiction-list__item">
                                                            {question}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>

                                        <section className="pe-contradiction-report__section">
                                            <div className="pe-contradiction-section__header">
                                                <h4 className="pe-contradiction-section__title fc-section-title">修订建议</h4>
                                                <span
                                                    className="pe-contradiction-section__meta">{activeRecord.report.suggestions.length} 条</span>
                                            </div>
                                            {activeRecord.report.suggestions.length === 0 ? (
                                                <div className="pe-contradiction-empty">当前没有额外修订建议。</div>
                                            ) : (
                                                <div className="pe-contradiction-list">
                                                    {activeRecord.report.suggestions.map((suggestion, index) => (
                                                        <div key={`${activeRecord.reportId}-suggestion-${index}`}
                                                             className="pe-contradiction-list__item">
                                                            {suggestion}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    </div>
                                </div>
                            </RollingBox>
                        </div>
                    )}
                </section>
            </div>
            {task && (
                <WorldCheckTaskMonitor
                    task={task}
                    onClose={closeTaskMonitor}
                    onCancel={cancelTask}
                    onRetry={handleRetryTask}
                    onOpenReport={handleOpenTaskReport}
                    onDiscuss={() => {
                        if (task.record) void startDiscussionForRecord(task.record)
                    }}
                />
            )}
            {generateDialogOpen && (
                <FloatingPanel
                    open
                    onClose={closeGenerate}
                    dismissible
                    title="生成新报告"
                    className="pe-contradiction-modal"
                >
                    <p className="pe-contradiction-modal__desc">选择检测方式、AI 插件和模型后开始生成。</p>
                    <div className="pe-contradiction-modal__body">
                            <label className="pe-contradiction-field">
                                <span>检测类型</span>
                                <Select
                                    options={CHECK_KIND_OPTIONS}
                                    value={checkKind}
                                    onValueChange={(v) => setCheckKind(String(v) as WorldCheckKind)}
                                    placeholder="检测类型"
                                    radius="md"
                                    tokens={{
                                        triggerBackground: 'var(--fc-color-bg)',
                                        triggerBorderColor: 'var(--fc-color-border)',
                                        selectedColor: 'var(--fc-color-primary)',
                                        selectedBackground: 'var(--fc-color-primary-subtle)',
                                    }}
                                />
                            </label>
                            {checkKind === 'entry_alignment' && (
                                <div className="pe-contradiction-field">
                                    <span>目标词条</span>
                                    <Input
                                        size="sm"
                                        radius="md"
                                        value={targetEntryQuery}
                                        onValueChange={updateTargetEntryQuery}
                                        placeholder={activeEntryTitle ? `当前：${activeEntryTitle}` : '输入词条名前缀搜索'}
                                    />
                                    {selectedTargetEntry && (
                                        <div className="pe-contradiction-target-selected">
                                            已选择：{selectedTargetEntry.title}
                                        </div>
                                    )}
                                    <div className="pe-contradiction-entry-options">
                                        {entriesLoading ? (
                                            <div className="pe-contradiction-entry-options__empty">正在加载词条…</div>
                                        ) : targetEntryOptions.length > 0 ? (
                                            targetEntryOptions.map((entry) => (
                                                <button
                                                    key={entry.id}
                                                    type="button"
                                                    className={`pe-contradiction-entry-option${entry.id === targetEntryId ? ' is-active' : ''}`}
                                                    onClick={() => selectTargetEntry(entry)}
                                                >
                                                    <span className="pe-contradiction-entry-option__title">{entry.title}</span>
                                                    {entry.summary && (
                                                        <span className="pe-contradiction-entry-option__meta">{entry.summary}</span>
                                                    )}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="pe-contradiction-entry-options__empty">
                                                {targetEntryQuery.trim() ? '没有匹配的词条' : '输入词条名前缀以搜索'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            <label className="pe-contradiction-field">
                                <span>AI 插件</span>
                                <Select
                                    options={plugins.map((p) => ({value: p.id, label: p.name}))}
                                    value={effectivePluginId ?? ''}
                                        onValueChange={(value) => selectPlugin(String(value))}
                                    placeholder="选择插件"
                                    radius="md"
                                    tokens={{
                                        triggerBackground: 'var(--fc-color-bg)',
                                        triggerBorderColor: 'var(--fc-color-border)',
                                        selectedColor: 'var(--fc-color-primary)',
                                        selectedBackground: 'var(--fc-color-primary-subtle)',
                                    }}
                                />
                            </label>
                            <label className="pe-contradiction-field">
                                <span>模型</span>
                                <Select
                                    options={(selectedPluginInfo?.models ?? []).map((m) => ({value: m, label: m}))}
                                    value={effectiveModel ?? ''}
                                        onValueChange={(value) => selectModel(String(value))}
                                    placeholder="选择模型"
                                    radius="md"
                                    tokens={{
                                        triggerBackground: 'var(--fc-color-bg)',
                                        triggerBorderColor: 'var(--fc-color-border)',
                                        selectedColor: 'var(--fc-color-primary)',
                                        selectedBackground: 'var(--fc-color-primary-subtle)',
                                    }}
                                />
                            </label>
                        </div>
                    <div className="pe-contradiction-modal__footer">
                            <Button type="button" variant="outline" size="sm" radius="full" onClick={closeGenerate}>
                                取消
                        </Button>
                        <Button type="button" variant="primary" size="sm" radius="full" onClick={() => void handleGenerate()}>
                            开始检测
                        </Button>
                    </div>
                </FloatingPanel>
            )}
        </div>
    )
}

export default memo(ProjectContradictionPanel)
