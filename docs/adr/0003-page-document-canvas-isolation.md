# ADR 0003：页面文档隔离画布

- 状态：提议；macOS、Android 已原生验收，Windows 待验证
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

画布默认保持只读，只有收到通过上述信封、来源 Window 与序号校验的 `set-editing` 命令后，运行时
才为 paragraph、heading、list-item 和 table-cell 四类受管节点增加
`contenteditable="plaintext-only"`。作者源码中的 `contenteditable` 仍由隔离层拒绝；运行时授予的
属性在每次安全挂载后重新生成。画布只回报节点 ID、UTF-16 区间、区间原文和替换纯文本，不回报
HTML。宿主再以当前受管投影和 expected 文本复核后交给文档内核，因此 contenteditable 自生成的
临时 DOM 不是文档真值，拒绝的输入会由当前草稿重新渲染回滚。

中文输入组合期沿用同一不变量：`compositionstart` 保存起点与原节点，组合中不提交输入、不应用
宿主渲染，`compositionend` 先恢复起点 DOM，再把最终候选作为一次纯文本意图提交；空结果按取消
处理。普通连续输入以 140ms 窗口合并为一个顺序内核批次，组合结束与失焦立即冲刷尾帧。

受控输入现开放单节点内的打字、替换、向前/向后字符或词删除、回车分段、软换行和纯文本粘贴。
`insertParagraph` 只允许 paragraph、heading 与 list-item，并立即调用 `split-text-block`；新节点 UUID
由宿主分配，再经可信回执把选中与光标移到新块，iframe 无权上报新身份。`insertLineBreak` 只以
`replace-text("\n")` 写入块内软换行。粘贴事件始终 `preventDefault`，只读取 `text/plain`：单个换行
保留为软换行，段落间空行在同一次内核提交中拆成新块，因此多段粘贴仍只产生一次撤销。HTML、图片、
文件、拖放、富文本和跨节点操作均明确拒绝，画布仍只向宿主发送节点 ID、区间、expected 与纯文本。

## 方案比较

### A：`srcdoc` iframe

`sandbox="allow-scripts"` 在 WKWebView、WebView2 和 Android WebView 所遵循的 HTML 模型中都应设置
sandboxed origin flag，因而得到 opaque origin。这个未采用的 `srcdoc` 方案没有另做原生验证；CSP 3
的“local scheme 继承”算法要求 `srcdoc` 文档复制创建者当时的 CSP，所以宿主策略仍会约束它；画布
内部的 meta CSP 还能继续收紧该副本。

这个方案的 bridge 可以改成同来源外部脚本，但动态 `srcdoc` 本身不是 Tauri 构建期遍历的 HTML
资产，Tauri 不会为其中的标签注入 nonce，也不会为动态内联脚本生成 hash。实验仓用内联 nonce
脚本的做法因此不能证明在本仓发布 CSP 下可用。即使改成外部脚本，安全骨架、作者内容和会话值仍
要在同一动态字符串里组装，审计边界较弱，所以不采用。

### B：blob URL iframe

blob URL 继承创建它的环境 origin；加上当前 sandbox 后仍应被强制为 opaque origin。这个未采用的
blob 方案没有另做原生验证；CSP 3 也把 `blob:` 列为需要继承创建者策略的本地方案，所以它不能绕开
宿主 CSP。

当前全局策略没有为 frame 导航开放 `blob:`，`frame-src` 缺省回退到 `default-src 'self'`；URL 标准
又把 `blob:` 作为独立 scheme 处理，不能把 `'self'` 当成可移植的放行依据。满足该方案需要修改全局
CSP，这违反本决策的硬边界。blob 内的 HTML 也不属于 Tauri 嵌入资产，得不到构建期 HTML 处理，
所以不采用。

### C：独立打包页面

独立页面从应用打包来源加载；未加 sandbox 时它与宿主同源，加上当前 sandbox 后成为 opaque
origin。macOS WKWebView 与 Android WebView 已在 2026-09-15 分别通过 `window.origin === "null"`
及跨文档访问抛出 `SecurityError` 确认该组合语义；Windows WebView2 仍待原生验证。宿主现有
`default-src 'self'` 允许 iframe 请求这个打包页面，不需要修改全局 CSP。

Tauri 2.11.5 的资源服务会按所请求的 HTML 资产路径附加 CSP 响应头；`tauri-codegen` 2.6.3 在
构建期遍历 `frontendDist` 内全部 HTML。它先向静态 `style` 元素注入 nonce，再按 HTML 路径记录
每个非空内联 `script` 归一化后的 SHA-256；运行时据此生成该页面专属的响应头策略。因此带内联
运行时的 `canvas.html` 处于 Tauri 可处理的静态资产集合中，独立 meta CSP 也能在构建产物检查中
复算验证。这个方案把可信运行时与作者字符串彻底分离，故采用 C。

## 开发与发布差异

每次正式构建都由独立 Vite 配置先生成临时 IIFE，随后 `scripts/build-page-document-canvas.mjs` 把运行时
内嵌进 `canvas.html`、写入精确 meta CSP 哈希并删除临时 JS/CSS。Tauri 再把整个 `dist` 作为嵌入
资产处理，并为这个 HTML 的同一内联脚本向响应头追加哈希。这条路径由依赖源码和构建产物检查
证明；Android WebView 已由 debug APK 实测接受响应头和 meta 两条策略，Windows WebView2
仍待原生验证。

上述“开发模式不支持画布”的结论现已作废。主 Vite 配置在 `configureServer` 阶段先于内部 HTML
中间件注册 `/canvas.html` 响应：它调用独立画布配置生成不写盘的 IIFE，再复用
`scripts/page-document-canvas-artifact.mjs` 的唯一转义、换行归一化、SHA-256 和占位替换逻辑组装完整
HTML，最后直接向响应流写入 UTF-8 字节。该路径不调用 `transformIndexHtml`，不注入
`/@vite/client` 或 HMR 脚本，meta `script-src` 仍只含唯一内联脚本的精确哈希。源码变化会将内存缓存
标记为过期，下次刷新 iframe 时惰性重建；不对隔离页开启 HMR。桌面的 5175 与 Android 的
5176 都走同一插件和现有 `devHost` 逻辑。开发响应没有 Tauri 打包协议添加的 CSP 响应头，因此它能
证明独立 meta CSP 与 bridge 运行，不能替代打包产物对响应头与 meta 取交集的原生验收。
开发时使用现有 `npm run dev` 或 `npm run tauri dev`，无需页面文档环境变量。

画布与页面编辑器默认启用；只有带共享恶意样例和绕过作者校验按钮的隔离探针需要显式开关：

```sh
npm run macos:build:debug
npm run android:build:dev
VITE_PAGE_DOCUMENT_PROBE=1 npm run macos:build:debug
```

默认 `npm run build` 先构建含页面预览与编辑入口的宿主，再由独立配置和组装脚本向
`dist/` 追加只含单个内联 IIFE 的 `canvas.html`，并同时执行画布制品与应用产物检查。默认产物
必须能找到“页面编辑”与独立 CodeMirror 分块，同时不得出现“隔离探针”、“跳过作者侧校验”、
共享恶意样例 ID 或 fixture 路径。

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
运行时子资源请求：正式构建把 IIFE 写成唯一内联脚本，meta `script-src` 只保留该脚本的哈希；
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

随后用户在同一 macOS 调试构建中用合法共享样例完成渲染截图：标题、摘要和表格边框均已出现，但
页面仍为白底；项目 `style.css` 在 `@layer fc-project` 的 `:root` 中声明的
`--fc-entry-surface: #f5f1e8` 与 `--fc-entry-text: #28241f` 没有生效。原因是运行时主题默认值和
`html` / `body` 基线此前未分层；CSS 层叠规定未分层普通声明优先于所有分层普通声明，所以它们压过
了后挂载的作者层。

运行时现把可被作者覆盖的主题默认值与排版基线放入最先声明的 `@layer fc-canvas-defaults`。该层由
runtime style 在 author style 之前挂载，因此在作者的 `fc-renderer`、`fc-project`、`fc-entry` 和
`fc-node` 层之前建立，保持最低优先级。节点选中框与资产占位框仍是未分层安全规则，作者层不能将
隔离状态隐藏。由此增加另一条运行时不变量：画布主题默认值必须位于最低优先级层，且 runtime style
必须先于 author style 挂载。

## macOS 与 Android 原生验收

2026-09-15，用户使用 `1f28a56` 的 `VITE_PAGE_DOCUMENT_CANVAS=1` macOS 调试构建完成五项原生
验收，结果全部通过：

1. 合法共享样例在正常路径显示米色背景、深棕文字和无衬线字体，标题、摘要与表格边框正常；启用
   跳过模式时，宿主显示原始片段不含项目模板与基础样式的说明。
2. `forbidden-script` 与 `external-css-url` 在正常路径显示“作者侧校验已阻止”；启用跳过模式后显示
   “隔离层拒绝渲染”，且画布为空。
3. HTTPS 链接交给系统浏览器打开，本页锚点无动作，不存在的词条显示提示或无反应；全程没有白屏
   或宿主顶层跳转。
4. 切换样例及拖动窗口宽度后，画布高度随内容变化；停止操作后高度不再增长，且没有内部滚动条。
5. 当前词条能显示标题与 Markdown 安全降级正文。

同日，用户使用包含 `0a3991c` 行内样式探针的
`VITE_PAGE_DOCUMENT_CANVAS=1 npm run macos:build:debug` 产物完成补验。“合法：行内样式”正文段
左侧显示竖线并产生缩进，证明经过隔离层保留的作者行内 `style` 在打包版中实际生效。Safari Web
Inspector 在画布执行环境中得到 `window.origin === "null"`，访问 `parent.document` 抛出
`SecurityError`；分别以跳过和不跳过作者侧校验两种路径加载 `external-css-url` 与
`svg-image-external-href` 时，网络面板均没有 `example.invalid` 请求，只有重建画布产生的
`canvas.html`。

2026-09-16，用户在 macOS 打包版 WKWebView 中补验中文组合输入时发现：正文和保存结果正确，但
每次提交候选词都会提示阻止 `insertFromComposition`。WebKit 会发送 Chromium 验证未覆盖的
`insertFromComposition` / `deleteByComposition` 旧式组合专用 `beforeinput`，且事件可能晚于
`compositionend`，所以此前依赖当前 `isComposing` 的判断将其误报为不支持输入。运行时现将这两种
事件与 `insertCompositionText` / `deleteCompositionText` 一样交给浏览器维护，不阻止、不回报、
也不生成输入意图；最终纯文本仍只由 `compositionstart` / `compositionend` 链路提交一次。

2026-09-15，用户使用
`VITE_PAGE_DOCUMENT_CANVAS=1 npm run android:build:dev` 生成的 aarch64 Android 真机 debug APK
完成原生验收，结果全部通过：

1. 合法共享样例显示米色背景和无衬线字体，标题、摘要与表格边框正常。
2. “合法：行内样式”的正文段左侧竖线和缩进正常生效。
3. `external-css-url` 与 `svg-image-external-href` 在正常路径由作者侧校验阻止，在跳过路径由隔离层
   拒绝渲染。
4. HTTPS 链接由系统浏览器打开，返回后仍停留在原词条；本页锚点无动作，不存在的词条不造成白屏。
5. 横竖屏旋转后画布高度随内容变化且不持续增长。
6. 应用进入后台十秒以上再恢复时预览仍在，切换样例后可以继续渲染。
7. 真实词条显示标题与 Markdown 安全降级正文。

Chrome `chrome://inspect` 在画布执行环境中得到 `window.origin === "null"`，访问 `parent.document`
抛出 `SecurityError`。分别以跳过和不跳过作者侧校验两种路径加载上述两个恶意样例时，Network 面板
没有 `example.invalid` 请求，只有重建画布产生的 `canvas.html`。因此，macOS WKWebView 与 Android
WebView 已由 `window.origin` 与跨文档访问实测确认画布使用 opaque origin；两端也都确认了作者行内
样式、无外部请求、导航接管、尺寸稳定和当前词条降级渲染。

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

基础隔离与只读画布仅剩 Windows WebView2：

- 打包子页面是否成为 opaque origin、让 `'self'` 不匹配应用协议资源，且 `event.origin` 不可用于
  鉴权。
- Tauri 响应头与画布 meta CSP 是否取交集，并接受同一内联脚本哈希。
- 经过隔离层保留的作者行内 `style` 属性是否在打包版中生效。
- 拒绝作者网络、表单和导航时是否不产生请求、不替换画布页面，也不触发宿主顶层导航。
- iframe 销毁、重建、旋转和后台恢复时，Window 身份与消息时序是否符合协议生命周期假设。

第四批 4a/4b 的文本输入尚未做完整原生验收，三端分别待验证：

- macOS WKWebView：连续中文输入、候选词切换、取消组合、长文末尾输入与失焦提交是否不吞字、不重复，
  拒绝输入时是否回滚到草稿，连续输入是否只产生一次撤销；Enter 分段、Shift+Enter 软换行、表格
  单元格拒绝分段、多段纯文本粘贴及其一次撤销是否符合协议。
- Android WebView：除上述输入与历史外，软键盘出现、候选栏变化和长文末尾光标是否不触发外壳二次
  缩放或平移；本批没有新增移动端专用 caret reveal。
- Windows WebView2：上述全部输入行为，以及 `plaintext-only`、beforeinput 目标区间和组合事件顺序
  是否与协议假设一致。

三端全部通过前，本 ADR 不写为“接受”，M6 也不写为“三端原生验收完成”。
