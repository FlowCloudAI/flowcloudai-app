import assert from 'node:assert/strict'
import test from 'node:test'

import {adoptInstalledPluginDefaults} from './pluginDefaultAdoption.ts'

const plugin = (id, models, defaultModel = null, voices = []) => ({
    id,
    name: id,
    kind: 'llm',
    models,
    model_infos: [],
    default_model: defaultModel,
    supported_sizes: [],
    supported_voices: voices,
})

const catalog = {
    llmPlugins: [plugin('llm-a', ['a-1', 'a-2'], 'a-2'), plugin('llm-b', ['b-1'])],
    imagePlugins: [plugin('img-a', ['img-1'])],
    ttsPlugins: [plugin('tts-a', ['tts-1'], null, ['voice-x'])],
}

const settingsWith = patch => ({
    llm: {plugin_id: null, default_model: null},
    image: {plugin_id: null, default_model: null},
    tts: {plugin_id: null, default_model: null, voice_id: null},
    ...patch,
})

// 音色归一化的真实实现在 ttsVoice.ts，这里只要「不在清单里就丢掉」的行为。
const normalizeVoiceId = (p, voiceId) => (
    voiceId && p.supported_voices.includes(voiceId) ? voiceId : null
)

test('第一次装插件时接管本类目默认值，并优先用插件声明的默认模型', () => {
    const next = adoptInstalledPluginDefaults(settingsWith({}), catalog, 'llm-a', normalizeVoiceId)

    assert.equal(next?.llm.plugin_id, 'llm-a')
    assert.equal(next?.llm.default_model, 'a-2')
    // 只动命中的那一类，其余保持原样。
    assert.equal(next?.image.plugin_id, null)
    assert.equal(next?.tts.plugin_id, null)
})

test('插件没声明默认模型时退回模型列表第一项', () => {
    const next = adoptInstalledPluginDefaults(settingsWith({}), catalog, 'llm-b', normalizeVoiceId)

    assert.equal(next?.llm.default_model, 'b-1')
})

test('已经选好默认插件时，后续安装不改变它', () => {
    const settings = settingsWith({llm: {plugin_id: 'llm-a', default_model: 'a-1'}})

    assert.equal(adoptInstalledPluginDefaults(settings, catalog, 'llm-b', normalizeVoiceId), null)
})

test('默认插件已被卸载（id 残留在设置里）时按没设过处理', () => {
    const settings = settingsWith({llm: {plugin_id: 'llm-gone', default_model: 'gone-1'}})
    const next = adoptInstalledPluginDefaults(settings, catalog, 'llm-b', normalizeVoiceId)

    assert.equal(next?.llm.plugin_id, 'llm-b')
    assert.equal(next?.llm.default_model, 'b-1')
})

test('接管语音插件时一并归一化音色，丢掉新插件不支持的旧值', () => {
    const settings = settingsWith({tts: {plugin_id: null, default_model: null, voice_id: 'voice-old'}})
    const next = adoptInstalledPluginDefaults(settings, catalog, 'tts-a', normalizeVoiceId)

    assert.equal(next?.tts.plugin_id, 'tts-a')
    assert.equal(next?.tts.default_model, 'tts-1')
    assert.equal(next?.tts.voice_id, null)
})

test('装的插件不在任何清单里时不写盘', () => {
    assert.equal(adoptInstalledPluginDefaults(settingsWith({}), catalog, 'unknown', normalizeVoiceId), null)
})
