#!/usr/bin/env node

/*
 * Android 无设备编译入口：复用 Dev 脚本的 NDK/四 ABI linker 配置。
 * IDE 和命令行只选择 dev 或 release，不各自维护平台环境变量。
 */

const cp = require('child_process')
const path = require('path')
const {configureAndroidNdkBuildEnv} = require('./android-dev.cjs')

const PROJECT_ROOT = path.resolve(__dirname, '..')

function run() {
    const mode = process.argv[2]
    if (mode !== 'dev' && mode !== 'release') {
        throw new Error('用法：node ./scripts/android-build.cjs <dev|release>')
    }

    const runEnv = configureAndroidNdkBuildEnv({
        ...process.env,
        ...(mode === 'dev' ? {
            CARGO_PROFILE_DEV_DEBUG: '0',
            CARGO_PROFILE_DEV_STRIP: 'debuginfo',
        } : {}),
    })
    const tauriArgs = mode === 'dev'
        ? ['android', 'build', '--debug', '--apk', '--target', 'aarch64']
        : ['android', 'build', '--apk']
    const npmArgs = ['run', 'tauri', '--', ...tauriArgs]
    const result = process.platform === 'win32'
        ? cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...npmArgs], {
            cwd: PROJECT_ROOT,
            env: runEnv,
            stdio: 'inherit',
            windowsHide: true,
        })
        : cp.spawnSync('npm', npmArgs, {
            cwd: PROJECT_ROOT,
            env: runEnv,
            stdio: 'inherit',
        })

    if (result.error) throw result.error
    if (result.status !== 0) {
        throw new Error(`Android ${mode} 编译失败，退出码：${result.status}`)
    }
}

try {
    run()
} catch (error) {
    console.error(error.message || error)
    process.exitCode = 1
}
