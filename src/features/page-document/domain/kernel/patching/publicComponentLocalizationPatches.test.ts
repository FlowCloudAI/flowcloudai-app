// 本测试固定公共组件本地化补丁的身份退休与引用重定向语义。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import postcss from 'postcss'
import {parseFragment, type DefaultTreeAdapterTypes} from 'parse5'
import {captureSelectedNodeAsPublicComponent} from '../../../application/publicComponentCapture.ts'
import {expandPublicComponentInstances} from '../../engine/componentExpansion.ts'
import {HtmlSourceMapBuilder} from '../composition/index.ts'
import type {ReadContext} from '../contracts/context.ts'
import type {PublicComponentDefinitionContract} from '../contracts/publicComponent.ts'
import {nodeId, sourceKey, type SourceDocument} from '../contracts/index.ts'
import {createSelectorEnvironment} from '../styles/index.ts'
import {findElementsByAttribute, parseHtmlSource} from '../syntax/index.ts'
import {
    countPublicComponentLocalizationNodes,
    createPublicComponentLocalizationPatches,
} from './publicComponentLocalizationPatches.ts'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const COMPONENT_ID = '22222222-2222-4222-8222-222222222222'
const OLD_NODE_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'
const NEW_ROOT_ID = '55555555-5555-4555-8555-555555555555'
const NEW_PARAGRAPH_ID = '66666666-6666-4666-8666-666666666666'
const NEW_SECTION_ID = '99999999-9999-4999-8999-999999999999'
const BASE_CONTEXT: ReadContext = Object.freeze({
    viewport: 'desktop',
    interactions: Object.freeze({hover: true, focusWithin: true}),
    direction: 'ltr',
    writingMode: 'horizontal-tb',
})

type HtmlNode = DefaultTreeAdapterTypes.Node
type HtmlElement = DefaultTreeAdapterTypes.Element

const definition: PublicComponentDefinitionContract = {
    componentId: COMPONENT_ID,
    revision: 1,
    html: '<section><p>静态正文</p></section>',
    css: `@layer fc-component { [data-fc-component="${COMPONENT_ID}"] { display: grid; } }`,
    propertySchema: [],
    partSchema: [],
    styleVariableSchema: [],
    assetDependencies: [],
    name: '本地化测试',
    category: '基础',
    preview: null,
    ownershipScope: {kind: 'project', id: PROJECT_ID},
}

function document(file: 'article.html' | 'style.css', content: string): SourceDocument {
    return {
        key: sourceKey('entry', file),
        content,
        contentHash: `fixture:${file}`,
        persistentRevision: 1,
    }
}

function isElement(node: HtmlNode): node is HtmlElement {
    return 'tagName' in node
}

function childNodes(node: HtmlNode): readonly DefaultTreeAdapterTypes.ChildNode[] {
    return 'childNodes' in node ? node.childNodes : []
}

function elementPaths(root: HtmlNode): readonly {element: HtmlElement; path: string}[] {
    const result: Array<{element: HtmlElement; path: string}> = []
    const visit = (node: HtmlNode, path: string): void => {
        const elements = childNodes(node).filter(isElement)
        elements.forEach((element, index) => {
            const childPath = path ? `${path}/${index}` : String(index)
            result.push({element, path: childPath})
            visit(element, childPath)
        })
    }
    visit(root, '')
    return result
}

function selectors(css: string): readonly string[] {
    const result: string[] = []
    postcss.parse(css).walkRules(rule => result.push(...postcss.list.comma(rule.selector)))
    return result
}

function matchingPaths(root: DefaultTreeAdapterTypes.DocumentFragment, selector: string): readonly string[] {
    const environment = createSelectorEnvironment(new HtmlSourceMapBuilder().finish(root))
    return elementPaths(root)
        .filter(item => environment.match(selector, item.element, BASE_CONTEXT).condition === 'active')
        .map(item => item.path)
}

function allocatedIds(count: number): readonly ReturnType<typeof nodeId>[] {
    return Array.from({length: count}, (_, index) =>
        nodeId(`a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    )
}

function localize(
    candidate: PublicComponentDefinitionContract,
    instance = `<div class="instance-shell" style="padding: 1rem" data-fc-node-id="${OLD_NODE_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_ID}" data-fc-component-revision="latest" data-fc-instance="${INSTANCE_ID}"></div>`,
): {html: string; css: string} {
    const article = document('article.html', instance)
    const parsed = parseHtmlSource(instance, {mode: 'fragment', scope: 'entry'})
    const element = findElementsByAttribute(parsed, 'data-fc-node-id', OLD_NODE_ID)[0]
    assert.ok(element)
    const result = createPublicComponentLocalizationPatches(
        article,
        document('style.css', ''),
        element,
        candidate,
        allocatedIds(countPublicComponentLocalizationNodes(instance, candidate)),
        [],
        [OLD_NODE_ID, INSTANCE_ID],
    )
    assert.equal(result.status, 'ready')
    if (result.status !== 'ready') throw new TypeError(result.message)
    const htmlPatch = result.patches.find(item => item.source.file === 'article.html')
    const cssPatch = result.patches.find(item => item.source.file === 'style.css')
    assert.ok(htmlPatch)
    return {html: htmlPatch.insert, css: cssPatch?.insert ?? ''}
}

function assertSelectorParity(
    candidate: PublicComponentDefinitionContract,
    instance?: string,
): void {
    const sourceInstance = instance ?? `<div class="instance-shell" style="padding: 1rem" data-fc-node-id="${OLD_NODE_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_ID}" data-fc-component-revision="latest" data-fc-instance="${INSTANCE_ID}"></div>`
    const expanded = parseFragment(sourceInstance)
    expandPublicComponentInstances(expanded, [candidate])
    const localized = localize(candidate, sourceInstance)
    const localizedTree = parseFragment(localized.html)
    const componentSelectors = selectors(candidate.css)
    const localSelectors = selectors(localized.css)
    assert.equal(localSelectors.length, componentSelectors.length)
    componentSelectors.forEach((selector, index) => {
        assert.deepEqual(
            matchingPaths(localizedTree, localSelectors[index]),
            matchingPaths(expanded, selector),
            `${selector} 本地化前后的命中元素必须一致`,
        )
    })
}

describe('公共组件本地化补丁', () => {
    it('退休实例身份并把指向实例节点的引用改指新根节点', () => {
        const html = `<div data-fc-node-id="${OLD_NODE_ID}" data-fc-node-kind="component" data-fc-component="${COMPONENT_ID}" data-fc-component-revision="latest" data-fc-instance="${INSTANCE_ID}"></div>`
        const article = document('article.html', html)
        const parsed = parseHtmlSource(html, {mode: 'fragment', scope: 'entry'})
        const element = findElementsByAttribute(parsed, 'data-fc-node-id', OLD_NODE_ID)[0]
        assert.ok(element)
        const result = createPublicComponentLocalizationPatches(
            article,
            document('style.css', ''),
            element,
            definition,
            [nodeId(NEW_ROOT_ID), nodeId(NEW_SECTION_ID), nodeId(NEW_PARAGRAPH_ID)],
            [{targetObjectId: '77777777-7777-4777-8777-777777777777', targetNodeId: nodeId(OLD_NODE_ID), degraded: false}],
            [OLD_NODE_ID, INSTANCE_ID],
        )
        assert.equal(result.status, 'ready')
        if (result.status !== 'ready') return
        assert.deepEqual(result.identity.retiredNodeIds, [OLD_NODE_ID])
        assert.equal(result.identity.retiredInstanceId, INSTANCE_ID)
        assert.deepEqual(result.identity.references, [{
            targetObjectId: '77777777-7777-4777-8777-777777777777',
            targetNodeId: NEW_ROOT_ID,
            degraded: false,
        }])
    })

    for (const candidate of [
        {
            name: '单一可推断根元素',
            html: '<section class="definition-root"><p class="definition-child">正文</p></section>',
        },
        {
            name: '单一不可推断根元素',
            html: '<span class="definition-root"><em class="definition-child">正文</em></span>',
        },
        {
            name: '多个根元素',
            html: '<section class="definition-root">甲</section><p class="definition-child">乙</p>',
        },
    ] as const) {
        it(`${candidate.name}本地化后保持组件选择器的命中元素`, () => {
            assertSelectorParity({
                ...definition,
                name: candidate.name,
                html: candidate.html,
                css: `@layer fc-component {
                    [data-fc-component="${COMPONENT_ID}"] { display: grid; }
                    [data-fc-component="${COMPONENT_ID}"] .definition-root { color: red; }
                    [data-fc-component="${COMPONENT_ID}"] .definition-child { font-weight: 700; }
                }`,
            })
        })
    }

    it('保存节点、插入实例再本地化后根元素与子元素样式仍命中', () => {
        const sourceRootId = '77777777-7777-4777-8777-777777777777'
        const sourceChildId = '88888888-8888-4888-8888-888888888888'
        const source = `<section data-fc-node-id="${sourceRootId}" data-fc-node-kind="container"><p data-fc-node-id="${sourceChildId}" data-fc-node-kind="paragraph">往返正文</p></section>`
        const captured = captureSelectedNodeAsPublicComponent(
            source,
            `@layer fc-node {
                [data-fc-node-id="${sourceRootId}"] { display: grid; }
                [data-fc-node-id="${sourceChildId}"] { color: red; }
            }`,
            sourceRootId,
            COMPONENT_ID,
        )
        const candidate: PublicComponentDefinitionContract = {
            ...definition,
            name: '捕获往返',
            html: captured.form.html,
            css: captured.form.css,
        }
        assertSelectorParity(candidate)
    })
})
