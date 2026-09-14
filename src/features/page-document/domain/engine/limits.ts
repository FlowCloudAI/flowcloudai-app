// 本模块集中声明 P0F 文档/API 安全限额；这些数值是防滥用默认值，不是性能实测结论。
import {ENTRY_ASSET_MAX_BYTES} from '../contract.ts'

export const DOCUMENT_LIMITS = {
    requestBytes: 1024 * 1024,
    articleBytes: 512 * 1024,
    styleBytes: 128 * 1024,
    metadataTextBytes: 16 * 1024,
    managedNodes: 512,
    cssRules: 512,
    sourceEdits: 256,
    documentOperations: 128,
    assetBytes: ENTRY_ASSET_MAX_BYTES,
    assetUploadRequestBytes: ENTRY_ASSET_MAX_BYTES + 256 * 1024,
    assetsPerEntry: 200,
    aiConversationBytes: 512 * 1024,
} as const
