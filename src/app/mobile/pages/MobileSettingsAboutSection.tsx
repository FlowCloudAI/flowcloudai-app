import {Button} from 'flowcloudai-ui'
import {useState} from 'react'
import {type AppLogSnapshot} from '../../../api'
import FontLicenseModal from '../../../features/about/FontLicenseModal'

interface AboutSectionProps {
    logViewerOpen: boolean
    logSnapshot: AppLogSnapshot | null
    logLoading: boolean
    logError: string
    officialSiteUrl: string
    officialGithubUrl: string
    officialEmail: string
    onOpenLogViewer: () => void
    onLoadAppLog: () => void | Promise<void>
    onCopyLog: () => void | Promise<void>
    onOpenOfficialUrl: (url: string) => void
    onCopyOfficialEmail: () => void | Promise<void>
    onExit: () => void | Promise<void>
}

function LogIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M7 4h7l4 4v12H7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M14 4v4h4M10 12h5M10 16h5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function RefreshIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M20 12a8 8 0 0 1-13.66 5.66M4 12A8 8 0 0 1 17.66 6.34"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M20 5v6h-6M4 19v-6h6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

function CopyIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="mobile-settings-button-icon">
            <path
                d="M8 8h10v10H8zM6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export default function MobileSettingsAboutSection({
    logViewerOpen,
    logSnapshot,
    logLoading,
    logError,
    officialSiteUrl,
    officialGithubUrl,
    officialEmail,
    onOpenLogViewer,
    onLoadAppLog,
    onCopyLog,
    onOpenOfficialUrl,
    onCopyOfficialEmail,
    onExit,
}: AboutSectionProps) {
    const [fontLicenseModalOpen, setFontLicenseModalOpen] = useState(false)

    return (
        <div className="mobile-settings-section">
            <div className="mobile-settings-about-card">
                <div className="mobile-settings-about-brand">
                    <img className="mobile-settings-about-brand__icon" src="/icon.svg" alt=""/>
                    <div>
                        <div className="mobile-settings-about-card__title">流云AI</div>
                        <div>流云AI 移动端创作与知识管理应用</div>
                    </div>
                </div>
                <div className="mobile-settings-about-meta">
                    <div>
                        <span>开源协议</span>
                        <strong>MIT License</strong>
                    </div>
                </div>
            </div>
            <div className="mobile-settings-about-actions">
                <div className="mobile-settings-about-action">
                    <div className="mobile-settings-about-action__copy">
                        <span className="mobile-settings-about-action__title">官网</span>
                        <span className="mobile-settings-about-action__desc">{officialSiteUrl}</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" radius="full" onClick={() => onOpenOfficialUrl(officialSiteUrl)}>
                        打开
                    </Button>
                </div>
                <div className="mobile-settings-about-action">
                    <div className="mobile-settings-about-action__copy">
                        <span className="mobile-settings-about-action__title">官方 GitHub</span>
                        <span className="mobile-settings-about-action__desc">{officialGithubUrl}</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" radius="full" onClick={() => onOpenOfficialUrl(officialGithubUrl)}>
                        打开
                    </Button>
                </div>
                <div className="mobile-settings-about-action">
                    <div className="mobile-settings-about-action__copy">
                        <span className="mobile-settings-about-action__title">官方邮箱</span>
                        <span className="mobile-settings-about-action__desc">{officialEmail}</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" radius="full" onClick={() => void onCopyOfficialEmail()}>
                        复制
                    </Button>
                </div>
                <div className="mobile-settings-about-action">
                    <div className="mobile-settings-about-action__copy">
                        <span className="mobile-settings-about-action__title">应用日志</span>
                        <span className="mobile-settings-about-action__desc">
                            查看最近 app.log 内容，用于排查插件安装等运行问题。
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        radius="full"
                        onClick={onOpenLogViewer}
                    >
                        <span className="mobile-settings-button-content">
                            <LogIcon/>
                            查看日志
                        </span>
                    </Button>
                </div>
                <div className="mobile-settings-about-action">
                    <div className="mobile-settings-about-action__copy">
                        <span className="mobile-settings-about-action__title">字体版权与授权</span>
                        <span className="mobile-settings-about-action__desc">
                            Noto CJK、霞鹜文楷 · SIL Open Font License 1.1
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        radius="full"
                        onClick={() => setFontLicenseModalOpen(true)}
                    >
                        查看
                    </Button>
                </div>
            </div>
            {logViewerOpen && (
                <div className="mobile-settings-log-viewer">
                    <div className="mobile-settings-log-viewer__header">
                        <div className="mobile-settings-log-viewer__copy">
                            <div className="mobile-settings-log-viewer__title">最近日志</div>
                            <div className="mobile-settings-log-viewer__path">
                                {logSnapshot?.path || '正在读取日志路径…'}
                            </div>
                        </div>
                        <div className="mobile-settings-log-viewer__actions">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                radius="full"
                                onClick={() => void onLoadAppLog()}
                                disabled={logLoading}
                            >
                                <span className="mobile-settings-button-content">
                                    <RefreshIcon/>
                                    {logLoading ? '读取中…' : '刷新'}
                                </span>
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                radius="full"
                                onClick={() => void onCopyLog()}
                                disabled={!logSnapshot?.content}
                            >
                                <span className="mobile-settings-button-content">
                                    <CopyIcon/>
                                    复制
                                </span>
                            </Button>
                        </div>
                    </div>
                    {logSnapshot?.truncated && (
                        <div className="mobile-settings-log-viewer__notice">
                            日志较大，仅显示最近 256KB。
                        </div>
                    )}
                    {logError ? (
                        <div className="mobile-settings-log-viewer__error">
                            读取失败：{logError}
                        </div>
                    ) : (
                        <pre className="mobile-settings-log-viewer__content">{logLoading && !logSnapshot
                            ? '正在读取日志…'
                            : logSnapshot?.content || '暂无日志内容'}</pre>
                    )}
                </div>
            )}
            <Button
                type="button"
                variant="ghost"
                radius="full"
                onClick={onExit}
                className="mobile-settings-exit-button"
            >
                退出应用
            </Button>
            <FontLicenseModal open={fontLicenseModalOpen} onClose={() => setFontLicenseModalOpen(false)}/>
        </div>
    )
}
