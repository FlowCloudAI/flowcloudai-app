/*
 * 键盘实验用的独立 React 入口（**iOS 专用**）。
 *
 * 它不接入应用的任何东西——没有 AppShell、没有 provider、没有 store、没有 flowcloudai-ui，
 * 目的是在真实的 Tauri WKWebView 里得到一块干净画布，只暴露键盘布局这一个问题。
 * 通过把 index.html 的入口指向本文件启用；实验结束后整个 src/lab 目录应删除。
 *
 * Android 侧曾有一份对应的实验页，结论已落到
 * docs/devlog/2026-08-23-android-软键盘布局接管.md（工作区根仓），页面本身已删除。
 */

import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import IosLab from './ios/IosLab'
import './shared/lab.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 容器')

createRoot(container).render(
    <StrictMode>
        <IosLab/>
    </StrictMode>,
)
