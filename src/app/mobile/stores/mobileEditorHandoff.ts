/**
 * 子编辑页把结果交回打开它的页面。
 *
 * 移动端把「新建标签 / 新建词条类型」这类重操作从浮层改成了独立页面，浮层原来靠
 * onSaved 回调直接把新建对象递给调用方，页面栈没有这条通路：子页 pop 之后，
 * 上一页只是重新可见，拿不到返回值。
 *
 * 这里用一个按 token 订阅的极小 store 补上这条通路（不是 CustomEvent —— 见
 * AGENTS §5.1：跨页状态一律走 store）。调用方在打开子页时生成 token 并订阅，
 * 子页保存成功后 publish，订阅方立即收到并消费掉。
 */
type Listener = (value: unknown) => void

const listeners = new Map<string, Set<Listener>>()
/** 结果先于订阅到达时暂存（正常不会发生，但页面重挂载时可能错过一拍）。 */
const pending = new Map<string, unknown>()

export function publishMobileEditorResult(token: string, value: unknown): void {
    const set = listeners.get(token)
    if (!set || set.size === 0) {
        pending.set(token, value)
        return
    }
    for (const listener of set) listener(value)
}

export function subscribeMobileEditorResult(token: string, listener: Listener): () => void {
    let set = listeners.get(token)
    if (!set) {
        set = new Set()
        listeners.set(token, set)
    }
    set.add(listener)

    const buffered = pending.get(token)
    if (buffered !== undefined) {
        pending.delete(token)
        listener(buffered)
    }

    return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(token)
    }
}

let tokenSeed = 0

/** 生成一个进程内唯一的 token；页面参数里带着它，子页保存时按它回递。 */
export function createMobileEditorToken(prefix: string): string {
    tokenSeed += 1
    return `${prefix}:${tokenSeed}`
}
