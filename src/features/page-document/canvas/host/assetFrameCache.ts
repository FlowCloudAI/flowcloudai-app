// 本模块按项目和稳定资产 ID 合并后端读取；缓存仅活在当前 iframe 会话内，不存储路径或运行时 URL。

import type {PageDocumentAssetFrame} from '../../../../api/pageDocument.ts'

const CACHE_MAX_ENTRIES = 16

export class CanvasAssetFrameCache {
    private readonly frames = new Map<string, PageDocumentAssetFrame>()
    private readonly pending = new Map<string, Promise<PageDocumentAssetFrame>>()
    private disposed = false
    private readonly sessionToken: string

    constructor(sessionToken: string) {
        this.sessionToken = sessionToken
    }

    async read(
        projectId: string,
        assetId: string,
        fetchFrame: (projectId: string, assetId: string) => Promise<PageDocumentAssetFrame>,
    ): Promise<PageDocumentAssetFrame> {
        if (this.disposed) throw new Error('画布会话已结束')
        const key = `${this.sessionToken}:${projectId.toLowerCase()}:${assetId.toLowerCase()}`
        const cached = this.frames.get(key)
        if (cached) {
            this.frames.delete(key)
            this.frames.set(key, cached)
            return cached
        }
        const running = this.pending.get(key)
        if (running) return running
        const request = fetchFrame(projectId, assetId).then(frame => {
            if (frame.assetId.toLowerCase() !== assetId.toLowerCase()) throw new Error('资产回执身份不匹配')
            if (!this.disposed) {
                this.frames.set(key, frame)
                if (this.frames.size > CACHE_MAX_ENTRIES) this.frames.delete(this.frames.keys().next().value!)
            }
            return frame
        }).finally(() => this.pending.delete(key))
        this.pending.set(key, request)
        return request
    }

    clear(): void {
        this.disposed = true
        this.frames.clear()
        this.pending.clear()
    }
}
