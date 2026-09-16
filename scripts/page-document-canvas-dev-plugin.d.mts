// Vite 配置只需要开发插件的公开签名；实现保留为可由 Node 直接加载的 ESM。

import type {Plugin} from 'vite'

export function pageDocumentCanvasDevPlugin(repositoryRoot: string): Plugin
