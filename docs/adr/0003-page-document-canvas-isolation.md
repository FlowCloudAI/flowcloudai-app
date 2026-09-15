# ADR 0003：页面文档隔离画布

- 状态：提议，待原生验证
- 日期：2026-09-15

## 决策

页面文档画布采用独立 Vite 入口 `canvas.html`，由宿主以
`<iframe sandbox="allow-scripts" src="/canvas.html">` 装载。画布页面与 bridge 运行时都是构建产物，
作者 HTML/CSS 只在会话建立后通过 `postMessage` 进入画布。画布不启用
`allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`，因此标准要求它使用唯一的
opaque origin，且脚本、弹窗、表单和跨浏览上下文导航之外的沙箱限制继续生效。

画布页在全局 CSP 之外叠加 meta CSP：默认、连接、图片、字体、媒体、对象、frame、worker、manifest
和预取来源均为 `none`，`base-uri` 与 `form-action` 为 `none`；只为打包后的同来源 bridge 文件开放
`script-src 'self'`，只为经过校验后挂载的作者样式开放 `style-src 'unsafe-inline'`。本阶段不开放任何
图片来源，`fcasset://<uuid>` 在挂载前替换成不含 URL 的占位元素。两条策略同时生效，独立策略只能
收紧全局策略，不能扩大 `src-tauri/tauri.conf.json` 的权限。

作者内容经过两道相互独立的门。宿主正常路径先运行页面文档领域 guard；画布运行时仍在浏览器开始
解析或挂载前，以无网络副作用的源码解析器拒绝可执行元素、事件属性、资源 URL、表单和导航属性，
并把资产节点改成占位。只有隔离检查通过的节点和 CSS 才进入活文档；bridge 脚本从不拼入作者源码，
也不从预览 DOM 回写文档真值。

消息身份不能依赖 `event.origin`，因为画布是 opaque origin。宿主同时校验当前 iframe 的
`contentWindow`、协议版本、随机会话 token、单调请求序号和消息大小；画布只接受 `parent` 发送且
满足同一信封约束的命令。销毁画布或切换文档即轮换 token，旧 Window、旧 token、重放和乱序消息
全部失效。

## 方案比较

### A：`srcdoc` iframe

`sandbox="allow-scripts"` 在 WKWebView、WebView2 和 Android WebView 所遵循的 HTML 模型中都应设置
sandboxed origin flag，因而得到 opaque origin；三端实际行为仍待原生验证。CSP 3 的“local scheme
继承”算法要求 `srcdoc` 文档复制创建者当时的 CSP，所以宿主策略仍会约束它；画布内部的 meta CSP
还能继续收紧该副本。

这个方案的 bridge 可以改成同来源外部脚本，但动态 `srcdoc` 本身不是 Tauri 构建期遍历的 HTML
资产，Tauri 不会为其中的标签注入 nonce，也不会为动态内联脚本生成 hash。实验仓用内联 nonce
脚本的做法因此不能证明在本仓发布 CSP 下可用。即使改成外部脚本，安全骨架、作者内容和会话值仍
要在同一动态字符串里组装，审计边界较弱，所以不采用。

### B：blob URL iframe

blob URL 继承创建它的环境 origin；加上当前 sandbox 后仍应被强制为 opaque origin，三端实际行为
仍待原生验证。CSP 3 也把 `blob:` 列为需要继承创建者策略的本地方案，所以它不能绕开宿主 CSP。

当前全局策略没有为 frame 导航开放 `blob:`，`frame-src` 缺省回退到 `default-src 'self'`；URL 标准
又把 `blob:` 作为独立 scheme 处理，不能把 `'self'` 当成可移植的放行依据。满足该方案需要修改全局
CSP，这违反本决策的硬边界。blob 内的 HTML 也不属于 Tauri 嵌入资产，得不到构建期 HTML 处理，
所以不采用。

### C：独立打包页面

独立页面从应用打包来源加载；未加 sandbox 时它与宿主同源，加上当前 sandbox 后应成为 opaque
origin。WKWebView、WebView2 和 Android WebView 是否都保持该组合语义待原生验证。宿主现有
`default-src 'self'` 允许 iframe 请求这个打包页面，不需要修改全局 CSP。

Tauri 2.11.5 的资源服务会按所请求的 HTML 资产路径附加 CSP 响应头；`tauri-codegen` 2.6.3 在
构建期遍历 `frontendDist` 内全部 HTML/JS，为 HTML 注入 CSP 占位并记录本地 JS hash，运行时再按
页面替换 nonce/hash。因此 `canvas.html` 与 bridge 文件都处于 Tauri 可处理的静态资产集合中。
画布自己的 meta CSP 在源码中可检查，且开发和发布使用同一份安全骨架。这个方案把可信运行时与
作者字符串彻底分离，故采用 C。

## 开发与发布差异

发布构建中，Vite 多入口生成 `canvas.html` 及带内容 hash 的 bridge chunk，Tauri 再把整个 `dist`
作为嵌入资产处理并在响应中附加全局 CSP。这条路径由本仓依赖源码和构建产物检查证明；各原生
WebView 是否实际加载 bridge、同时执行响应头与 meta 两条策略，待原生验证。

开发模式的 `devUrl` 直接或经移动端代理读取 Vite 资源，不经过发布构建的嵌入资产集合，也没有
可依赖的发布期 JS hash 注入。画布 meta CSP 与 `script-src 'self'` 仍会约束 Vite 资源，但 HMR、
开发源码映射和代理行为不等同发布产物。因此浏览器预览和普通 dev server 只能验证协议逻辑，不能
作为发布 CSP 或原生隔离证据；macOS 与 Android 都必须用 debug 原生产物执行验收清单。

显式探针构建沿用现有脚本的父进程环境，无需修改构建脚本：

```sh
VITE_PAGE_DOCUMENT_CANVAS=1 npm run macos:build:debug
VITE_PAGE_DOCUMENT_CANVAS=1 npm run android:build:dev
```

默认 `npm run build` 只把 `index.html` 设为入口，并把业务页导入解析到空组件；启用时才加入
`canvas.html` 并解析真实入口。每次发布前应在默认 `dist/` 搜索“页面文档预览”“隔离探针”及
`page-document-canvas`，三者都不得出现。

## 依据

- HTML Standard 的 [iframe sandbox 规则](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
  规定：存在 sandbox 且没有 `allow-same-origin` 时使用唯一 opaque origin；只有显式 token 才恢复
  脚本、表单、弹窗和跨浏览上下文导航能力。
- CSP Level 3 的 [CSP inheriting to avoid bypasses](https://www.w3.org/TR/CSP/#initialize-document-csp)
  明确覆盖 `srcdoc`、`blob:`、`data:` 和 `about:blank`，并说明子文档复制策略列表；子文档自己的
  meta 策略只影响子文档。
- URL Standard 的 [Origin](https://url.spec.whatwg.org/#origin) 规定 blob URL 的 origin 来自其
  blob URL entry 环境；这不取消 iframe sandbox 的 opaque-origin 限制。
- Tauri 官方 [Content Security Policy](https://v2.tauri.app/security/csp/) 与
  [Configuration](https://v2.tauri.app/reference/config/#securityconfig) 说明构建期会为打包资产追加
  nonce/hash，并对构建应用的 HTML 注入 CSP。
- 本仓 `cargo tree -p tauri -p tauri-codegen -p tauri-utils` 实测依赖为 Tauri 2.11.5、
  `tauri-codegen` 2.6.3、`tauri-utils` 2.9.3。对应依赖源码中
  `tauri-codegen/src/context.rs::map_core_assets` 遍历 HTML，
  `tauri-codegen/src/embedded_assets.rs::CspHashes` 记录 JS hash，
  `tauri/src/manager/mod.rs::get_asset` 按 HTML 路径生成 CSP，
  `tauri/src/protocol/tauri.rs` 把它写成 `Content-Security-Policy` 响应头。
- 本仓 `src-tauri/tauri.conf.json` 的全局策略当前为 `default-src 'self'`，脚本仅开放 `self` 与
  `unsafe-eval`，没有开放 `blob:` frame 来源；三个平台覆盖配置都没有另改 security。

## 待原生验证

- macOS WKWebView、Windows WebView2、Android WebView 是否都把打包子页面置为 opaque origin，
  且 `event.origin` 为不可用于鉴权的值。
- 三端是否都让 Tauri 的 CSP 响应头与画布 meta CSP 取交集，并允许构建期生成的 bridge chunk。
- 三端是否在拒绝作者网络、表单和导航时不产生请求、不替换画布页面，也不触发宿主顶层导航。
- debug 原生产物的页面 URL、Vite 资源 URL 与 `script-src 'self'` 在 macOS 和 Android 上是否一致。
- iframe 销毁、重建、旋转和后台恢复时，Window 身份与消息时序是否符合协议生命周期假设。

这些项目未通过前，本 ADR 保持“提议，待原生验证”，M6 不能写成原生验收完成。
