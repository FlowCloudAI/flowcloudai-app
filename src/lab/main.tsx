/*
 * 键盘实验用的独立 React 入口。
 *
 * 它不接入应用的任何东西——没有 AppShell、没有 provider、没有 store、没有 flowcloudai-ui，
 * 目的是在真实的 Tauri WKWebView 里得到一块干净画布，只暴露键盘布局这一个问题。
 * 通过把 index.html 的入口指向本文件启用；实验结束后整个 src/lab 目录应删除。
 */

import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import LabShell from './LabShell'
import './LabShell.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

createRoot(container).render(
    <StrictMode>
        <LabShell/>
    </StrictMode>,
)
