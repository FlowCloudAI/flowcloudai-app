/**
 * 新装插件是否该接管本类目的默认模型。
 *
 * 纯函数，不碰 store 也不写盘，方便直接单测；写盘在 pluginCatalogStore 里做。
 */
import type {AppSettings, PluginInfo} from '../../api'

export interface PluginDefaultCatalog {
    llmPlugins: PluginInfo[]
    imagePlugins: PluginInfo[]
    ttsPlugins: PluginInfo[]
}

/** 插件自己声明的默认模型优先，没声明就取模型列表第一项。 */
function firstModelOf(plugin: PluginInfo): string | null {
    return plugin.default_model ?? plugin.models[0] ?? null
}

/**
 * 判断某一类目当前有没有**可用**的默认插件。
 *
 * 空 id 是没设过；指向一个已经不在清单里的 id 同样算没有——卸载不清设置
 * （见 `src-tauri/src/apis/plugins/local.rs` 的 plugin_uninstall），
 * 残留 id 一个模型都选不出来，和没设过是一回事。
 */
function needsDefault(configuredId: string | null, plugins: PluginInfo[]): boolean {
    return !configuredId || !plugins.some(plugin => plugin.id === configuredId)
}

/**
 * 刚装上的插件在本类目还没有可用默认值时接管它，返回改过的 settings；无需改动时返回 null。
 *
 * 只在「没有可用默认值」时接管，所以**后续安装不会顶掉用户已经选好的插件**。
 * 第一次装完就能直接用 AI，不必再进模型管理点一遍。
 *
 * 一个插件只会落在一个类目里，但三类各判各的，多类目插件也能各就各位。
 */
export function adoptInstalledPluginDefaults(
    settings: AppSettings,
    catalog: PluginDefaultCatalog,
    pluginId: string,
    /** 音色要跟着插件走：旧值多半不在新插件的清单里，留着会合成失败。 */
    normalizeVoiceId: (plugin: PluginInfo, voiceId: string | null) => string | null,
): AppSettings | null {
    let next = settings

    const llmPlugin = catalog.llmPlugins.find(plugin => plugin.id === pluginId)
    if (llmPlugin && needsDefault(settings.llm.plugin_id, catalog.llmPlugins)) {
        next = {...next, llm: {...next.llm, plugin_id: pluginId, default_model: firstModelOf(llmPlugin)}}
    }

    const imagePlugin = catalog.imagePlugins.find(plugin => plugin.id === pluginId)
    if (imagePlugin && needsDefault(settings.image.plugin_id, catalog.imagePlugins)) {
        next = {...next, image: {...next.image, plugin_id: pluginId, default_model: firstModelOf(imagePlugin)}}
    }

    const ttsPlugin = catalog.ttsPlugins.find(plugin => plugin.id === pluginId)
    if (ttsPlugin && needsDefault(settings.tts.plugin_id, catalog.ttsPlugins)) {
        next = {
            ...next,
            tts: {
                ...next.tts,
                plugin_id: pluginId,
                default_model: firstModelOf(ttsPlugin),
                voice_id: normalizeVoiceId(ttsPlugin, next.tts.voice_id),
            },
        }
    }

    return next === settings ? null : next
}
