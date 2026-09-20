// 本 hook 保留词条信息浮层原有的 AI 摘要调用与提示，不参与页面文档保存。

import {useCallback, useState} from 'react'
import {useAlert} from 'flowcloudai-ui'
import {ai_generate_entry_summary} from '../../../api'
import {logger} from '../../../shared/logger'
import type {EntryDraft} from '../components/entryEditorModel.ts'
import {normalizeComparableText} from '../lib/entryCommon.ts'

interface UseEntrySummaryGenerationOptions {
    aiPluginId: string | null
    aiModel: string | null
    projectId: string
    entryId: string
    entryTitle: string | null
    draft: EntryDraft
    documentBodyText: string
    loading: boolean
    saving: boolean
    updateDraft: (updater: (current: EntryDraft) => EntryDraft) => void
}

export default function useEntrySummaryGeneration({
    aiPluginId,
    aiModel,
    projectId,
    entryId,
    entryTitle,
    draft,
    documentBodyText,
    loading,
    saving,
    updateDraft,
}: UseEntrySummaryGenerationOptions) {
    const {showAlert} = useAlert()
    const [generating, setGenerating] = useState(false)

    const generate = useCallback(async () => {
        if (generating || loading || saving) return
        if (!aiPluginId) {
            await showAlert('当前还没有可用的 AI 插件，请先在右侧 AI 面板选择或配置模型。', 'warning', 'nonInvasive', 2200)
            return
        }
        const fallbackTitle = normalizeComparableText(draft.title) || entryTitle || '未命名词条'
        const content = normalizeComparableText(documentBodyText)
        if (!content) {
            await showAlert('正文为空，无法生成摘要。', 'warning', 'nonInvasive', 1800)
            return
        }
        setGenerating(true)
        try {
            const result = await ai_generate_entry_summary({
                pluginId: aiPluginId,
                projectId,
                entryIds: [entryId],
                outputMode: 'entry_field',
                focus: `请概括词条《${fallbackTitle}》的核心设定，输出适合放在摘要字段中的中文。`,
                draftEntry: {
                    entryId,
                    title: fallbackTitle,
                    summary: normalizeComparableText(draft.summary) || null,
                    content: documentBodyText,
                    entryType: draft.type,
                },
                model: aiModel || null,
            })
            const nextSummary = normalizeComparableText(result.summaryMarkdown)
            if (!nextSummary) throw new Error('AI 未返回可用摘要')
            updateDraft(current => normalizeComparableText(current.summary) === nextSummary
                ? current
                : {...current, summary: nextSummary})
            await showAlert('已生成摘要', 'success', 'nonInvasive', 1500)
        } catch (error) {
            logger.error('generate summary failed', error)
            await showAlert(error instanceof Error ? error.message : '生成摘要失败', 'error', 'nonInvasive', 2200)
        } finally {
            setGenerating(false)
        }
    }, [aiModel, aiPluginId, documentBodyText, draft.summary, draft.title, draft.type, entryId, entryTitle, generating, loading, projectId, saving, showAlert, updateDraft])

    return {generating, generate}
}
