// 本模块把公共组件创建表单的逐行 schema 收敛为后端契约；源码安全仍由 Rust 创建命令裁决。

import type {CreatePageDocumentComponentInput} from '../../../api/pageDocument.ts'

const SCHEMA_NAME = /^[a-z][a-z0-9-]{0,63}$/u

export interface PublicComponentDefinitionFormValue {
    readonly name: string
    readonly category: string
    readonly html: string
    readonly css: string
    readonly propertyLines: string
    readonly partLines: string
}

function meaningfulLines(value: string): Array<{line: number; value: string}> {
    return value.split(/\r?\n/u).flatMap((line, index) => {
        const trimmed = line.trim()
        return trimmed && !trimmed.startsWith('#') ? [{line: index + 1, value: trimmed}] : []
    })
}

function requiredFlag(value: string, line: number): boolean {
    if (value === 'required') return true
    if (value === 'optional') return false
    throw new TypeError(`第 ${line} 行必须用 required 或 optional 标明是否必填。`)
}

function schemaToken(value: string, label: string, line: number): string {
    if (!SCHEMA_NAME.test(value)) {
        throw new TypeError(`第 ${line} 行的${label}必须是小写字母开头的短横线名称。`)
    }
    return value
}

export function buildPublicComponentCreationInput(
    projectId: string,
    value: PublicComponentDefinitionFormValue,
): CreatePageDocumentComponentInput {
    const name = value.name.trim()
    const category = value.category.trim()
    if (!name || !category) throw new TypeError('组件名称和分类不能为空。')
    if (!value.html.trim()) throw new TypeError('组件 HTML 不能为空。')

    const propertySchema = meaningfulLines(value.propertyLines).map(({line, value: source}) => {
        const fields = source.split('|').map(item => item.trim())
        if (fields.length !== 3) {
            throw new TypeError(`属性 schema 第 ${line} 行应为“名称 | 类型 | required/optional”。`)
        }
        return {
            name: schemaToken(fields[0], '属性名', line),
            valueType: schemaToken(fields[1], '类型', line),
            required: requiredFlag(fields[2], line),
        }
    })
    const partSchema = meaningfulLines(value.partLines).map(({line, value: source}) => {
        const fields = source.split('|').map(item => item.trim())
        if (fields.length !== 3) {
            throw new TypeError(`插槽 schema 第 ${line} 行应为“名称 | 接受类型列表 | required/optional”。`)
        }
        const accepts = fields[1].split(',').map(item => schemaToken(item.trim(), '内容类型', line))
        if (accepts.length === 0) throw new TypeError(`插槽 schema 第 ${line} 行缺少内容类型。`)
        return {
            name: schemaToken(fields[0], '插槽名', line),
            accepts,
            required: requiredFlag(fields[2], line),
        }
    })
    const unique = (items: readonly string[], label: string) => {
        if (new Set(items).size !== items.length) throw new TypeError(`${label}不能重复。`)
    }
    unique(propertySchema.map(item => item.name), '属性名')
    unique(partSchema.map(item => item.name), '插槽名')
    for (const part of partSchema) unique(part.accepts, `插槽 ${part.name} 的内容类型`)

    return {
        projectId,
        name,
        category,
        html: value.html,
        css: value.css,
        propertySchema,
        partSchema,
        styleVariableSchema: [],
    }
}
