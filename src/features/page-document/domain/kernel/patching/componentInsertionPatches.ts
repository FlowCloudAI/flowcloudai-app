// 本模块把受控组件创建编译为作者 HTML 插入及必要的初始条件样式；身份与内容均由宿主参数确定。

import {
    createComponentMarkup,
    DEFAULT_TABLE_CELL_COUNT,
    type ComponentCreationInput,
} from '../components/index.ts'
import type {HtmlCompositionElement} from '../composition/index.ts'
import type {NodeId} from '../contracts/identity.ts'
import {ENTRY_DESKTOP_MEDIA_QUERY, type DocumentNodeKind} from '../contracts/primitives.ts'
import {utf16Range, type SourceDocument} from '../contracts/source.ts'
import {elementInnerRange, elementRange, parseStylesheetSyntax} from '../syntax/index.ts'
import type {SourcePatch} from './sourcePatches.ts'

export type ComponentInsertionPatchResult =
    | {readonly status: 'ready'; readonly patches: readonly SourcePatch[]}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

export function createComponentInsertionPatches(
    article: SourceDocument,
    stylesheet: SourceDocument,
    sourceContainer: HtmlCompositionElement,
    after: HtmlCompositionElement | null,
    componentKind: DocumentNodeKind,
    newNodeId: NodeId,
    newChildNodeIds: readonly NodeId[],
    assetId: NodeId | null,
): ComponentInsertionPatchResult {
    if (
        article.key.file !== 'article.html' ||
        stylesheet.key.file !== 'style.css' ||
        article.key.scope !== stylesheet.key.scope
    ) {
        return rejected('component-source-invalid', '组件结构与初始样式必须写入同一作用域。')
    }
    const input = creationInput(componentKind, newChildNodeIds, assetId)
    if (input.status === 'rejected') return input
    let markup: string | null
    try {
        markup = createComponentMarkup(componentKind, newNodeId, input.input)
    } catch {
        return rejected('component-creation-input-invalid', '组件创建身份或参数无效。')
    }
    if (!markup) {
        return rejected('component-creation-unsupported', `${componentKind} 不能独立创建。`)
    }
    const parentInner = elementInnerRange(sourceContainer)
    const afterRange = after ? elementRange(after) : null
    if (!parentInner || (after && !afterRange)) {
        return rejected('source-location-missing', '无法定位组件插入位置。')
    }
    const insertionOffset = afterRange?.to ?? parentInner.from
    const patches: SourcePatch[] = [
        Object.freeze({
            source: article.key,
            range: utf16Range(insertionOffset, insertionOffset),
            expected: '',
            insert: markup,
        }),
    ]
    if (componentKind === 'container') {
        const parsed = parseStylesheetSyntax(stylesheet.content, stylesheet.key)
        if (!parsed.root || parsed.diagnostics.length > 0) {
            return rejected('invalid-stylesheet', '现有样式表语法无效，不能创建容器初始布局。')
        }
        const separator =
            stylesheet.content.length === 0 || stylesheet.content.endsWith('\n') ? '' : '\n'
        patches.push(
            Object.freeze({
                source: stylesheet.key,
                range: utf16Range(stylesheet.content.length, stylesheet.content.length),
                expected: '',
                insert: `${separator}${containerInitialCss(newNodeId)}`,
            }),
        )
    }
    return Object.freeze({status: 'ready', patches: Object.freeze(patches)})
}

type CreationInputResult =
    | {readonly status: 'ready'; readonly input: ComponentCreationInput}
    | {readonly status: 'rejected'; readonly code: string; readonly message: string}

function creationInput(
    kind: DocumentNodeKind,
    childNodeIds: readonly NodeId[],
    assetId: NodeId | null,
): CreationInputResult {
    const expectedChildren = kind === 'list' ? 1 : kind === 'table' ? DEFAULT_TABLE_CELL_COUNT : 0
    if (childNodeIds.length !== expectedChildren) {
        return rejected(
            'component-child-identity-count-invalid',
            `${kind} 创建需要 ${expectedChildren} 个子组件身份。`,
        )
    }
    if (kind === 'asset' && assetId === null) {
        return rejected('component-asset-required', '单张图片组件必须引用一个词条资产。')
    }
    if (assetId !== null && kind !== 'asset' && kind !== 'gallery') {
        return rejected('component-asset-not-applicable', `${kind} 创建参数不接受资产引用。`)
    }
    return Object.freeze({
        status: 'ready',
        input: Object.freeze({
            assetId: assetId ?? undefined,
            listItemId: kind === 'list' ? childNodeIds[0] : undefined,
            tableCellIds: kind === 'table' ? Object.freeze([...childNodeIds]) : undefined,
        }),
    })
}

function containerInitialCss(nodeId: NodeId): string {
    const selector = `[data-fc-node-id="${nodeId}"][data-fc-node-kind="container"]`
    return `@layer fc-node {
  ${selector} {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }
  @media ${ENTRY_DESKTOP_MEDIA_QUERY} {
    ${selector} {
      gap: 1.5rem;
    }
  }
}
`
}

function rejected(
    code: string,
    message: string,
): Extract<ComponentInsertionPatchResult | CreationInputResult, {readonly status: 'rejected'}> {
    return Object.freeze({status: 'rejected', code, message})
}
