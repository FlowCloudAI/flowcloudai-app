// 本测试固定浏览器边界的独立 DeepSeek 状态，防止密钥或未知提供方字段进入界面状态。
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseDeepSeekProviderStatus} from './aiWorkflowContract.ts'

test('DeepSeek 状态只接受固定提供方与 Responses 兼容格式', () => {
    const status = {
        provider: 'deepseek',
        apiFormat: 'openai-responses',
        configured: true,
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
    }
    assert.deepEqual(parseDeepSeekProviderStatus(status), {ok: true, value: status, issues: []})
    assert.equal(parseDeepSeekProviderStatus({...status, provider: 'openai'}).ok, false)
    assert.equal(parseDeepSeekProviderStatus({...status, apiKey: 'secret'}).ok, false)
})
