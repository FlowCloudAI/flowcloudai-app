// 本模块定义引用式公共组件的稳定序列化契约；存储、修订发布与界面流程由后续领域实现负责。

import {nodeId, type NodeId} from './identity.ts'

const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u
const SCOPE_KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u
const VALUE_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u
const STYLE_VARIABLE_PATTERN = /^--[a-z][a-z0-9-]{0,62}$/u
const MAX_TEXT_LENGTH = 128

export interface PublicComponentPropertySchema {
    readonly name: string
    readonly valueType: string
    readonly required: boolean
}

export interface PublicComponentPartSchema {
    readonly name: string
    readonly accepts: readonly string[]
    readonly required: boolean
}

export interface PublicComponentStyleVariableSchema {
    readonly name: string
    readonly syntax: string
    readonly initialValue: string | null
}

export interface PublicComponentPreview {
    readonly assetId: NodeId
    readonly mediaType: 'image/webp'
}

export interface PublicComponentOwnershipScope {
    /** 开放字符串；当前领域服务只构造和授权 project。 */
    readonly kind: string
    readonly id: string
}

export interface PublicComponentDefinitionContract {
    readonly componentId: NodeId
    readonly revision: number
    readonly html: string
    readonly css: string
    readonly propertySchema: readonly PublicComponentPropertySchema[]
    readonly partSchema: readonly PublicComponentPartSchema[]
    readonly styleVariableSchema: readonly PublicComponentStyleVariableSchema[]
    readonly assetDependencies: readonly NodeId[]
    readonly name: string
    readonly category: string
    readonly preview: PublicComponentPreview | null
    readonly ownershipScope: PublicComponentOwnershipScope
}

/** 按实例声明的修订解析定义；缺省或 latest 跟随当前最高修订。 */
export function selectPublicComponentDefinition(
    definitions: readonly PublicComponentDefinitionContract[],
    componentId: string | undefined,
    revision: string | undefined,
): PublicComponentDefinitionContract | null {
    if (!componentId) return null
    const matching = definitions.filter(item => item.componentId.toLowerCase() === componentId.toLowerCase())
    if (matching.length === 0) return null
    if (!revision || revision === 'latest') {
        return matching.reduce((latest, item) => item.revision > latest.revision ? item : latest)
    }
    if (!/^\d+$/u.test(revision)) return null
    const parsed = Number(revision)
    if (!Number.isSafeInteger(parsed) || parsed < 1) return null
    return matching.find(item => item.revision === parsed) ?? null
}

export function createProjectComponentOwnershipScope(
    projectId: string,
): PublicComponentOwnershipScope {
    return Object.freeze({kind: 'project', id: nodeId(projectId)})
}

export function parsePublicComponentDefinition(
    value: unknown,
): PublicComponentDefinitionContract {
    const record = exactRecord(value, [
        'componentId',
        'revision',
        'html',
        'css',
        'propertySchema',
        'partSchema',
        'styleVariableSchema',
        'assetDependencies',
        'name',
        'category',
        'preview',
        'ownershipScope',
    ])
    if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 1) {
        throw new TypeError('公共组件 revision 必须是正安全整数。')
    }
    if (typeof record.html !== 'string' || typeof record.css !== 'string') {
        throw new TypeError('公共组件 HTML 与 CSS 必须是字符串。')
    }
    const propertySchema = parseArray(record.propertySchema, 'propertySchema', item => {
        const property = exactRecord(item, ['name', 'valueType', 'required'])
        return Object.freeze({
            name: schemaName(property.name, '组件属性名称'),
            valueType: patternString(property.valueType, VALUE_TYPE_PATTERN, '组件属性类型'),
            required: booleanValue(property.required, '组件属性 required'),
        })
    })
    const partSchema = parseArray(record.partSchema, 'partSchema', item => {
        const part = exactRecord(item, ['name', 'accepts', 'required'])
        const accepts = parseArray(part.accepts, 'part.accepts', candidate =>
            patternString(candidate, VALUE_TYPE_PATTERN, '组件 part 内容类型'),
        )
        requireUnique(accepts, '组件 part 内容类型')
        return Object.freeze({
            name: schemaName(part.name, '组件 part 名称'),
            accepts,
            required: booleanValue(part.required, '组件 part required'),
        })
    })
    const styleVariableSchema = parseArray(
        record.styleVariableSchema,
        'styleVariableSchema',
        item => {
            const variable = exactRecord(item, ['name', 'syntax', 'initialValue'])
            if (typeof variable.syntax !== 'string' || variable.syntax.length > MAX_TEXT_LENGTH) {
                throw new TypeError('组件样式变量 syntax 必须是不超过 128 字符的字符串。')
            }
            if (
                variable.initialValue !== null &&
                (typeof variable.initialValue !== 'string' ||
                    variable.initialValue.length > MAX_TEXT_LENGTH)
            ) {
                throw new TypeError('组件样式变量 initialValue 必须为空或短字符串。')
            }
            return Object.freeze({
                name: patternString(variable.name, STYLE_VARIABLE_PATTERN, '组件样式变量名称'),
                syntax: variable.syntax,
                initialValue: variable.initialValue as string | null,
            })
        },
    )
    requireUnique(propertySchema.map(item => item.name), '组件属性名称')
    requireUnique(partSchema.map(item => item.name), '组件 part 名称')
    requireUnique(styleVariableSchema.map(item => item.name), '组件样式变量名称')

    const assetDependencies = parseArray(
        record.assetDependencies,
        'assetDependencies',
        nodeId,
    )
    requireUnique(assetDependencies, '组件资源依赖')
    const name = shortText(record.name, '公共组件名称')
    const category = shortText(record.category, '公共组件分类')
    return Object.freeze({
        componentId: nodeId(record.componentId),
        revision: Number(record.revision),
        html: record.html,
        css: record.css,
        propertySchema,
        partSchema,
        styleVariableSchema,
        assetDependencies,
        name,
        category,
        preview: parsePreview(record.preview),
        ownershipScope: parseOwnershipScope(record.ownershipScope),
    })
}

function parsePreview(value: unknown): PublicComponentPreview | null {
    if (value === null) return null
    const preview = exactRecord(value, ['assetId', 'mediaType'])
    if (preview.mediaType !== 'image/webp') {
        throw new TypeError('公共组件预览必须是 image/webp。')
    }
    return Object.freeze({assetId: nodeId(preview.assetId), mediaType: 'image/webp'})
}

function parseOwnershipScope(value: unknown): PublicComponentOwnershipScope {
    const scope = exactRecord(value, ['kind', 'id'])
    const kind = patternString(scope.kind, SCOPE_KIND_PATTERN, '组件归属范围种类')
    const id = shortText(scope.id, '组件归属范围 ID')
    if (kind === 'project') nodeId(id)
    return Object.freeze({kind, id})
}

function schemaName(value: unknown, label: string): string {
    return patternString(value, SCHEMA_NAME_PATTERN, label)
}

function patternString(value: unknown, pattern: RegExp, label: string): string {
    if (typeof value !== 'string' || !pattern.test(value)) {
        throw new TypeError(`${label}格式无效。`)
    }
    return value
}

function shortText(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TEXT_LENGTH) {
        throw new TypeError(`${label} 必须是 1–${MAX_TEXT_LENGTH} 字符的字符串。`)
    }
    return value
}

function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`${label} 必须是布尔值。`)
    return value
}

function parseArray<T>(
    value: unknown,
    label: string,
    parse: (item: unknown) => T,
): readonly T[] {
    if (!Array.isArray(value)) throw new TypeError(`公共组件 ${label} 必须是数组。`)
    return Object.freeze(value.map(parse))
}

function requireUnique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length) throw new TypeError(`${label}不能重复。`)
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('公共组件契约值必须是对象。')
    }
    const record = value as Record<string, unknown>
    const actual = Object.keys(record).sort()
    const expected = [...keys].sort()
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new TypeError('公共组件契约包含缺失或未知字段。')
    }
    return record
}
