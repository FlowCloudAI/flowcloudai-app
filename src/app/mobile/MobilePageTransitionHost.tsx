/**
 * 移动端原生式双层页面转场容器。
 * 只保留栈顶与直接前驱：前驱平时隐藏但不卸载，边缘返回时作为实时底层。
 */

import type {ReactNode} from 'react'
import type {MobilePageNavigation} from './usePageStack'
import type {MobilePageTransitionLayer} from './mobilePageTransition'

interface MobilePageTransitionHostProps {
    layers: readonly MobilePageTransitionLayer[]
    lastNavigation: MobilePageNavigation
    edgeBackForegroundKey: string | null
    interactive: boolean
    renderLayer: (layer: MobilePageTransitionLayer, interactive: boolean) => ReactNode
}

export default function MobilePageTransitionHost({
    layers,
    lastNavigation,
    edgeBackForegroundKey,
    interactive,
    renderLayer,
}: MobilePageTransitionHostProps) {
    return (
        <div className="mobile-page-transition-host">
            {layers.map((layer, index) => {
                const isTop = index === layers.length - 1
                const isUnderlay = index === layers.length - 2
                const foregroundIndex = edgeBackForegroundKey
                    ? layers.findIndex(candidate => candidate.key === edgeBackForegroundKey)
                    : -1
                const isEdgeBackForeground = index === foregroundIndex
                const isEdgeBackUnderlay = foregroundIndex > 0 && index === foregroundIndex - 1
                const layerInteractive = interactive && isTop
                return (
                    <div
                        key={layer.key}
                        className={`mobile-app__page mobile-page-transition-host__layer${isTop ? ' is-top' : ''}${isUnderlay ? ' is-underlay' : ''}${isEdgeBackForeground ? ' is-edge-back-foreground' : ''}${isEdgeBackUnderlay ? ' is-edge-back-underlay' : ''}`}
                        data-mobile-nav={isTop ? lastNavigation : 'none'}
                        aria-hidden={!layerInteractive}
                        inert={!layerInteractive}
                    >
                        {renderLayer(layer, layerInteractive)}
                        {isUnderlay && <span className="mobile-page-transition-host__underlay-scrim" aria-hidden="true"/>}
                    </div>
                )
            })}
        </div>
    )
}
