/*
 * 对话记忆用量：把「已用多少 / 上限多少 / 百分比怎么算」收在一处，桌面与移动端共用。
 *
 * 这段逻辑原先内联在桌面端 AIChatContent.tsx 里，移动端因此完全没有用量指示，
 * 用户只有在撞上上下文上限、看到报错之后才知道对话记忆满了。
 *
 * 两个来源：服务端返回的 usage 与本地估算，取较大值——估算只在服务端还没回过
 * usage（或本轮新增内容尚未计入）时兜底，不能反过来把真实值压小。
 */
import {useEffect, useMemo, useState} from 'react'
import type {PluginInfo} from '../../../api'
import type {Conversation, Message} from '../model/AiControllerTypes'
import {estimateMessagesTokens, formatTokenCount, resolveTokenCalibrationFactor} from '../lib/contextUsage'

/** 估算防抖：输入框每敲一个字都会触发重算，不防抖会把 IPC 打满。 */
const CONTEXT_ESTIMATE_DEBOUNCE_MS = 150

export interface AiContextUsage {
    /** 形如 12% / <1% / ?，上限未知时为 ? 或 0%。 */
    label: string
    percent: number
    /** 画环用：大于 0 但不足 1% 时抬到 1，否则环上看不出已经开始占用。 */
    ringPercent: number
    /** 悬浮/展开时的完整说明，含数据来源与绝对值。 */
    title: string
    usedTokens: number
    contextWindowTokens: number | null
    /** 服务返回 / 核心估算。 */
    source: string
}

export function formatContextUsagePercent(percent: number, usedTokens: number): string {
    if (usedTokens > 0 && percent > 0 && percent < 1) return '<1%'
    return `${Math.min(100, Math.max(0, Math.round(percent)))}%`
}

interface AiContextUsageOptions {
    messages: Message[]
    inputValue: string
    activeConversation: Conversation | null | undefined
    plugins: PluginInfo[]
    selectedPlugin: string
    selectedModel: string
    tokenCalibrationFactors?: Record<string, number>
}

export function useAiContextUsage({
    messages,
    inputValue,
    activeConversation,
    plugins,
    selectedPlugin,
    selectedModel,
    tokenCalibrationFactors,
}: AiContextUsageOptions): {usage: AiContextUsage; hasModel: boolean} {
    const contextPluginInfo = plugins.find(plugin => plugin.id === (activeConversation?.pluginId ?? selectedPlugin))
    const contextModelId = activeConversation?.model || selectedModel
    const contextModelInfo = contextPluginInfo?.model_infos.find(modelInfo => modelInfo.id === contextModelId)
    const contextWindowTokens = contextModelInfo?.context_window_tokens ?? null
    const calibrationFactor = resolveTokenCalibrationFactor(
        tokenCalibrationFactors,
        contextPluginInfo?.id,
        contextModelId,
    )

    const latestUsage = useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const usage = messages[index].usage
            if (usage) return usage
        }
        return null
    }, [messages])

    const [estimatedContextTokens, setEstimatedContextTokens] = useState(0)
    const systemPrompt = activeConversation?.settings.systemPrompt ?? ''
    useEffect(() => {
        const estimatedMessages = [
            ...messages,
            ...(systemPrompt.trim() ? [{content: systemPrompt}] : []),
            ...(inputValue.trim() ? [{content: inputValue}] : []),
        ]
        if (estimatedMessages.length === 0) {
            setEstimatedContextTokens(0)
            return
        }

        let active = true
        const timer = window.setTimeout(() => {
            void estimateMessagesTokens(
                estimatedMessages,
                calibrationFactor,
                contextPluginInfo?.id,
                contextModelId,
            )
                .then(tokens => {
                    if (active) setEstimatedContextTokens(tokens)
                })
                .catch(() => {
                    if (active) setEstimatedContextTokens(0)
                })
        }, CONTEXT_ESTIMATE_DEBOUNCE_MS)
        return () => {
            active = false
            window.clearTimeout(timer)
        }
    }, [calibrationFactor, contextModelId, contextPluginInfo?.id, inputValue, messages, systemPrompt])

    const usage = useMemo<AiContextUsage>(() => {
        const usageTokens = latestUsage?.total_tokens ?? 0
        const usedTokens = Math.max(usageTokens, estimatedContextTokens)
        const source = latestUsage && usageTokens >= estimatedContextTokens ? '服务返回' : '核心估算'
        if (!contextWindowTokens || contextWindowTokens <= 0) {
            return {
                label: usedTokens > 0 ? '?' : '0%',
                percent: 0,
                ringPercent: 0,
                title: usedTokens > 0
                    ? `对话记忆容量信息未返回，已估算当前对话记忆约 ${formatTokenCount(usedTokens)}`
                    : '对话记忆容量信息未返回，暂以 0% 显示',
                usedTokens,
                contextWindowTokens: null,
                source,
            }
        }
        const percent = Math.min(100, Math.max(0, (usedTokens / contextWindowTokens) * 100))
        const label = formatContextUsagePercent(percent, usedTokens)
        return {
            label,
            percent,
            ringPercent: percent > 0 && percent < 1 ? 1 : percent,
            title: `对话记忆已用约 ${label}（${source} ${formatTokenCount(usedTokens)} / ${formatTokenCount(contextWindowTokens)}）`,
            usedTokens,
            contextWindowTokens,
            source,
        }
    }, [contextWindowTokens, estimatedContextTokens, latestUsage])

    return {usage, hasModel: Boolean(contextModelId)}
}
