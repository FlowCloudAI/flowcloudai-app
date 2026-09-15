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
和预取来源均为 `none`，`base-uri` 与 `form-action` 为 `none`；`script-src` 只接受构建产物中唯一内联
脚本的精确 SHA-256，`style-src` 只为运行时动态挂载的可信样式和经过校验的作者样式开放
`'unsafe-inline'`。本阶段不开放任何图片来源，`fcasset://<uuid>` 在挂载前替换成不含 URL 的占位
元素。两条策略同时生效，独立策略只能收紧全局策略，不能扩大 `src-tauri/tauri.conf.json` 的权限。

构建器先把运行时编译为 IIFE，再转义其中可能结束 HTML 脚本元素的 `</script>` 字面量，按 Tauri
相同的 CRLF / 孤立 CR 转 LF 规则计算哈希，并把最终文本写成 `canvas.html` 唯一的内联脚本。源码
HTML 只保留安全骨架与占位，不含外链脚本、样式表或 `style` 元素。运行时启动后才创建运行时样式
和作者样式两个 `style` 元素；这避免 Tauri 为静态 `style` 注入 nonce 后使 CSP 3 规定的
`'unsafe-inline'` 失效，进而拦截动态样式和作者的 `style` 属性。

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
origin。macOS WKWebView 已由 2026-09-15 的 `'self'` 不匹配证据确认该组合语义；WebView2 和
Android WebView 仍待原生验证。宿主现有 `default-src 'self'` 允许 iframe 请求这个打包页面，不需要
修改全局 CSP。

Tauri 2.11.5 的资源服务会按所请求的 HTML 资产路径附加 CSP 响应头；`tauri-codegen` 2.6.3 在
构建期遍历 `frontendDist` 内全部 HTML。它先向静态 `style` 元素注入 nonce，再按 HTML 路径记录
每个非空内联 `script` 归一化后的 SHA-256；运行时据此生成该页面专属的响应头策略。因此带内联
运行时的 `canvas.html` 处于 Tauri 可处理的静态资产集合中，独立 meta CSP 也能在构建产物检查中
复算验证。这个方案把可信运行时与作者字符串彻底分离，故采用 C。

## 开发与发布差异

开关构建中，独立 Vite 配置先生成临时 IIFE，随后 `scripts/build-page-document-canvas.mjs` 把运行时
内嵌进 `canvas.html`、写入精确 meta CSP 哈希并删除临时 JS/CSS。Tauri 再把整个 `dist` 作为嵌入
资产处理，并为这个 HTML 的同一内联脚本向响应头追加哈希。这条路径由依赖源码和构建产物检查
证明；Android WebView 与 Windows WebView2 是否同时接受响应头和 meta 两条策略仍待原生验证。

开发模式不支持画布。`devUrl` 直接或经移动端代理读取 Vite 资源，既不执行上述追加构建脚本，也不
经过 Tauri 的嵌入资产与页面专属哈希处理，所以启用开关的普通 Vite dev server 不会生成可加载的
`canvas.html`。协议逻辑由 Node 测试覆盖；发布 CSP 与隔离行为只能使用带开关的 debug 原生产物
验收。

显式探针构建沿用现有脚本的父进程环境，无需修改构建脚本：

```sh
VITE_PAGE_DOCUMENT_CANVAS=1 npm run macos:build:debug
VITE_PAGE_DOCUMENT_CANVAS=1 npm run android:build:dev
```

默认 `npm run build` 只把 `index.html` 设为入口，并把业务页导入解析到空组件；启用时先构建宿主，
再由独立配置和组装脚本向 `dist/` 追加只含单个内联 IIFE 的 `canvas.html`。每次发布前应在默认
`dist/` 搜索“页面文档预览”“隔离探针”及 `page-document-canvas`，三者都不得出现。

## CORS 与 opaque origin

`sandbox="allow-scripts"` 没有 `allow-same-origin`，所以画布发出的跨来源模式请求以 opaque origin
参与检查，在 Chromium 内核中对应 `Origin: null`。Vite 多入口此前为 `canvas.html` 生成
`type="module"`、`crossorigin` 和 `modulepreload`；模块脚本必须通过 CORS，不能依赖开发服务器默认
放开的 CORS 推断发布产物可用。

本仓使用的 Tauri 2.11.5 在 `tauri/src/protocol/tauri.rs:169` 为全部协议资源固定返回
`Access-Control-Allow-Origin: <主窗口 origin>`，与 `null` 不匹配。把运行时改为外部经典 IIFE
消除了模块 CORS 前置条件，但没有解决 opaque origin 下 CSP 的来源匹配。

2026-09-15 用户在 macOS 调试构建的 Safari Web Inspector 中完成第一次原生验证，得到以下报错，
每条各出现两次，分别来自 Tauri 响应头策略与画布 meta 策略：

```text
Refused to load tauri://localhost/canvas/runtime.css because it does not appear in the style-src directive of the Content Security Policy. (x2)
Refused to load tauri://localhost/canvas/runtime.js because it does not appear in the script-src directive of the Content Security Policy. (x2)
```

这证明 WKWebView 中 opaque-origin 画布的 `'self'` 不匹配 `tauri://localhost`。最终方案不再发起
运行时子资源请求：开关构建把 IIFE 写成唯一内联脚本，meta `script-src` 只保留该脚本的哈希；
运行时 CSS 一并进入脚本并动态创建 `style`。产物检查复算哈希，拒绝外链脚本、样式表、静态
`style`、模块标记、`process.env` 和遗留的 `canvas/runtime.js`、`canvas/runtime.css`。

同日用户用重新打包的 macOS 调试构建复核后，CSP 拒绝已经消失，但 Safari Web Inspector 连续两次
记录了新的启动错误：

```text
[Error] Error: 隔离画布缺少可信启动参数。
（匿名函数） (canvas.html:13126)
全局代码 (canvas.html:13238)
```

原因是 `7eef3b9` 把运行时从带 `defer` 的外链经典脚本改成了 `head` 内的内联脚本。内联脚本不支持
`defer`，执行时 `body` 尚未解析，因而找不到 `#page-document-canvas-root`。画布骨架现将唯一内联脚本
放在 `body` 内的画布根节点之后，运行时仍以 `DOMContentLoaded` 作为 `readyState === 'loading'` 时的
兜底；该事件早于 iframe `load`，因此消息监听会先于宿主在 `load` 回调中发送首个 `render` 完成
注册。由此增加一条构建不变量：内联脚本必须位于画布根节点之后。

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
  `tauri-codegen/src/context.rs::map_core_assets` 遍历 HTML，先调用 `inject_nonce_token`，再由
  `inject_script_hashes` 使用 `tauri_utils::html2::normalize_script_for_csp` 归一化换行并记录内联
  JS hash；`tauri/src/manager/mod.rs::replace_csp_nonce` 在页面含对应 nonce 或 hash 时向响应头指令
  追加 `'self'`、nonce/hash；`tauri/src/protocol/tauri.rs` 把策略写成
  `Content-Security-Policy` 响应头。
- CSP Level 3 的 [`style-src`](https://www.w3.org/TR/CSP3/#directive-style-src) 处理规定：指令一旦
  含 nonce 或 hash source，`'unsafe-inline'` 就不再作为行内样式的通用放行。因此骨架 HTML 不放静态
  `style`，避免 Tauri 生成只覆盖静态元素的 nonce 后阻断动态样式和作者 `style` 属性。
- 本仓 `src-tauri/tauri.conf.json` 的全局策略当前为 `default-src 'self'`，脚本仅开放 `self` 与
  `unsafe-eval`，没有开放 `blob:` frame 来源；三个平台覆盖配置都没有另改 security。

## 待原生验证

- Windows WebView2、Android WebView 是否也把打包子页面置为 opaque origin、让 `'self'` 不匹配
  应用协议资源，且 `event.origin` 为不可用于鉴权的值。
- Android WebView 与 Windows WebView2 是否让 Tauri 响应头和画布 meta CSP 取交集，并接受同一
  内联脚本哈希。
- 经过隔离层保留的作者行内 `style` 属性在 macOS、Android 和 Windows 打包版中是否生效。
- 三端是否在拒绝作者网络、表单和导航时不产生请求、不替换画布页面，也不触发宿主顶层导航。
- iframe 销毁、重建、旋转和后台恢复时，Window 身份与消息时序是否符合协议生命周期假设。

这些项目未通过前，本 ADR 保持“提议，待原生验证”，M6 不能写成原生验收完成。
