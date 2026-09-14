// 本模块只封装可视 operation 的一次性乐观并发重试；源码保存与撤销重做仍保留严格冲突语义。
export interface ConflictRetryOutcome<Context, Value> {
    context: Context
    value: Value
    retried: boolean
}

export async function runWithOneConflictRetry<Context, Value>({
    initialContext,
    execute,
    refresh,
    isConflict,
}: {
    initialContext: Context
    execute: (context: Context) => Promise<Value>
    refresh: () => Promise<Context>
    isConflict: (error: unknown) => boolean
}): Promise<ConflictRetryOutcome<Context, Value>> {
    try {
        return {
            context: initialContext,
            value: await execute(initialContext),
            retried: false,
        }
    } catch (error) {
        if (!isConflict(error)) throw error
        const refreshed = await refresh()
        return {
            context: refreshed,
            value: await execute(refreshed),
            retried: true,
        }
    }
}
