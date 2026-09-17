// 本模块只编辑已有受管图片的说明文字；资产导入与引用替换须等待可鉴权的逻辑资产服务。

import {parseFragment, type DefaultTreeAdapterTypes} from 'parse5'
import {documentFingerprint, idempotencyKey, interactionId, type EditIntent} from '../domain/kernel/index.ts'
import {RFC_9562_UUID_PATTERN} from '../domain/uuidPolicy.ts'
import {requireKernelComponentHandle, type KernelDraftEditRequest} from './documentKernelDraftRuntime.ts'

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

export interface ManagedImageDescription {
    readonly nodeId: string
    readonly alt: string
    readonly expectedAlt: string | null
    readonly caption: string | null
    readonly captionKind: 'absent' | 'plain' | 'structured'
    readonly captionEditable: boolean
    readonly captionReason: string | null
    readonly reference: {
        readonly status: 'unverified' | 'missing' | 'invalid'
        readonly assetId: string | null
        readonly message: string
    }
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node && 'attrs' in node
}

function children(node: HtmlNode): HtmlNode[] {
    if (isElement(node) && node.tagName === 'template' && 'content' in node) {
        return node.content.childNodes
    }
    return 'childNodes' in node ? node.childNodes : []
}

function attribute(element: HtmlElement, name: string): string | null {
    return element.attrs.find(item => item.name === name)?.value ?? null
}

function descendants(node: HtmlNode, predicate: (element: HtmlElement) => boolean): HtmlElement[] {
    const result: HtmlElement[] = []
    const visit = (current: HtmlNode): void => {
        if (isElement(current) && predicate(current)) result.push(current)
        children(current).forEach(visit)
    }
    visit(node)
    return result
}

function semanticText(node: HtmlNode): string {
    if ('value' in node && typeof node.value === 'string') return node.value
    if (isElement(node) && node.tagName === 'br') return '\n'
    return children(node).map(semanticText).join('')
}

function referenceState(image: HtmlElement): ManagedImageDescription['reference'] {
    const src = attribute(image, 'src')
    const declaredId = attribute(image, 'data-fc-asset-id')
    if (!src || !declaredId) {
        return {status: 'missing', assetId: null, message: '图片缺少受管资产引用，无法显示原件。'}
    }
    const match = /^fcasset:\/\/([0-9a-f-]+)$/iu.exec(src)
    if (!match || !RFC_9562_UUID_PATTERN.test(match[1]) ||
        match[1].toLowerCase() !== declaredId.toLowerCase()) {
        return {status: 'invalid', assetId: null, message: '图片引用格式或资产身份不一致；本机路径与运行时 URL 均不可使用。'}
    }
    return {
        status: 'unverified',
        assetId: match[1].toLowerCase(),
        message: '当前尚无页面资产查询与受管加载服务，原件存在性和项目归属无法验证；画布仅显示占位。',
    }
}

export function readManagedImageDescription(
    articleHtml: string,
    nodeId: string,
): ManagedImageDescription | null {
    const root = parseFragment(articleHtml, {scriptingEnabled: false})
    const matches = descendants(root, element =>
        attribute(element, 'data-fc-node-id')?.toLowerCase() === nodeId.toLowerCase() &&
        attribute(element, 'data-fc-node-kind') === 'asset',
    )
    if (matches.length !== 1) return null
    const component = matches[0]
    const images = descendants(component, element => element.tagName === 'img')
    if (images.length !== 1) return null
    const image = images[0]
    const captions = component.tagName === 'figure'
        ? children(component).filter((child): child is HtmlElement =>
            isElement(child) && child.tagName === 'figcaption')
        : []
    if (captions.length > 1) return null
    const nestedCaption = descendants(component, element => element.tagName === 'figcaption').length !== captions.length
    const caption = captions[0]
    const captionKind = !caption
        ? 'absent'
        : children(caption).every(child =>
            !isElement(child) || (child.tagName === 'br' && child.attrs.length === 0))
            ? 'plain'
            : 'structured'
    const expectedAlt = attribute(image, 'alt')
    return {
        nodeId: nodeId.toLowerCase(),
        alt: expectedAlt ?? '',
        expectedAlt,
        caption: caption ? semanticText(caption) : null,
        captionKind,
        captionEditable: component.tagName === 'figure' && !nestedCaption,
        captionReason: component.tagName !== 'figure'
            ? '只有 figure 图片组件支持图注。'
            : nestedCaption ? '嵌套图注无法由可视编辑器安全接管。' : null,
        reference: referenceState(image),
    }
}

export function createImageDescriptionEditRequest(
    current: ManagedImageDescription,
    next: {alt: string; caption: string | null},
    allocateRequestId: () => string = () => crypto.randomUUID(),
): KernelDraftEditRequest | null {
    const changeAlt = next.alt !== current.alt
    const changeCaption = next.caption !== current.caption
    if (changeCaption && !current.captionEditable) {
        throw new TypeError('只有 figure 图片组件支持图注。')
    }
    if (!changeAlt && !changeCaption) return null
    const requestId = allocateRequestId()
    return {
        nodeIds: [current.nodeId],
        idempotencyKey: idempotencyKey(`image-description:${requestId}`),
        interactionId: interactionId(`image-description:${documentFingerprint(requestId)}`),
        authorizedScopes: ['entry'],
        createIntents(handles) {
            const component = requireKernelComponentHandle(handles, current.nodeId)
            const target = {kind: 'component-root' as const, component}
            const intents: EditIntent[] = []
            if (changeAlt) intents.push({
                kind: 'set-asset-alt', target, expectedAlt: current.expectedAlt,
                alt: next.alt, destinationScope: 'entry',
            })
            if (changeCaption) intents.push({
                kind: 'set-asset-caption', target,
                expected: current.captionKind === 'absent'
                    ? {kind: 'absent'}
                    : {kind: current.captionKind, text: current.caption ?? ''},
                caption: next.caption,
                destinationScope: 'entry',
            })
            return intents
        },
    }
}
