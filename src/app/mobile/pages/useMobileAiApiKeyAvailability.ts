/*
 * 汇总移动 AI 对话页对访问密钥状态的订阅与后端复核。
 * 页面只消费稳定状态，设置变化和异步竞态在本 hook 内收口。
 */

import {useEffect, useState} from 'react'
import {setting_has_api_key} from '../../../api'
import {
    getAppSettingsSnapshot,
    subscribeAppSettings,
} from '../../../features/settings/appSettingsStore'
import {logger} from '../../../shared/logger'
import type {ApiKeyAvailability} from './MobileAiChatUi'

interface UseMobileAiApiKeyAvailabilityOptions {
    pluginId: string
    pluginsReady: boolean
    pluginUnavailable: boolean
}

export function useMobileAiApiKeyAvailability({
    pluginId,
    pluginsReady,
    pluginUnavailable,
}: UseMobileAiApiKeyAvailabilityOptions): ApiKeyAvailability {
    const [refreshTick, setRefreshTick] = useState(0)
    const [availability, setAvailability] = useState<ApiKeyAvailability>('unknown')

    useEffect(() => {
        if (!pluginsReady || pluginUnavailable || !pluginId) {
            setAvailability('unknown')
            return
        }

        let cancelled = false
        setAvailability('checking')
        setting_has_api_key(pluginId)
            .then(hasApiKey => {
                if (!cancelled) setAvailability(hasApiKey ? 'configured' : 'missing')
            })
            .catch(error => {
                logger.error('[MobileAiChat] API Key 状态检查失败', error)
                if (!cancelled) setAvailability('error')
            })

        return () => {
            cancelled = true
        }
    }, [pluginId, pluginUnavailable, pluginsReady, refreshTick])

    useEffect(() => subscribeAppSettings(() => {
        const hasApiKey = getAppSettingsSnapshot().apiKeyStatus[pluginId]
        setAvailability(hasApiKey ? 'configured' : 'missing')
        setRefreshTick(tick => tick + 1)
    }), [pluginId])

    return availability
}
