import {logger} from './shared/logger'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import AppShell from './app/index/AppShell'
import {get_platform_info, type PlatformInfo, setting_get_settings} from './api'
import {getAppSettingsSnapshot, subscribeAppSettings} from './features/settings/appSettingsStore'
import {getFormFactorOverride, isDevPreviewBackendEnabled, isTauriRuntime} from './shared/devPreview'
import {resolveDensity} from './shared/formFactor'
import {applyPersistedThemeColorConfig} from './pages/settings/themeColorPersistence'
import './i18n' // 初始化 i18n
import './glassEffect.css'
import './assets/fonts/fonts.css'

// ── 全局错误捕获（用于打包环境诊断，无 DevTools 时通过后端 log 可见）────────────
// JS 运行时错误 & 未捕获 Promise rejection
window.addEventListener('error', (e) => {
    const src = e.filename ? ` @ ${e.filename}:${e.lineno}` : ''
    logger.error(`[GlobalError] ${e.message}${src}`)
})
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error
        ? `${e.reason.message}\n${e.reason.stack ?? ''}`
        : String(e.reason)
    logger.error(`[UnhandledRejection] ${reason.slice(0, 400)}`)
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

    const enabled = isTauriRuntime()
        && platformInfo.os === 'windows'
        && platformInfo.formFactor === 'desktop'
        && shellAcrylicEnabled

    if (enabled) {
        document.documentElement.setAttribute('data-backdrop', 'acrylic')
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
    if (settingsResult.status === 'fulfilled' && settingsResult.value.theme) {
        initialTheme = settingsResult.value.theme
        shellAcrylicEnabled = settingsResult.value.shell_acrylic_enabled
        const colorThemeApplied = applyPersistedThemeColorConfig(settingsResult.value.theme_color_config)
        logger.info('[Bootstrap] 启动时应用颜色主题配置', {
            recipeId: settingsResult.value.theme_color_config?.recipeId ?? null,
            applied: colorThemeApplied,
        })
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

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <AppShell
                initialTheme={initialTheme as 'system' | 'light' | 'dark'}
                platformInfo={platformInfo}
            />
        </StrictMode>,
    )
}

initApp().catch(logger.error)
