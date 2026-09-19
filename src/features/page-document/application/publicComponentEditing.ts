// 本模块把公共组件面板绑定到页面文档内核；定义内容只用于建立稳定引用，不复制到作者源码。
import {
    documentFingerprint,
    idempotencyKey,
    interactionId,
    nodeId,
    allocateFreshNodeId,
    type NodeIdentityReference,
    type ComponentHandle,
    type EditIntent,
} from '../domain/kernel/index.ts'
import {
    requireKernelComponentHandle,
    type KernelComponentBindings,
    type KernelDraftEditRequest,
} from './documentKernelDraftRuntime.ts'
import type {PublicComponentDefinitionContract} from '../domain/kernel/contracts/publicComponent.ts'
import {countPublicComponentLocalizationNodes} from '../domain/kernel/patching/publicComponentLocalizationPatches.ts'

export interface PublicComponentInsertionRequest {
    readonly request: KernelDraftEditRequest
    readonly newNodeId: string
    readonly instanceId: string
}

export interface PublicComponentLocalizationRequest {
    readonly request: KernelDraftEditRequest
    readonly newRootNodeId: string
    readonly retiredInstanceId: string
}

export function createPublicComponentInstanceEditRequest(
    componentNodeId: string,
    properties: Readonly<Record<string, string | null>>,
    styleVariables: Readonly<Record<string, string | null>>,
    requestId: string = crypto.randomUUID(),
): KernelDraftEditRequest {
    return Object.freeze({
        nodeIds: Object.freeze([componentNodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`public-component-edit:${requestId}`),
        interactionId: interactionId(`public-component-edit:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings): readonly EditIntent[] {
            const component = requireKernelComponentHandle(handles, componentNodeId)
            return Object.freeze([Object.freeze({
                kind: 'edit-public-component-instance' as const,
                target: Object.freeze({kind: 'component-root' as const, component}),
                properties: Object.freeze({...properties}),
                styleVariables: Object.freeze({...styleVariables}),
                destinationScope: 'entry' as const,
            })])
        },
    })
}

export function createPublicComponentInsertionRequest(
    parentNodeId: string,
    definition: PublicComponentDefinitionContract,
    allocateId: () => string = () => crypto.randomUUID(),
    initial: {
        readonly properties?: Readonly<Record<string, string>>
        readonly parts?: Readonly<Record<string, string>>
    } = {},
): PublicComponentInsertionRequest {
    const newNodeId = nodeId(allocateId())
    const instanceId = nodeId(allocateId())
    if (newNodeId === instanceId) throw new TypeError('公共组件页面节点与实例身份不能重复。')
    const requestId = allocateId()
    const request: KernelDraftEditRequest = Object.freeze({
        nodeIds: Object.freeze([parentNodeId.toLowerCase()]),
        idempotencyKey: idempotencyKey(`public-component-insert:${requestId}`),
        interactionId: interactionId(`public-component-insert:${documentFingerprint(requestId)}`),
        authorizedScopes: Object.freeze(['entry'] as const),
        createIntents(handles: KernelComponentBindings): readonly EditIntent[] {
            const parent = requireKernelComponentHandle(handles, parentNodeId)
            return Object.freeze([
                Object.freeze({
                    kind: 'insert-public-component' as const,
                    target: Object.freeze({kind: 'component-root' as const, component: parent}),
                    after: null,
                    componentId: definition.componentId,
                    // 面板插入的是跟随定义的实例；固定旧修订由后续明确操作产生。
                    revision: 'latest' as const,
                    instanceId,
                    newNodeId,
                    properties: Object.freeze({...initial.properties}),
                    parts: Object.freeze({...initial.parts}),
                    destinationScope: 'entry' as const,
                }),
            ])
        },
    })
    return Object.freeze({request, newNodeId, instanceId})
}

export function publicComponentInstanceHandle(
    nodeIdValue: string,
    instanceId: string,
): Pick<ComponentHandle, 'nodeId' | 'instanceId'> {
    return Object.freeze({nodeId: nodeId(nodeIdValue), instanceId: instanceId.toLowerCase()})
}

export function createPublicComponentLocalizationRequest(
    componentNodeId: string,
    instanceId: string,
    instanceSource: string,
    definition: PublicComponentDefinitionContract,
    unavailableNodeIds: Iterable<string>,
    references: readonly NodeIdentityReference[] = [],
    allocateId: () => string = () => crypto.randomUUID(),
): PublicComponentLocalizationRequest {
    const count = countPublicComponentLocalizationNodes(instanceSource, definition)
    if (count < 1) throw new TypeError('公共组件展开后没有可建立身份的本地根节点。')
    const unavailable = new Set([...unavailableNodeIds, componentNodeId, instanceId])
    const allocatedNodeIds = Array.from({length: count}, () => {
        const allocated = allocateFreshNodeId(allocateId, unavailable)
        unavailable.add(allocated)
        return allocated
    })
    const requestId = allocateId()
    return Object.freeze({
        newRootNodeId: allocatedNodeIds[0],
        retiredInstanceId: nodeId(instanceId),
        request: Object.freeze({
            nodeIds: Object.freeze([componentNodeId.toLowerCase()]),
            idempotencyKey: idempotencyKey(`public-component-localize:${requestId}`),
            interactionId: interactionId(`public-component-localize:${documentFingerprint(requestId)}`),
            authorizedScopes: Object.freeze(['entry'] as const),
            createIntents(handles: KernelComponentBindings): readonly EditIntent[] {
                const component = requireKernelComponentHandle(handles, componentNodeId)
                return Object.freeze([Object.freeze({
                    kind: 'localize-public-component' as const,
                    target: Object.freeze({kind: 'component-root' as const, component}),
                    definition,
                    allocatedNodeIds: Object.freeze(allocatedNodeIds),
                    references: Object.freeze(references.map(reference => Object.freeze({...reference}))),
                    destinationScope: 'entry' as const,
                })])
            },
        }),
    })
}
