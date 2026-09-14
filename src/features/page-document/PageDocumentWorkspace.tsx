/** 页面文档工作区最小桌面壳：隔离画布、源码往返和持续保存状态由上层会话接入。 */
import {useMemo, useState} from 'react'
import {Button, ButtonToolbar, Input, Select, Slider, TabBar, Tree} from 'flowcloudai-ui'
import './pageDocumentWorkspace.css'

type Props={html:string; css?:string; onChange:(html:string)=>void; onSave?:()=>void; saving?:boolean; error?:string|null}
export default function PageDocumentWorkspace({html,css='',onChange,onSave,saving=false,error=null}:Props){
 const [mode,setMode]=useState<'visual'|'source'>('visual'); const [fontSize,setFontSize]=useState(16)
 const srcDoc=useMemo(()=>`<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`,[html,css])
 return <section className="page-document-workspace">
  <TabBar items={[{key:'start',label:'开始'},{key:'insert',label:'插入'},{key:'page',label:'页面'},{key:'view',label:'视图'}]} selectedKey="start" onSelectedKeyChange={()=>{}} />
  <ButtonToolbar><Button onClick={()=>setMode('visual')} variant={mode==='visual'?'primary':'secondary'}>画布</Button><Button onClick={()=>setMode('source')} variant={mode==='source'?'primary':'secondary'}>源码</Button><Select options={[{value:'normal',label:'正文'}]} value="normal" onValueChange={()=>{}}/><Input value={`${fontSize}px`} onValueChange={()=>{}}/><Slider min={10} max={48} value={fontSize} onValueChange={(v)=>setFontSize(Array.isArray(v)?v[0]:v)} /><Button onClick={onSave} disabled={saving}>{saving?'保存中…':'保存'}</Button></ButtonToolbar>
  <div className="page-document-body"><aside><Tree treeData={[{key:'root',title:'页面',children:[],raw:{id:'root',name:'页面',parent_id:null,sort_order:0}}]} selectedKey="root" onSelectedKeyChange={()=>{}} /></aside>{mode==='source'?<textarea className="page-document-source" value={html} onChange={e=>onChange(e.target.value)} />:<iframe title="页面文档画布" sandbox="allow-scripts" srcDoc={srcDoc} />}</div>
  <div className="page-document-status">{error?`保存失败：${error}`:saving?'保存中…':'草稿已就绪'}</div>
 </section>
}
