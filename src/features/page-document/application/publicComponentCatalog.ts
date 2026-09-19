// 本模块把组件目录调用与契约解析的失败收敛为非阻断结果；页面文档读取仍独立决定会话是否可用。

import {
    parsePublicComponentDefinition,
    type PublicComponentDefinitionContract,
} from '../domain/kernel/contracts/publicComponent.ts'

export interface PublicComponentCatalogResolution {
    readonly definitions: readonly PublicComponentDefinitionContract[]
    readonly warning: string | null
}

export function resolvePublicComponentCatalog(
    latest: PromiseSettledResult<readonly unknown[]>,
    revisions: PromiseSettledResult<readonly unknown[]>,
): PublicComponentCatalogResolution {
    if (latest.status === 'rejected' || revisions.status === 'rejected') {
        return Object.freeze({
            definitions: Object.freeze([]),
            warning: '公共组件目录暂时无法读取；页面文档已继续打开，组件实例会显示缺失状态。',
        })
    }
    let discarded = 0
    const parse = (items: readonly unknown[]) => items.flatMap(item => {
        try {
            return [parsePublicComponentDefinition(item)]
        } catch {
            discarded += 1
            return []
        }
    })
    const latestDefinitions = parse(latest.value)
    const revisionDefinitions = parse(revisions.value)
    return Object.freeze({
        definitions: Object.freeze(
            revisionDefinitions.length > 0 ? revisionDefinitions : latestDefinitions,
        ),
        warning: discarded > 0
            ? `公共组件目录中有 ${discarded} 条定义无法解析，已跳过这些定义。`
            : null,
    })
}
