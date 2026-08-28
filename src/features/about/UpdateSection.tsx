// 应用更新页面：负责检查、下载和安装桌面端更新，并展示更新服务返回的版本说明。

import {useCallback, useEffect, useState} from 'react'
import {getVersion} from '@tauri-apps/api/app'
import {Button, useAlert} from 'flowcloudai-ui'
import {get_app_update_changelog} from '../../api'
import {logger} from '../../shared/logger'
import {
    checkAppUpdate,
    installAppUpdate,
    isAutoCheckUpdateEnabled,
    setAutoCheckUpdateEnabled,
    type DownloadEvent,
    type Update,
} from './appUpdate'
import {
    mergeUpdateChangelogEntries,
    UPDATE_CHANGELOG,
    type UpdateChangelogEntry,
} from './updateChangelog'
import './AboutSection.css'

export default function UpdateSection() {
    const {showAlert} = useAlert()
    const [appVersion, setAppVersion] = useState('')
    const [checkingUpdate, setCheckingUpdate] = useState(false)
    const [installingUpdate, setInstallingUpdate] = useState(false)
    const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null)
    const [updateStatus, setUpdateStatus] = useState('')
    const [downloadedBytes, setDownloadedBytes] = useState(0)
    const [downloadTotalBytes, setDownloadTotalBytes] = useState<number | null>(null)
    const [autoCheckUpdate, setAutoCheckUpdate] = useState(isAutoCheckUpdateEnabled)
    const [remoteChangelog, setRemoteChangelog] = useState<readonly UpdateChangelogEntry[]>([])

    useEffect(() => {
        getVersion().then(setAppVersion).catch(logger.error)
        get_app_update_changelog('windows', 'x86_64').then((entries) => {
            setRemoteChangelog(entries.map((entry) => ({
                version: entry.version,
                date: entry.pub_date ?? '',
                notes: entry.notes?.trim() ?? '',
            })))
        }).catch((error) => logger.warn('获取官网更新日志失败，继续使用内置日志', error))
    }, [])

    const handleCheckUpdate = useCallback(async () => {
        setCheckingUpdate(true)
        setUpdateStatus('正在检查更新…')
        setAvailableUpdate(null)
        setDownloadedBytes(0)
        setDownloadTotalBytes(null)
        try {
            const update = await checkAppUpdate()
            if (!update) {
                setUpdateStatus('当前已是最新版本')
                void showAlert('当前已是最新版本', 'success', 'nonInvasive', 1800)
                return
            }
            setAvailableUpdate(update)
            setUpdateStatus(`发现新版本 ${update.version}`)
        } catch (error) {
            logger.error('检查更新失败:', error)
            const message = error instanceof Error ? error.message : String(error)
            setUpdateStatus(`检查更新失败：${message}`)
            void showAlert(`检查更新失败：${message}`, 'error', 'nonInvasive', 3200)
        } finally {
            setCheckingUpdate(false)
        }
    }, [showAlert])

    const handleInstallUpdate = useCallback(async () => {
        if (!availableUpdate) return
        const confirmed = window.confirm('安装更新时应用可能会自动退出，请先保存正在编辑的内容。是否继续？')
        if (!confirmed) return

        let downloaded = 0
        setInstallingUpdate(true)
        setDownloadedBytes(0)
        setDownloadTotalBytes(null)
        setUpdateStatus('正在下载更新…')
        try {
            const onEvent = (event: DownloadEvent) => {
                if (event.event === 'Started') {
                    downloaded = 0
                    setDownloadedBytes(0)
                    setDownloadTotalBytes(event.data.contentLength ?? null)
                    setUpdateStatus('正在下载更新…')
                } else if (event.event === 'Progress') {
                    downloaded += event.data.chunkLength
                    setDownloadedBytes(downloaded)
                } else if (event.event === 'Finished') {
                    setUpdateStatus('下载完成，正在安装…')
                }
            }
            await installAppUpdate(availableUpdate, onEvent)
        } catch (error) {
            logger.error('安装更新失败:', error)
            const message = error instanceof Error ? error.message : String(error)
            setUpdateStatus(`安装更新失败：${message}`)
            void showAlert(`安装更新失败：${message}`, 'error', 'nonInvasive', 3600)
        } finally {
            setInstallingUpdate(false)
        }
    }, [availableUpdate, showAlert])

    const downloadProgressLabel = downloadTotalBytes && downloadTotalBytes > 0
        ? `${Math.min(100, Math.round((downloadedBytes / downloadTotalBytes) * 100))}%`
        : downloadedBytes > 0
            ? `${Math.round(downloadedBytes / 1024 / 1024 * 10) / 10} MB`
            : ''

    const updateChangelog = mergeUpdateChangelogEntries(
        remoteChangelog,
        availableUpdate ? [{
            version: availableUpdate.version,
            date: availableUpdate.date ?? '',
            notes: availableUpdate.body?.trim() || '此版本未提供更新说明。',
        }] : [],
        UPDATE_CHANGELOG,
    )

    return (
        <>
            <section className="settings-section fc-section-card about-section-update">
                <div className="about-section-update-copy">
                    <h2 className="settings-section-title fc-section-title">应用更新</h2>
                    {updateStatus && <p className="about-section-update-status">{updateStatus}</p>}
                    {availableUpdate && (
                        <div className="about-section-update-meta">
                            <span>当前版本：{availableUpdate.currentVersion || appVersion || '未知'}</span>
                            <span>最新版本：{availableUpdate.version}</span>
                            {availableUpdate.date && <span>发布时间：{availableUpdate.date}</span>}
                        </div>
                    )}
                    {installingUpdate && downloadProgressLabel && (
                        <div className="about-section-update-progress" aria-label="更新下载进度">
                            <span style={{width: downloadTotalBytes ? downloadProgressLabel : '100%'}}/>
                            <strong>{downloadProgressLabel}</strong>
                        </div>
                    )}
                    <label className="settings-checkbox-field about-section-auto-update">
                        <input
                            type="checkbox"
                            checked={autoCheckUpdate}
                            onChange={(event) => {
                                const enabled = event.currentTarget.checked
                                setAutoCheckUpdate(enabled)
                                setAutoCheckUpdateEnabled(enabled)
                            }}
                        />
                        <span>
                            <strong>自动检查更新</strong>
                        </span>
                    </label>
                </div>
                <div className="about-section-update-actions">
                    <Button
                        type="button"
                        variant={availableUpdate ? 'primary' : 'outline'}
                        size="sm"
                        disabled={checkingUpdate || installingUpdate}
                        onClick={() => void (availableUpdate ? handleInstallUpdate() : handleCheckUpdate())}
                    >
                        {installingUpdate
                            ? '安装中…'
                            : checkingUpdate
                                ? '检查中…'
                                : availableUpdate
                                    ? '安装并重启'
                                    : '检查更新'}
                    </Button>
                </div>
            </section>

            <section className="settings-section fc-section-card">
                <h2 className="settings-section-title fc-section-title">更新日志</h2>
                <div className="about-section-changelog">
                    {updateChangelog.map((entry) => (
                        <details key={entry.version} open={entry.version === appVersion}>
                            <summary>
                                <svg className="about-section-changelog-caret" viewBox="0 0 16 16" aria-hidden="true">
                                    <path d="M5 3.5 12 8l-7 4.5Z"/>
                                </svg>
                                <span>版本 {entry.version}</span>
                                {entry.version === appVersion && <strong>当前版本</strong>}
                                {entry.version === availableUpdate?.version && <strong>可更新</strong>}
                                {entry.date && <time>{entry.date}</time>}
                            </summary>
                            <p className="about-section-update-notes">{entry.notes}</p>
                        </details>
                    ))}
                </div>
            </section>
        </>
    )
}
