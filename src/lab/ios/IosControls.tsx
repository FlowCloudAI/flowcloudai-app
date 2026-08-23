/*
 * 实验控制台。刻意放在滚动区内部，而不是做成浮层——
 * 浮层自己也要处理键盘遮挡，会污染被测对象。
 */

import {useCallback, useEffect, useState} from 'react'
import {copyText} from '../shared/copyText'
import {
    clearNativeTrace,
    configureNative,
    type KbNativeState,
    nativeAvailable,
    onNativeReady,
    requestNativeState,
} from './kbNative'
import {
    ceilingValue,
    type InsetSource,
    setInsetSource,
} from './keyboardInset'
import {
    buildReport,
    clearTaps,
    clearTrace,
    setKeyboardLabel,
    setModeLabel,
    setSamplingEnabled,
    tapStats,
} from './kbTrace'

const SOURCES: Array<{ value: InsetSource; label: string }> = [
    {value: 'off', label: '不处理'},
    {value: 'visual-viewport', label: 'vv'},
    {value: 'native-event', label: '原生事件（默认）'},
    {value: 'native-frame', label: '原生逐帧'},
]

const DEFAULT_SOURCE: InsetSource = 'native-event'

export default function IosControls(): React.ReactElement {
    const [source, setSource] = useState<InsetSource>(DEFAULT_SOURCE)
    const [bridgeConnected, setBridgeConnected] = useState(nativeAvailable())
    const [observersRemoved, setObserversRemoved] = useState(false)
    const [clamp, setClamp] = useState(false)
    const [insetNever, setInsetNever] = useState(false)
    const [resizeWebView, setResizeWebView] = useState(false)
    const [filler, setFiller] = useState(true)
    const [thirdParty, setThirdParty] = useState(false)
    const [sampling, setSampling] = useState(true)
    const [report, setReport] = useState('')
    const [reportIndex, setReportIndex] = useState(0)
    const [copyState, setCopyState] = useState('')
    const [state, setState] = useState<KbNativeState | null>(null)
    const [stats, setStats] = useState(tapStats())

    useEffect(() => {
        let prepared = false
        const prepareDefaultCandidate = () => {
            if (prepared || !nativeAvailable()) return
            prepared = true
            setBridgeConnected(true)

            /*
             * 测试页默认直接进入待验收候选，而不是让真机每次先复现一次已知故障：
             * - 摘掉 WKWebView 自带的键盘 frame 观察者，阻止整页/顶栏被自动平移；
             * - 关闭安全区自动 inset，避免 scrollView 成为第二个布局 owner；
             * - 展开时使用 UIKeyboardWillChangeFrame 的真实目标、时长与曲线驱动内部内容区；
             * - 收起事件拿不到有效时长时，再由 keyboardLayoutGuide 逐帧跟随兜底。
             *
             * 前两项在当前 WebView 会话不可逆，因此只放在 VITE_LAB 专用入口，尚未接入业务页。
             */
            configureNative({
                pushPerFrame: true,
                insetAdjustmentNever: true,
                removeWebKitObservers: true,
            })
            setInsetSource(DEFAULT_SOURCE)
            setObserversRemoved(true)
            setInsetNever(true)
        }

        const disposeReady = onNativeReady(prepareDefaultCandidate)
        prepareDefaultCandidate()
        return () => {
            disposeReady()
            setInsetSource('off')
            configureNative({pushPerFrame: false})
        }
    }, [])

    useEffect(() => {
        const timer = window.setInterval(() => setStats(tapStats()), 500)
        return () => window.clearInterval(timer)
    }, [])

    useEffect(() => {
        setModeLabel(`inset=${source} suppress=${observersRemoved} clamp=${clamp}`
            + ` insetNever=${insetNever} resizeWV=${resizeWebView} filler=${filler}`)
    }, [source, observersRemoved, clamp, insetNever, resizeWebView, filler])

    useEffect(() => {
        setKeyboardLabel(thirdParty ? '第三方键盘' : '系统键盘')
    }, [thirdParty])

    useEffect(() => {
        document.documentElement.dataset.labFiller = filler ? 'on' : 'off'
    }, [filler])

    const applySource = useCallback((next: InsetSource) => {
        setSource(next)
        setInsetSource(next)
        /* native-event 也需要逐帧推送，但只用于实测启动偏移，不驱动布局 */
        configureNative({pushPerFrame: next === 'native-frame' || next === 'native-event'})
    }, [])

    const makeReport = useCallback(async () => {
        const index = reportIndex + 1
        setReportIndex(index)
        setReport('生成中…')
        setReport(await buildReport(index))
    }, [reportIndex])

    return (
        <section className="lab-controls">
            <div className="lab-controls-title">实验控制台 · iOS（依赖 MobileUiBridge 原生桥）</div>
            <div className="lab-row">
                <span className="lab-tag">原生桥</span>
                <span className={bridgeConnected ? 'lab-ok' : 'lab-bad'}>
                    {bridgeConnected ? '已连接 · 默认候选已启用' : '未连接'}
                </span>
                <span className="lab-tag">点击→呼出</span>
                <span>{stats.summoned}/{stats.cold}{stats.pending > 0 ? ` (${stats.pending} 待判)` : ''}</span>
                <span className="lab-tag">高度上限</span>
                <span>{Number.isFinite(ceilingValue()) ? ceilingValue().toFixed(0) : '未学到'}</span>
            </div>

            <div className="lab-row">
                <span className="lab-tag">高度来源</span>
                {SOURCES.map(item => (
                    <button
                        key={item.value}
                        type="button"
                        className={source === item.value ? 'lab-btn lab-btn-on' : 'lab-btn'}
                        onClick={() => applySource(item.value)}
                    >{item.label}</button>
                ))}
            </div>

            <div className="lab-row">
                <button
                    type="button"
                    className={observersRemoved ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    disabled={observersRemoved}
                    onClick={() => {
                        configureNative({removeWebKitObservers: true})
                        setObserversRemoved(true)
                    }}
                >摘 WebKit 键盘观察者（不可逆）
                </button>
                <button
                    type="button"
                    className={clamp ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    onClick={() => {
                        const next = !clamp
                        setClamp(next)
                        configureNative({clampScrollView: next})
                    }}
                >钳位 scrollView
                </button>
            </div>

            <div className="lab-row">
                <button
                    type="button"
                    className={insetNever ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    disabled={insetNever}
                    onClick={() => {
                        setInsetNever(true)
                        configureNative({insetAdjustmentNever: true})
                    }}
                >inset 行为 never（本会话锁定）
                </button>
                <button
                    type="button"
                    className={resizeWebView ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    onClick={() => {
                        const next = !resizeWebView
                        setResizeWebView(next)
                        configureNative({resizeWebViewFrame: next})
                    }}
                >对照：压缩 WebView
                </button>
                <button
                    type="button"
                    className={filler ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    onClick={() => setFiller(!filler)}
                >键盘位填充块
                </button>
            </div>

            <div className="lab-row">
                <button
                    type="button"
                    className={thirdParty ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    onClick={() => setThirdParty(!thirdParty)}
                >{thirdParty ? '标记：第三方键盘' : '标记：系统键盘'}</button>
                <button
                    type="button"
                    className={sampling ? 'lab-btn lab-btn-on' : 'lab-btn'}
                    onClick={() => {
                        const next = !sampling
                        setSampling(next)
                        setSamplingEnabled(next)
                        configureNative({autoLog: next})
                    }}
                >{sampling ? '采样：开' : '采样：关（测手感）'}</button>
                <button type="button" className="lab-btn" onClick={() => {
                    clearTrace()
                    clearNativeTrace()
                }}>清空轨迹
                </button>
                <button type="button" className="lab-btn" onClick={() => {
                    clearTaps()
                    setStats(tapStats())
                }}>清空点击统计
                </button>
            </div>

            <div className="lab-row">
                <button type="button" className="lab-btn lab-btn-primary" onClick={() => void makeReport()}>
                    生成报告
                </button>
                <button
                    type="button"
                    className="lab-btn lab-btn-primary"
                    onClick={() => setCopyState(copyText(report) ? '已复制' : '复制失败，请长按下方文本手动全选')}
                >复制报告
                </button>
                <button type="button" className="lab-btn" onClick={() => {
                    void requestNativeState().then(setState)
                }}>读原生状态
                </button>
                <span className="lab-note">{copyState}</span>
            </div>

            {state ? (
                <pre className="lab-state">{JSON.stringify(state, null, 1)}</pre>
            ) : null}

            <textarea className="lab-report" readOnly value={report} placeholder="报告会出现在这里"/>
        </section>
    )
}
