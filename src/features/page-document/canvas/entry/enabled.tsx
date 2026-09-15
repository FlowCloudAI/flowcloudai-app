// 只有 VITE_PAGE_DOCUMENT_CANVAS=1 时，Vite 才把此实现替换到业务页面入口。

export {PageDocumentPreviewSection as PageDocumentCanvasEntry} from '../development/PageDocumentPreviewSection.tsx'
export type {PageDocumentCanvasEntryProps} from './types.ts'
