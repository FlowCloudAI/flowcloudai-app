// 本 hook 只加载词条信息浮层所需的语音选项；加载失败仍沿用原有的只读提示。

import {useEffect, useState} from 'react'
import {ai_list_plugins, type PluginInfo, setting_get_settings} from '../../../api'
import {logger} from '../../../shared/logger'

export interface EntryTtsVoiceState {
    plugins: PluginInfo[]
    defaultPluginId: string | null
    defaultModel: string | null
    hint: string
}

const DEFAULT_STATE: EntryTtsVoiceState = {
    plugins: [],
    defaultPluginId: null,
    defaultModel: null,
    hint: '请先在设置中选择默认 AI 语音插件',
}

export default function useEntryTtsVoiceState(): EntryTtsVoiceState {
    const [state, setState] = useState(DEFAULT_STATE)

    useEffect(() => {
        let cancelled = false
        void Promise.all([setting_get_settings(), ai_list_plugins('tts')])
            .then(([settings, plugins]) => {
                if (cancelled) return
                const ttsPlugins = plugins as PluginInfo[]
                setState({
                    plugins: ttsPlugins,
                    defaultPluginId: settings.tts.plugin_id,
                    defaultModel: settings.tts.default_model,
                    hint: ttsPlugins.length > 0 ? '' : '当前没有可用的 AI 语音插件',
                })
            })
            .catch(loadError => {
                if (cancelled) return
                logger.error('加载 TTS 音色列表失败', loadError)
                setState({
                    plugins: [],
                    defaultPluginId: null,
                    defaultModel: null,
                    hint: '音色列表加载失败',
                })
            })
        return () => {
            cancelled = true
        }
    }, [])

    return state
}
