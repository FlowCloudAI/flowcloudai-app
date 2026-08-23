/*
 * 报告复制。两端共用。
 *
 * dev 走的是 http://<局域网 IP>:5175 / :5176，不是安全上下文，
 * navigator.clipboard 多半不存在，所以 execCommand 不是"兜底"而是主路径。
 */

export function copyText(text: string): boolean {
    try {
        if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        /* 非安全上下文下访问 clipboard 可能直接抛，落到 execCommand */
    }
    const holder = document.createElement('textarea')
    holder.value = text
    /*
     * readOnly 很关键：聚焦一个可编辑输入框会把键盘弹出来，
     * 而"复制报告"这个动作本身就发生在实验过程中，会污染点击统计和采样。
     */
    holder.readOnly = true
    holder.style.position = 'fixed'
    holder.style.top = '0'
    holder.style.left = '0'
    holder.style.opacity = '0'
    document.body.appendChild(holder)
    holder.select()
    holder.setSelectionRange(0, text.length)
    let ok = false
    try {
        ok = document.execCommand('copy')
    } catch {
        ok = false
    }
    holder.blur()
    document.body.removeChild(holder)
    return ok
}
