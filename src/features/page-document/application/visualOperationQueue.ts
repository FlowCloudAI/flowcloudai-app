// 本模块让连续可视操作按接收顺序串行执行；单项失败不会阻塞队列中的后续操作。
export interface VisualOperationQueue {
    enqueue<T>(operation: () => Promise<T>): Promise<T>
}

export function createVisualOperationQueue(): VisualOperationQueue {
    let tail: Promise<void> = Promise.resolve()

    return {
        enqueue<T>(operation: () => Promise<T>): Promise<T> {
            const result = tail.then(operation)
            tail = result.then(
                () => undefined,
                () => undefined,
            )
            return result
        },
    }
}
