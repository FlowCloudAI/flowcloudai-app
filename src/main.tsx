import {logger} from './shared/logger'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import AppShell from './app/index/AppShell'
import {type AppSettings, get_platform_info, type PlatformInfo, setting_get_settings} from './api'
import {getAppSettingsSnapshot, subscribeAppSettings} from './features/settings/appSettingsStore'
import {getFormFactorOverride, isDevPreviewBackendEnabled, isTauriRuntime} from './shared/devPreview'
import {resolveDensity} from './shared/formFactor'
import {resolveNativeShellBackdrop} from './shared/nativeShellBackdrop'
import {applyPersistedThemeColorConfig} from './pages/settings/themeColorPersistence'
import './i18n' // 初始化 i18n
import './glassEffect.css'
import './assets/fonts/fonts.css'

/*
 * 真机没有 DevTools 时的兜底显示。
 *
 * 后端 log 只有能连上调试器才看得到；模块脚本挂掉时 React 根本没跑起来，
 * #root 是空的，屏幕上只有白屏——2026-08-24 排查 iOS 实验页正是卡在这里，
 * 三条 MIME 错误一条都没显示出来。所以错误必须画在页面上。
 */
function showFatalError(detail: unknown): void {
    const root = document.getElementById('root')
    if (!root) return

    let box = document.getElementById('fc-fatal-error')
    if (!box) {
        box = document.createElement('pre')
        box.id = 'fc-fatal-error'
        box.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483647',
            'margin:0', 'padding:16px', 'overflow:auto',
            'background:#1a0d0d', 'color:#ffb4a2',
            'font:12px/1.5 ui-monospace,Menlo,monospace',
            'white-space:pre-wrap', 'word-break:break-all',
        ].join(';')
        document.body.appendChild(box)
    }
    box.textContent += `${String(detail)}\n\n`
}

// ── 全局错误捕获（用于打包环境诊断，无 DevTools 时通过后端 log 可见）────────────
// JS 运行时错误 & 未捕获 Promise rejection
window.addEventListener('error', (e) => {
    const src = e.filename ? ` @ ${e.filename}:${e.lineno}` : ''
    logger.error(`[GlobalError] ${e.message}${src}`)
    showFatalError(`[GlobalError] ${e.message}${src}`)
})
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error
        ? `${e.reason.message}\n${e.reason.stack ?? ''}`
        : String(e.reason)
    logger.error(`[UnhandledRejection] ${reason.slice(0, 400)}`)
    showFatalError(`[UnhandledRejection] ${reason.slice(0, 400)}`)
})

// CSP 违规（能精确定位被拦截的资源/指令）
document.addEventListener('securitypolicyviolation', (e) => {
    logger.error(`[CSPViolation] directive="${e.violatedDirective}" blocked="${e.blockedURI}" src="${e.sourceFile}:${e.lineNumber}"`)
})

function getFallbackPlatformInfo(): PlatformInfo {
    return {
        os: 'unknown',
        formFactor: 'desktop',
        windowControls: isTauriRuntime(),
    }
}

function syncShellBackdrop(platformInfo: PlatformInfo, shellAcrylicEnabled: boolean) {
    if (shellAcrylicEnabled) {
        document.documentElement.setAttribute('data-glass-effect', 'enabled')
    } else {
        document.documentElement.removeAttribute('data-glass-effect')
    }

    const backdrop = resolveNativeShellBackdrop(
        platformInfo,
        isTauriRuntime(),
        shellAcrylicEnabled,
    )

    if (backdrop) {
        document.documentElement.setAttribute('data-backdrop', backdrop)
    } else {
        document.documentElement.removeAttribute('data-backdrop')
    }
}

// 异步初始化主题
const initApp = async () => {
    let initialTheme = 'system'
    let platformInfo = getFallbackPlatformInfo()
    let shellAcrylicEnabled = true

    // 开发期浏览器预览：装上内存 mock 后端，让预览能走真实数据流而不是每页「加载失败」。
    // 必须在首个 IPC 之前装。动态 import 且整体在 DEV 分支内 → 生产构建不会打进产物。
    if (import.meta.env.DEV && isDevPreviewBackendEnabled()) {
        const {installDevPreviewBackend} = await import('./shared/devPreviewBackend')
        installDevPreviewBackend()
    }

    // 并行发起两个 IPC，节省一个往返延迟
    const [settingsResult, platformResult] = await Promise.allSettled([
        setting_get_settings(),
        get_platform_info(),
    ])
    let themeColorConfig: AppSettings['theme_color_config'] = null
    if (settingsResult.status === 'fulfilled' && settingsResult.value.theme) {
        initialTheme = settingsResult.value.theme
        shellAcrylicEnabled = settingsResult.value.shell_acrylic_enabled
        // 先留着，等 data-fc-density 写完再应用——原因见下面应用处的注释。
        themeColorConfig = settingsResult.value.theme_color_config
    } else if (settingsResult.status === 'rejected') {
        logger.warn('Failed to load settings, using default theme:', settingsResult.reason)
    }
    if (platformResult.status === 'fulfilled') {
        platformInfo = platformResult.value
    } else {
        logger.warn('Failed to load platform info, using fallback:', platformResult.reason)
    }

    // 开发期浏览器预览：用 ?ff=mobile|desktop 覆盖壳层分流（仅 dev 生效，生产为空操作）。
    const formFactorOverride = getFormFactorOverride()
    if (formFactorOverride) {
        platformInfo = {...platformInfo, formFactor: formFactorOverride}
        logger.info('[Bootstrap] 应用 formFactor 覆盖（开发预览）:', formFactorOverride)
    }

    if (isTauriRuntime()) {
        document.documentElement.classList.add('is-tauri')
        document.body.classList.add('is-tauri')
    }

    syncShellBackdrop(platformInfo, shellAcrylicEnabled)
    subscribeAppSettings(() => {
        const nextSettings = getAppSettingsSnapshot().settings
        if (!nextSettings) return
        syncShellBackdrop(platformInfo, nextSettings.shell_acrylic_enabled)
    })

    // 原生移动壳必须先知道这里是「跟随系统」还是显式主题。尤其在 iOS 上，
    // 若把尚未解析的 system 提前强制成 light，会反过来让 WebView 的媒体查询也变亮。
    document.documentElement.setAttribute('data-theme-preference', initialTheme)

    // 在 React 渲染前同步写入 data-theme，避免首帧闪白
    const resolvedTheme = initialTheme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : initialTheme
    document.documentElement.setAttribute('data-theme', resolvedTheme)

    // 同理预写控件密度：ThemeProvider 的同步发生在 useEffect（首帧绘制之后），
    // 只靠它会让移动端首帧按桌面高度排版再跳一次——闪白是颜色问题，这个是布局抖动，更显眼。
    if (resolveDensity(platformInfo) === 'touch') {
        document.documentElement.setAttribute('data-fc-density', 'touch')
    }

    /*
     * 颜色主题覆盖必须排在 data-fc-density 之后。
     *
     * 覆盖 CSS 里的四个背景令牌挂在 `:not([data-fc-density="touch"])` 下（只给桌面端），
     * 属性还没写上去的那一刻该选择器是命中的；先应用就会在移动端短暂拿到桌面底色。
     * 当前 render 在这之后，理论上看不见，但这个顺序不该靠「后面碰巧没绘制」维持。
     */
    const colorThemeApplied = applyPersistedThemeColorConfig(themeColorConfig)
    logger.info('[Bootstrap] 启动时应用颜色主题配置', {
        recipeId: themeColorConfig?.recipeId ?? null,
        applied: colorThemeApplied,
        density: document.documentElement.getAttribute('data-fc-density'),
    })

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <AppShell
                initialTheme={initialTheme as 'system' | 'light' | 'dark'}
                platformInfo={platformInfo}
            />
        </StrictMode>,
    )
}

/*
 * 键盘实验入口（仅 dev，且 VITE_LAB=1）。
 *
 * 走构建期开关而不是独立的 lab.html：Tauri 在 iOS 上把 WebView 的 origin 固定为 localhost，
 * devUrl 里的路径会被丢弃，所以任何「靠 URL 进入实验页」的做法在真机上都到不了
 * （2026-08-24 真机实测：两个不同 devUrl 的构建，origin 都是 localhost）。
 * 挂在 main.tsx 上还顺带继承了本文件顶部的全局错误捕获。
 */
function mountKeyboardLab(): void {
    void (async () => {
        try {
            const [{default: IosLab}] = await Promise.all([
                import('./lab/ios/IosLab'),
                import('./lab/shared/lab.css'),
            ])
            createRoot(document.getElementById('root')!).render(
                <StrictMode>
                    <IosLab/>
                </StrictMode>,
            )
        } catch (error) {
            logger.error(`[Lab] 实验页加载失败: ${String(error)}`)
            showFatalError(error)
        }
    })()
}

if (import.meta.env.DEV && import.meta.env.VITE_LAB === '1') {
    mountKeyboardLab()
} else {
    initApp().catch((error: unknown) => {
        logger.error(String(error))
        showFatalError(error)
    })
}
