// 本测试固定公共组件创建表单的逐行 schema 格式，避免界面生成无法被组件契约读取的数据。

import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {buildPublicComponentCreationInput} from './publicComponentDefinitionForm.ts'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

describe('公共组件创建表单', () => {
    it('把属性与插槽逐行格式转换为创建命令输入', () => {
        const input = buildPublicComponentCreationInput(PROJECT_ID, {
            name: ' 信息卡片 ',
            category: ' 基础 ',
            html: '<article>{{title}}<div data-fc-part="body"></div></article>',
            css: '@layer fc-component { [data-fc-component=template] { display: grid; } }',
            propertyLines: 'title | text | required',
            partLines: 'body | text, inline | optional',
        })
        assert.equal(input.name, '信息卡片')
        assert.deepEqual(input.propertySchema, [{name: 'title', valueType: 'text', required: true}])
        assert.deepEqual(input.partSchema, [{name: 'body', accepts: ['text', 'inline'], required: false}])
        assert.deepEqual(input.styleVariableSchema, [])
    })

    it('拒绝重复名称与含糊的必填标记', () => {
        assert.throws(() => buildPublicComponentCreationInput(PROJECT_ID, {
            name: '卡片',
            category: '基础',
            html: '<article>正文</article>',
            css: '',
            propertyLines: 'title | text | yes',
            partLines: '',
        }), /required 或 optional/u)
        assert.throws(() => buildPublicComponentCreationInput(PROJECT_ID, {
            name: '卡片',
            category: '基础',
            html: '<article>正文</article>',
            css: '',
            propertyLines: 'title | text | optional\ntitle | text | optional',
            partLines: '',
        }), /属性名不能重复/u)
    })
})
