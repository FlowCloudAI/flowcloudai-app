import {useLayoutEffect} from 'react'
import {AlertProvider, ContextMenuProvider, ThemeProvider, useTheme} from 'flowcloudai-ui'
// @ts-expect-error - CSS 导入，无需类型声明
import 'flowcloudai-ui/style'
import type {PlatformInfo} from '../../api'
import {TourProvider} from '../../features/onboarding'
import {resolveDensity} from '../../shared/formFactor'
import {useTopLevelNavigationGuard} from '../../shared/hooks/useTopLevelNavigationGuard'
import AppRoot from './AppRoot'

interface AppShellProps {
    initialTheme: 'system' | 'light' | 'dark'
    platformInfo: PlatformInfo
}

function ThemePreferenceSync() {
    const {theme} = useTheme()

    useLayoutEffect(() => {
        document.documentElement.setAttribute('data-theme-preference', theme)
    }, [theme])

    return null
}

export default function AppShell({initialTheme, platformInfo}: AppShellProps) {
    // 兜底防止 WebView 顶层导航把整个应用替换掉，必须挂在所有页面之上。
    useTopLevelNavigationGuard()

    return (
        <ThemeProvider defaultTheme={initialTheme} density={resolveDensity(platformInfo)}>
            <ThemePreferenceSync/>
            <ContextMenuProvider>
                <AlertProvider>
                    <TourProvider>
                        <AppRoot platformInfo={platformInfo}/>
                    </TourProvider>
                </AlertProvider>
            </ContextMenuProvider>
        </ThemeProvider>
    )
}
