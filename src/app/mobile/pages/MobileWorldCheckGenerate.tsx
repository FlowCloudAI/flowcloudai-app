/**
 * 设定检测「生成新报告」页。
 *
 * 原先是设定检测页里的 FloatingPanel，但它是带文本输入的配置表单（目标词条要打字搜索），
 * 属于重操作，浮层只留给选择、提示和简单查看。
 *
 * 表单状态用 useWorldCheckController 的 formOnly 模式：跳过历史与报告详情拉取，
 * 只保留检测类型、目标词条、插件与模型。任务本身进的是共享的 worldCheckTaskStore，
 * 所以返回设定检测页后进度照常可见。
 */
import {useCallback} from 'react'
import {Button, Input, Select} from 'flowcloudai-ui'
import {
    WORLD_CHECK_KIND_DESCRIPTIONS,
    WORLD_CHECK_KIND_OPTIONS,
    useWorldCheckController,
} from '../../../features/project-editor/hooks/useWorldCheckController'
import type {WorldCheckKind} from '../../../api'
import {useProjectDetailStore} from '../../../features/projects/projectDetailStore'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileWorldCheckGeneratePageParams} from '../usePageStack'
import './MobileWorldCheck.css'

interface Props {
    pop: () => void
    params: MobileWorldCheckGeneratePageParams
}

export default function MobileWorldCheckGenerate({pop, params}: Props) {
    const projectId = params.projectId
    const projectDetail = useProjectDetailStore(projectId)
    const projectName = projectDetail.project?.name ?? '当前项目'
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
        generate,
    } = useWorldCheckController({
        projectId,
        projectName,
        formOnly: true,
        initialCheckKind: params.checkKind,
    })

    // generate 校验失败时会自己弹提示并返回 false，这时留在本页让用户补齐。
    const handleGenerate = useCallback(async () => {
        if (await generate()) pop()
    }, [generate, pop])

    return (
        <div className="mobile-page mobile-world-check-generate-page">
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel="生成新报告"
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}
                />}
                right={(
                    <Button type="button" size="sm" radius="full" onClick={() => void handleGenerate()}>
                        开始检测
                    </Button>
                )}
            />

            <div className="mobile-world-check-generate-page__heading">
                <span className="mobile-page__eyebrow">{projectName}</span>
                <h2 className="mobile-page__hero-title">生成新报告</h2>
            </div>

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
        </div>
    )
}
