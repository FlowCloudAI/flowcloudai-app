// 本模块统一识别 CSS 值中可能发起加载的资源位置，供安全预检与派生预览改写共用同一语义。
import valueParser from 'postcss-value-parser'

const DIRECT_RESOURCE_FUNCTIONS = new Set(['url', 'src'])
const STRING_RESOURCE_FUNCTIONS = new Set(['image', 'image-set', '-webkit-image-set'])

type CssValueNode = ReturnType<typeof valueParser>['nodes'][number]
type CssValueFunctionNode = Extract<CssValueNode, {type: 'function'}>

interface ResourceReference {
    value: string
    replace?: (next: string) => void
}

function directFunctionReference(node: CssValueFunctionNode): ResourceReference {
    const meaningful = node.nodes.filter(
        child => child.type !== 'space' && child.type !== 'comment',
    )
    if (
        meaningful.length === 1 &&
        (meaningful[0].type === 'string' || meaningful[0].type === 'word')
    ) {
        const valueNode = meaningful[0]
        return {
            value: valueNode.value,
            replace: next => {
                valueNode.value = next
            },
        }
    }
    return {value: valueParser.stringify(node.nodes).trim()}
}

function walkResourceReferences(
    parsed: ReturnType<typeof valueParser>,
    visitor: (reference: ResourceReference) => void,
): void {
    parsed.walk(node => {
        if (node.type !== 'function') return
        const functionName = node.value.toLowerCase()
        if (DIRECT_RESOURCE_FUNCTIONS.has(functionName)) {
            visitor(directFunctionReference(node))
            return false
        }
        if (!STRING_RESOURCE_FUNCTIONS.has(functionName)) return
        for (const child of node.nodes) {
            if (child.type !== 'string') continue
            visitor({
                value: child.value,
                replace: next => {
                    child.value = next
                },
            })
        }
    })
}

export function visitCssResourceReferences(
    value: string,
    visitor: (reference: string) => void,
): void {
    walkResourceReferences(valueParser(value), reference => visitor(reference.value))
}

export function rewriteCssResourceReferences(
    value: string,
    resolve: (reference: string) => string | undefined,
): string {
    const parsed = valueParser(value)
    let changed = false
    walkResourceReferences(parsed, reference => {
        const next = resolve(reference.value)
        if (next === undefined || next === reference.value || !reference.replace) return
        reference.replace(next)
        changed = true
    })
    return changed ? valueParser.stringify(parsed.nodes) : value
}
