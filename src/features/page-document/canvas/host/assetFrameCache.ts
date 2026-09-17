// 本模块按项目和稳定资产 ID 合并后端读取；缓存仅活在当前 iframe 会话内，不存储路径或运行时 URL。

import type {PageDocumentAssetFrame} from '../../../../api/pageDocument.ts'

const CACHE_MAX_ENTRIES = 16
export type CanvasAssetFrameResult =
    | {status: 'ready'; frame: PageDocumentAssetFrame}
    | {status: 'unavailable' | 'invalid'}

export class CanvasAssetFrameCache {
    private readonly frames = new Map<string, CanvasAssetFrameResult>()
    private readonly pending = new Map<string, Promise<CanvasAssetFrameResult>>()
    private disposed = false
    private active = false
    private disposalTimer: ReturnType<typeof setTimeout> | null = null
    private readonly sessionToken: string

    constructor(sessionToken: string) {
        this.sessionToken = sessionToken
    }

    activate(): void {
        if (this.disposed) throw new Error('画布会话已结束')
        if (this.disposalTimer !== null) clearTimeout(this.disposalTimer)
        this.disposalTimer = null
        this.active = true
    }

    deactivate(): void {
        this.active = false
        if (this.disposalTimer !== null) clearTimeout(this.disposalTimer)
        // StrictMode 与 Fast Refresh 可在同一任务内重放 effect；下一任务才销毁真正离开的会话。
        this.disposalTimer = setTimeout(() => {
            this.disposalTimer = null
            if (!this.active) this.clear()
        }, 0)
    }

    isActive(): boolean {
        return this.active && !this.disposed
    }

    async read(
        projectId: string,
        assetId: string,
        fetchFrame: (projectId: string, assetId: string) => Promise<PageDocumentAssetFrame>,
        classifyFailure: (error: unknown) => 'unavailable' | 'invalid' = () => 'unavailable',
    ): Promise<CanvasAssetFrameResult> {
        if (!this.isActive()) throw new Error('画布会话已结束')
        const key = `${this.sessionToken}:${projectId.toLowerCase()}:${assetId.toLowerCase()}`
        const cached = this.frames.get(key)
        if (cached) {
            this.frames.delete(key)
            this.frames.set(key, cached)
            return cached
        }
        const running = this.pending.get(key)
        if (running) return running
        const request = fetchFrame(projectId, assetId).then<CanvasAssetFrameResult>(frame => {
            if (frame.assetId.toLowerCase() !== assetId.toLowerCase()) throw new Error('资产回执身份不匹配')
            return {status: 'ready', frame}
        }).catch((error): CanvasAssetFrameResult => ({status: classifyFailure(error)})).then(result => {
            if (this.isActive()) {
                this.frames.set(key, result)
                if (this.frames.size > CACHE_MAX_ENTRIES) this.frames.delete(this.frames.keys().next().value!)
            }
            return result
        }).finally(() => this.pending.delete(key))
        this.pending.set(key, request)
        return request
    }

    clear(): void {
        if (this.disposalTimer !== null) clearTimeout(this.disposalTimer)
        this.disposalTimer = null
        this.disposed = true
        this.active = false
        this.frames.clear()
        this.pending.clear()
    }
}
