/**
 * 关系图谱的两个子页：关系索引、布局参数。
 *
 * 两者都是重内容（一整份关系清单 / 一整组布局参数表单），按移动端约定进独立页面而非浮层。
 * 页面本身不持有数据——内容由仍然挂载在下层的 ProjectRelationGraph 通过 portal 投过来，
 * 这里只提供顶栏、标题和承接容器，并通过 props 桥把容器交回图谱页。
 * 之所以能这样：双层转场保留栈顶两层，图谱页在子页之上打开时不会卸载。
 */
import {useCallback} from 'react'
import {Button} from 'flowcloudai-ui'
import {MobileBackIcon, MobilePageTopBar, MobileTopActionPill} from '../components/MobileTopControls'
import {type MobileBridgedPageParams} from '../usePageStack'
import {readProvidedMobilePageProps} from './useMobilePageProps'
import './MobileRelationGraph.css'

export interface MobileRelationGraphPanelBridgedProps {
    /** 子页把自己的容器交回图谱页，图谱页据此 portal 内容过来。 */
    onHostReady: (host: HTMLDivElement | null) => void
}

interface Props {
    pop: () => void
    params: MobileBridgedPageParams
}

function RelationGraphPanelPage({pop, params, title, desc, className}: Props & {
    title: string
    desc: string
    className: string
}) {
    const bridged = readProvidedMobilePageProps<MobileRelationGraphPanelBridgedProps>(params.propsToken)
    // 直接把桥上的回调当 ref 传会被 react-hooks/refs 判成「render 期读 ref」，包一层。
    const onHostReady = bridged?.onHostReady
    const setHost = useCallback((node: HTMLDivElement | null) => {
        onHostReady?.(node)
    }, [onHostReady])

    if (!bridged) {
        return (
            <div className="mobile-page__error" role="alert">
                <span>关系图谱会话已结束，请返回重新进入。</span>
                <Button type="button" size="sm" variant="outline" onClick={pop}>返回</Button>
            </div>
        )
    }

    return (
        <div className={`mobile-page mobile-relation-graph-panel ${className}`}>
            <MobilePageTopBar
                sticky
                edgeToEdge
                ariaLabel={title}
                left={<MobileTopActionPill
                    actions={[{
                        key: 'back',
                        label: '返回关系图谱',
                        icon: <MobileBackIcon/>,
                        onClick: pop,
                    }]}
                />}
                center={<h1 className="mobile-relation-graph-page__title">{title}</h1>}
            />
            <div className="mobile-relation-graph-panel__heading">
                <p className="mobile-relation-graph-panel__desc">{desc}</p>
            </div>
            <div ref={setHost} className="mobile-relation-graph-panel__host"/>
        </div>
    )
}

export function MobileRelationIndexPage(props: Props) {
    return (
        <RelationGraphPanelPage
            {...props}
            title="关系索引"
            desc="按词条列出全部关系；点选一条会在图谱中高亮。"
            className="mobile-relation-graph-panel--index"
        />
    )
}

export function MobileRelationLayoutPage(props: Props) {
    return (
        <RelationGraphPanelPage
            {...props}
            title="布局参数"
            desc="调整节点排布的松紧与力学参数，应用后重新布局。"
            className="mobile-relation-graph-panel--layout"
        />
    )
}
