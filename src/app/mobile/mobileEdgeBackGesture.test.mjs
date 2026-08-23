import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getMobileEdgeBackCommitDistance,
    getMobileEdgeBackCompletionDistance,
    getMobileEdgeBackProgress,
    shouldCommitMobileEdgeBack,
} from './mobileEdgeBackGesture.ts'

test('边缘返回进度在当前屏宽的提交距离处封顶，并过滤反向距离', () => {
    const viewportWidth = 390
    const commitDistance = getMobileEdgeBackCommitDistance(viewportWidth)
    assert.equal(getMobileEdgeBackProgress(-20, viewportWidth), 0)
    assert.equal(getMobileEdgeBackProgress(commitDistance / 2, viewportWidth), 0.5)
    assert.equal(getMobileEdgeBackProgress(commitDistance * 2, viewportWidth), 1)
})

test('提交后旧页完整滑出一个 viewport，不停在距离阈值或抽屉宽度', () => {
    assert.equal(getMobileEdgeBackCompletionDistance(390), 390)
    assert.equal(getMobileEdgeBackCompletionDistance(0), 0)
    assert.equal(getMobileEdgeBackCompletionDistance(-20), 0)
})

test('慢速拖动需越过约 35% 屏宽，五分之一屏宽不会误返回', () => {
    const viewportWidth = 390
    const commitDistance = getMobileEdgeBackCommitDistance(viewportWidth)
    assert.equal(commitDistance, 136.5)
    assert.equal(shouldCommitMobileEdgeBack({
        distance: viewportWidth / 5,
        directionX: 1,
        velocityX: 0.2,
        viewportWidth,
    }), false)
    assert.equal(shouldCommitMobileEdgeBack({
        distance: commitDistance - 1,
        directionX: 1,
        velocityX: 0.2,
        viewportWidth,
    }), false)
    assert.equal(shouldCommitMobileEdgeBack({
        distance: commitDistance,
        directionX: 1,
        velocityX: 0.2,
        viewportWidth,
    }), true)
})

test('快速右甩可提前提交，但短触和反向甩动仍取消', () => {
    const viewportWidth = 390
    assert.equal(shouldCommitMobileEdgeBack({distance: 24, directionX: 1, velocityX: 0.45, viewportWidth}), true)
    assert.equal(shouldCommitMobileEdgeBack({distance: 23, directionX: 1, velocityX: 0.8, viewportWidth}), false)
    assert.equal(shouldCommitMobileEdgeBack({distance: 40, directionX: -1, velocityX: 0.8, viewportWidth}), false)
})
