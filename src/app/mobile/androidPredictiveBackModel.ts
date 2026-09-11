/*
 * Android 预测式返回的纯判定模型。
 *
 * 原生事件监听与 React 生命周期留在 hook；这里固定准备结果、手势代次与最终提交之间的语义，
 * 让确认框和新手势交错时无需 DOM 环境也能回归。
 */

export type AndroidPredictiveBackInvokeResolution = 'commit' | 'cancel' | 'stale'

interface ResolveAndroidPredictiveBackInvokeOptions {
    startedAttempt: number
    currentAttempt: number
    preparationAllowed: boolean
}

export function resolveAndroidPredictiveBackInvoke({
    startedAttempt,
    currentAttempt,
    preparationAllowed,
}: ResolveAndroidPredictiveBackInvokeOptions): AndroidPredictiveBackInvokeResolution {
    if (startedAttempt !== currentAttempt) return 'stale'
    return preparationAllowed ? 'commit' : 'cancel'
}
