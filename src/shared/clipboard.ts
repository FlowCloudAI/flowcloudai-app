/*
 * 复制文本到剪贴板。
 *
 * 不能只用 navigator.clipboard：Android 的 Tauri WebView 里它存在但会抛
 * NotAllowedError（真机 Xiaomi / Android 16 / WebView 143 实测），于是所有走异步
 * Clipboard API 的复制按钮在手机上都是「点了报错」。这里保留它作为首选（桌面与 iOS
 * 正常），失败后回落到 execCommand('copy')——该 API 虽已废弃，但在 WebView 里仍是
 * 唯一不需要额外插件与权限的可用路径。
 *
 * 回落路径要求同步执行在用户手势的调用栈里，所以整段不要再插入 await。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) return false

    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // 交给下面的回落，不在这里记日志：Android 上这条必然失败，记了只是噪音。
    }

    try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        // 不能用 display:none / visibility:hidden，否则选区为空，execCommand 无效。
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.top = '0'
        textarea.style.left = '0'
        textarea.style.width = '1px'
        textarea.style.height = '1px'
        textarea.style.padding = '0'
        textarea.style.border = 'none'
        textarea.style.outline = 'none'
        textarea.style.boxShadow = 'none'
        textarea.style.background = 'transparent'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)

        textarea.focus({preventScroll: true})
        textarea.setSelectionRange(0, text.length)
        const copied = document.execCommand('copy')
        textarea.remove()
        return copied
    } catch {
        return false
    }
}
