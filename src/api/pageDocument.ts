/** 页面文档 API 适配层：UI 不直接调用 Tauri command，便于桌面与测试替换。 */
import {invoke} from '@tauri-apps/api/core'
export type PageDocument = {entryId:string; projectId:string; html:string; css:string; derivedText:string; revision:number; modifiedBy:string; updatedAt:string}
export type SavePageDocumentInput = {entryId:string; projectId:string; html:string; css:string; expectedRevision?:number; requestKey:string; modifiedBy?:string}
export function pageDocumentReadEntry(entryId:string){return invoke<PageDocument|null>('page_document_read_entry',{entryId})}
export function pageDocumentSaveEntry(input:SavePageDocumentInput){return invoke('page_document_save_entry',{input})}
export function pageDocumentValidate(html:string,css:string,projectId?:string){return invoke<{valid:boolean; diagnostics:Array<{category:string; message:string}>}>('page_document_validate',{html,css,projectId})}
