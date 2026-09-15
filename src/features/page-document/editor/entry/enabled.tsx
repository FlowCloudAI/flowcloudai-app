// 只有显式打开页面文档画布构建开关时，Vite 才把真实编辑实现接入词条页。

export {PageDocumentEditor as PageDocumentEditorEntry} from '../../components/PageDocumentEditor.tsx'
export {PageDocumentProjectSidebar} from '../workspace/PageDocumentProjectSidebar.tsx'
export type {PageDocumentEditorEntryProps} from './types.ts'
export const PAGE_DOCUMENT_EDITOR_ENABLED = true
