// 本模块只判断属性在当前父子布局中是否适用；它通过回调读取 display 等事实，不自行解析样式源码。

import type {DefaultTreeAdapterTypes} from 'parse5'
import type {HtmlCompositionElement} from '../composition/index.ts'
import type {
    EffectiveAuthorValue,
    PropertyApplicability,
    PropertyConfidence,
} from '../contracts/analysis.ts'
import {defaultDisplay} from './propertySemantics.ts'

export interface ApplicabilityStyleResolution {
    readonly effective: EffectiveAuthorValue | null
    readonly confidence: PropertyConfidence
}

export function inspectPropertyApplicability(
    element: HtmlCompositionElement,
    property: string,
    resolve: (element: HtmlCompositionElement, property: string) => ApplicabilityStyleResolution,
    onParentDependency: (element: HtmlCompositionElement) => void,
): PropertyApplicability {
    const ownGrid = property.startsWith('grid-template') || property.startsWith('grid-auto')
    const ownFlex = property === 'flex-direction' || property === 'flex-wrap'
    const ownGridOrFlex =
        property === 'gap' ||
        property === 'row-gap' ||
        property === 'column-gap' ||
        property === 'align-items' ||
        property === 'align-content' ||
        property === 'justify-content'
    const gridItem =
        property === 'grid-area' ||
        property === 'grid-row' ||
        property === 'grid-column' ||
        property === 'justify-self'
    const flexItem =
        property === 'flex-grow' || property === 'flex-shrink' || property === 'flex-basis'
    if (!ownGrid && !ownFlex && !ownGridOrFlex && !gridItem && !flexItem) {
        return {kind: 'applicable'}
    }
    const displayElement = gridItem || flexItem ? parentElement(element) : element
    if (!displayElement) return {kind: 'not-applicable', reason: '目标没有可供判断的父布局。'}
    if (displayElement !== element) onParentDependency(displayElement)
    const display = resolve(displayElement, 'display')
    if (display.confidence.kind !== 'proven') {
        return {kind: 'unknown', reason: `无法确定布局类型：${display.confidence.reason}`}
    }
    const displayValue = display.effective?.resolvedValue ?? defaultDisplay(displayElement.tagName)
    const isGrid = /(?:^|\s)(?:inline-)?grid(?:\s|$)/iu.test(displayValue)
    const isFlex = /(?:^|\s)(?:inline-)?flex(?:\s|$)/iu.test(displayValue)
    if ((ownGrid || gridItem) && !isGrid) {
        return {kind: 'not-applicable', reason: '该属性只在 Grid 布局中生效。'}
    }
    if ((ownFlex || flexItem) && !isFlex) {
        return {kind: 'not-applicable', reason: '该属性只在 Flex 布局中生效。'}
    }
    if (ownGridOrFlex && !isGrid && !isFlex) {
        const columnCount = resolve(displayElement, 'column-count')
        const columnWidth = resolve(displayElement, 'column-width')
        const countActive =
            columnCount.effective !== null && columnCount.effective.resolvedValue !== 'auto'
        const widthActive =
            columnWidth.effective !== null && columnWidth.effective.resolvedValue !== 'auto'
        if (!countActive && !widthActive) {
            return {kind: 'not-applicable', reason: '该属性需要 Grid、Flex 或文字分栏布局。'}
        }
    }
    return {kind: 'applicable'}
}

function parentElement(node: HtmlCompositionElement): HtmlCompositionElement | null {
    const parent = node.parentNode
    return parent && isElement(parent) ? parent : null
}

function isElement(node: DefaultTreeAdapterTypes.Node): node is HtmlCompositionElement {
    return 'tagName' in node
}
