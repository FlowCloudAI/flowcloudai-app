/** 插件类型文案。插件管理页与插件库页共用，避免两处各写一份且写法不一致。 */
export function getPluginKindLabel(kind: string): string {
    if (kind.includes('image')) return 'AI 绘图'
    if (kind.includes('tts')) return 'AI 语音'
    return 'AI 对话'
}
