#!/usr/bin/env node

const cp = require('child_process')
const fs = require('fs')
const path = require('path')

const ADB_WAIT_TIMEOUT_MS = 180000
const CHECK_INTERVAL_MS = 3000
const ADB_WAIT_TIMEOUT_SECONDS = Math.round(ADB_WAIT_TIMEOUT_MS / 1000)
const DEV_SERVER_PORTS = [5176, 1422]
const PORT_RELEASE_TIMEOUT_MS = 10000
const PROJECT_ROOT = path.resolve(__dirname, '..')

function existsFile(filePath) {
    try {
        return fs.statSync(filePath).isFile()
    } catch {
        return false
    }
}

function existsDirectory(filePath) {
    try {
        return fs.statSync(filePath).isDirectory()
    } catch {
        return false
    }
}

function compareVersionLike(a, b) {
    const left = a.split(/[^\d]+/).filter(Boolean).map(Number)
    const right = b.split(/[^\d]+/).filter(Boolean).map(Number)
    const length = Math.max(left.length, right.length)

    for (let i = 0; i < length; i += 1) {
        const diff = (left[i] || 0) - (right[i] || 0)
        if (diff !== 0) {
            return diff
        }
    }

    return a.localeCompare(b)
}

function findLatestNdkRoot(sdkRoot) {
    if (!sdkRoot) {
        return null
    }

    const ndkDir = path.join(sdkRoot, 'ndk')
    if (!existsDirectory(ndkDir)) {
        return null
    }

    const versions = fs
        .readdirSync(ndkDir, {withFileTypes: true})
        .filter((item) => item.isDirectory())
        .map((item) => item.name)
        .sort(compareVersionLike)

    const latest = versions[versions.length - 1]
    return latest ? path.join(ndkDir, latest) : null
}

function findAndroidNdkRoot() {
    const explicitCandidates = [
        process.env.ANDROID_NDK_HOME,
        process.env.ANDROID_NDK_ROOT,
        process.env.NDK_HOME,
    ].filter(Boolean)

    for (const candidate of explicitCandidates) {
        if (existsDirectory(candidate)) {
            return candidate
        }
    }

    const sdkCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)
    for (const sdkRoot of sdkCandidates) {
        const ndkRoot = findLatestNdkRoot(sdkRoot)
        if (ndkRoot) {
            return ndkRoot
        }
    }

    for (const sdkRoot of sdkCandidates) {
        const bundledRoot = path.join(sdkRoot, 'ndk-bundle')
        if (existsDirectory(bundledRoot)) {
            return bundledRoot
        }
    }

    return null
}

function findNdkHostBin(ndkRoot) {
    const prebuiltRoot = path.join(ndkRoot, 'toolchains', 'llvm', 'prebuilt')
    if (!existsDirectory(prebuiltRoot)) {
        return null
    }

    const preferredHosts =
        process.platform === 'win32'
            ? ['windows-x86_64', 'windows']
            : process.platform === 'darwin'
              ? ['darwin-x86_64', 'darwin-arm64']
              : ['linux-x86_64']

    for (const host of preferredHosts) {
        const candidate = path.join(prebuiltRoot, host, 'bin')
        if (existsDirectory(candidate)) {
            return candidate
        }
    }

    const fallbackHost = fs.readdirSync(prebuiltRoot, {withFileTypes: true}).find((item) => item.isDirectory())
    return fallbackHost ? path.join(prebuiltRoot, fallbackHost.name, 'bin') : null
}

function findNdkExecutable(binDir, baseName) {
    const candidates =
        process.platform === 'win32'
            ? [`${baseName}.cmd`, `${baseName}.exe`, baseName]
            : [baseName]

    for (const candidate of candidates) {
        const full = path.join(binDir, candidate)
        if (existsFile(full)) {
            return full
        }
    }

    return null
}

function configureAndroidNdkBuildEnv(baseEnv) {
    const ndkRoot = findAndroidNdkRoot()
    if (!ndkRoot) {
        throw new Error('未找到 Android NDK，请先安装 NDK 并设置 ANDROID_NDK_HOME、ANDROID_NDK_ROOT 或 ANDROID_HOME。')
    }

    const binDir = findNdkHostBin(ndkRoot)
    if (!binDir) {
        throw new Error(`未找到 Android NDK LLVM 工具链目录: ${ndkRoot}`)
    }

    const apiLevel = process.env.ANDROID_NDK_API_LEVEL || '26'
    const llvmAr = findNdkExecutable(binDir, 'llvm-ar')
    const llvmRanlib = findNdkExecutable(binDir, 'llvm-ranlib')
    const targets = [
        {rust: 'aarch64-linux-android', clang: `aarch64-linux-android${apiLevel}-clang`},
        {rust: 'armv7-linux-androideabi', clang: `armv7a-linux-androideabi${apiLevel}-clang`},
        {rust: 'i686-linux-android', clang: `i686-linux-android${apiLevel}-clang`},
        {rust: 'x86_64-linux-android', clang: `x86_64-linux-android${apiLevel}-clang`},
    ]

    const env = {
        ...baseEnv,
        ANDROID_NDK_HOME: ndkRoot,
        ANDROID_NDK_ROOT: ndkRoot,
        PATH: [binDir, baseEnv.PATH || process.env.PATH || ''].filter(Boolean).join(path.delimiter),
    }

    for (const target of targets) {
        const cc = findNdkExecutable(binDir, target.clang)
        const cxx = findNdkExecutable(binDir, `${target.clang}++`)
        if (!cc || !cxx) {
            throw new Error(`Android NDK 缺少 ${target.rust} 编译器，请检查 NDK 安装: ${binDir}`)
        }

        const suffix = target.rust.replace(/-/g, '_')
        const cargoSuffix = suffix.toUpperCase()

        env[`CC_${target.rust}`] = cc
        env[`CC_${suffix}`] = cc
        env[`CXX_${target.rust}`] = cxx
        env[`CXX_${suffix}`] = cxx
        env[`CARGO_TARGET_${cargoSuffix}_LINKER`] = cc

        if (llvmAr) {
            env[`AR_${target.rust}`] = llvmAr
            env[`AR_${suffix}`] = llvmAr
        }
        if (llvmRanlib) {
            env[`RANLIB_${target.rust}`] = llvmRanlib
            env[`RANLIB_${suffix}`] = llvmRanlib
        }
    }

    console.log(`使用 Android NDK 编译器环境: ${ndkRoot}`)
    return env
}

function findExecutable(name) {
    const isWin = process.platform === 'win32'
    const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : ['']
    const candidates = new Set()

    const addPath = (p) => {
        if (!p) {
            return
        }
        const candidate = path.resolve(p)
        if (!candidate) {
            return
        }
        candidates.add(candidate)
    }

    const rootCandidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean)
    const extraPaths = []
    for (const root of rootCandidates) {
        extraPaths.push(path.join(root, 'platform-tools'))
        extraPaths.push(path.join(root, 'emulator'))
    }

    ;[...extraPaths, ...(process.env.PATH || '').split(path.delimiter)]
        .filter(Boolean)
        .forEach(addPath)

    for (const dir of candidates) {
        const names = isWin && !path.extname(name) ? exts.map((ext) => `${name}${ext}`) : [name]
        for (const candidate of names) {
            const full = path.join(dir, candidate)
            if (existsFile(full)) {
                return full
            }
        }
    }

    return null
}

function runCapture(cmd, args = [], env = process.env) {
    const result = cp.spawnSync(cmd, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env,
    })
    if (result.error) {
        throw result.error
    }
    if (result.status !== 0) {
        const stderr = (result.stderr || '').trim()
        const stdout = (result.stdout || '').trim()
        const msg = [stderr, stdout].filter(Boolean).join('\n') || `命令返回码 ${result.status}`
        throw new Error(`执行失败: ${cmd} ${args.join(' ')}\n${msg}`)
    }
    return (result.stdout || '').toString()
}

function normalizeForMatch(value) {
    return value.replace(/\\/g, '/').toLowerCase()
}

function getWindowsListeningProcesses(ports) {
    const portSet = new Set(ports.map((port) => String(port)))
    const output = runCapture('netstat', ['-ano', '-p', 'tcp'])
    const items = []

    for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') {
            continue
        }

        const [, localAddress, , state, pid] = parts
        if (state.toUpperCase() !== 'LISTENING') {
            continue
        }

        const match = localAddress.match(/:(\d+)$/)
        if (!match || !portSet.has(match[1])) {
            continue
        }

        items.push({pid: Number(pid), port: Number(match[1])})
    }

    return items
}

function getUnixListeningProcesses(ports) {
    const items = []

    for (const port of ports) {
        try {
            const output = runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
            for (const line of output.split(/\r?\n/)) {
                if (line.startsWith('p')) {
                    items.push({pid: Number(line.slice(1)), port})
                }
            }
        } catch {
            // 非 Windows 环境没有 lsof 时跳过预检查，交给 Vite 输出原始错误。
        }
    }

    return items
}

function getWindowsCommandLines(pids) {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(' OR ')
    const command =
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' +
        `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
        'ForEach-Object { "$($_.ProcessId)||$($_.CommandLine)" }'
    const map = new Map()

    try {
        const output = runCapture('powershell.exe', ['-NoProfile', '-Command', command])
        for (const line of output.split(/\r?\n/)) {
            const idx = line.indexOf('||')
            if (idx === -1) {
                continue
            }

            const pid = Number(line.slice(0, idx).trim())
            if (Number.isFinite(pid)) {
                map.set(pid, line.slice(idx + 2).trim())
            }
        }
    } catch {
        // 查询失败时返回空表，调用方按“无法识别”处理（不会误杀其他进程）。
    }

    return map
}

function getUnixCommandLines(pids) {
    const map = new Map()

    try {
        const output = runCapture('ps', ['-o', 'pid=,command=', '-p', pids.join(',')])
        for (const line of output.split(/\r?\n/)) {
            const match = line.trim().match(/^(\d+)\s+(.*)$/)
            if (match) {
                map.set(Number(match[1]), match[2].trim())
            }
        }
    } catch {
        // 同上：取不到命令行就按未知处理，避免单次查询失败拖垮整个流程。
    }

    return map
}

function getCommandLines(pids) {
    if (!pids.length) {
        return new Map()
    }

    return process.platform === 'win32' ? getWindowsCommandLines(pids) : getUnixCommandLines(pids)
}

function collectListeningPids(ports) {
    const rawItems = process.platform === 'win32' ? getWindowsListeningProcesses(ports) : getUnixListeningProcesses(ports)
    const byPid = new Map()

    for (const item of rawItems) {
        if (!Number.isFinite(item.pid)) {
            continue
        }

        const existing = byPid.get(item.pid) || {pid: item.pid, ports: new Set()}
        existing.ports.add(item.port)
        byPid.set(item.pid, existing)
    }

    return byPid
}

function isAnyPortListening(ports) {
    return collectListeningPids(ports).size > 0
}

function getListeningProcesses(ports) {
    const byPid = collectListeningPids(ports)
    const commandLines = getCommandLines([...byPid.keys()])

    return [...byPid.values()].map((item) => ({
        pid: item.pid,
        ports: [...item.ports].sort((a, b) => a - b),
        commandLine: commandLines.get(item.pid) || '',
    }))
}

function isCurrentProjectViteProcess(commandLine) {
    const normalizedCommand = normalizeForMatch(commandLine || '')
    const normalizedRoot = normalizeForMatch(PROJECT_ROOT)

    return normalizedCommand.includes(normalizedRoot) && normalizedCommand.includes('/vite/bin/vite.js')
}

function formatPortConflict(item) {
    const ports = item.ports.map((port) => `:${port}`).join(', ')
    const command = item.commandLine ? `，命令：${item.commandLine}` : ''
    return `PID ${item.pid} (${ports})${command}`
}

async function waitForPortsReleased(ports, timeoutMs = PORT_RELEASE_TIMEOUT_MS) {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
        if (!isAnyPortListening(ports)) {
            return true
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 300)
        })
    }

    return !isAnyPortListening(ports)
}

function killProcessTree(pid) {
    if (process.platform === 'win32') {
        // /T 连带结束子进程树（vite 会拉起 esbuild 等子进程），/F 强制结束。
        const result = cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
        })
        if (result.error) {
            throw result.error
        }
        // 128 表示进程已不存在，等价于已关闭，视为成功。
        if (result.status !== 0 && result.status !== 128) {
            throw new Error(`taskkill 关闭 PID ${pid} 失败，退出码 ${result.status}`)
        }
        return
    }

    try {
        // 负 PID 结束整个进程组，回收 vite 拉起的子进程；失败则退回只杀主进程。
        try {
            process.kill(-pid)
            return
        } catch {
            process.kill(pid)
        }
    } catch (error) {
        if (error.code !== 'ESRCH') {
            throw error
        }
    }
}

async function prepareDevServerPorts() {
    const conflicts = getListeningProcesses(DEV_SERVER_PORTS)
    if (!conflicts.length) {
        return
    }

    const staleViteProcesses = conflicts.filter((item) => isCurrentProjectViteProcess(item.commandLine))
    const otherProcesses = conflicts.filter((item) => !isCurrentProjectViteProcess(item.commandLine))

    if (otherProcesses.length) {
        throw new Error(
            [
                `端口 ${DEV_SERVER_PORTS.join('/')} 已被其他进程占用，Vite 无法启动。`,
                ...otherProcesses.map((item) => `- ${formatPortConflict(item)}`),
                '请关闭这些进程后重试。',
            ].join('\n')
        )
    }

    console.log(
        `发现本项目遗留的 Vite dev server 占用端口 ${DEV_SERVER_PORTS.join('/')}，正在关闭旧进程：` +
        staleViteProcesses.map((item) => item.pid).join(', ')
    )

    for (const item of staleViteProcesses) {
        killProcessTree(item.pid)
    }

    if (!(await waitForPortsReleased(DEV_SERVER_PORTS))) {
        throw new Error(`旧 Vite 进程关闭后端口 ${DEV_SERVER_PORTS.join('/')} 仍未释放，请手动检查占用进程。`)
    }
}

function parseDevices(output) {
    const lines = output.trim().split(/\r?\n/).slice(1)
    const devices = []
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
            continue
        }
        const [serial, state] = trimmed.split(/\s+/)
        if (serial === 'List' || serial === '*' || !state) {
            continue
        }
        devices.push({serial, state})
    }
    return devices
}

function isPhysicalAndroidDevice(adbPath, serial) {
    try {
        return runCapture(adbPath, ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1'
    } catch {
        // 极早期真机可能尚不能执行 shell；本地 Android Emulator 的 serial 仍可可靠排除。
        return !serial.startsWith('emulator-')
    }
}

async function waitForDevice(adbPath, timeoutMs = ADB_WAIT_TIMEOUT_MS) {
    const start = Date.now()
    let warnedUnauthorized = false
    let warnedOffline = false

    while (Date.now() - start < timeoutMs) {
        const list = parseDevices(runCapture(adbPath, ['devices']))
        const ready = list.find((item) => item.state === 'device')
        if (ready) {
            return ready.serial
        }

        const hasUnauthorized = list.some((item) => item.state === 'unauthorized')
        const hasOffline = list.some((item) => item.state === 'offline')

        if (hasUnauthorized && !warnedUnauthorized) {
            console.log('发现设备未授权：如为真机请确认已在手机上允许 USB 调试。')
            warnedUnauthorized = true
        }
        if (hasOffline && !warnedOffline) {
            console.log('发现设备状态为 offline，等待设备恢复。')
            warnedOffline = true
        }

        await new Promise((resolve) => {
            setTimeout(resolve, CHECK_INTERVAL_MS)
        })
    }

    return null
}

function listAvds(emulatorPath) {
    const output = runCapture(emulatorPath, ['-list-avds'])
    return output
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
}

function startEmulator(emulatorPath, avdName) {
    console.log(`未检测到已连接设备，准备启动模拟器：${avdName}`)
    const child = cp.spawn(emulatorPath, ['-avd', avdName], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    })
    child.unref()
}

function startServerIfNeeded(adbPath) {
    try {
        runCapture(adbPath, ['start-server'])
    } catch {
        // 无需中断流程：后续命令会再触发更准确错误
    }
}

function adbReverseReset(adbPath, serial, port) {
    try {
        runCapture(adbPath, ['-s', serial, 'reverse', '--remove', `tcp:${port}`])
    } catch {
        // 该端口本来没有 reverse 映射时 --remove 会报错，忽略即可。
    }

    runCapture(adbPath, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`])
}

async function waitForBoot(adbPath, serial, timeoutMs = ADB_WAIT_TIMEOUT_MS) {
    const start = Date.now()
    let warned = false

    while (Date.now() - start < timeoutMs) {
        try {
            const output = runCapture(adbPath, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).trim()
            if (output === '1') {
                return true
            }
        } catch {
            // 冷启动早期 adb shell 可能尚不可用，稍后重试。
        }

        if (!warned) {
            console.log('设备已连接，等待系统启动完成（sys.boot_completed=1）……')
            warned = true
        }

        await new Promise((resolve) => {
            setTimeout(resolve, CHECK_INTERVAL_MS)
        })
    }

    return false
}

async function main() {
    const physicalOnly = process.argv.includes('--physical-only')
    const adbPath = findExecutable('adb')
    if (!adbPath) {
        throw new Error('未找到 adb，请先确认 Android SDK platform-tools 已加入 PATH 或设置 ANDROID_HOME/ANDROID_SDK_ROOT。')
    }

    // 先校验编译环境：缺 NDK 时尽早失败，避免白白杀掉端口进程、改动设备 reverse。
    const runEnv = configureAndroidNdkBuildEnv({
        ...process.env,
        CARGO_PROFILE_DEV_DEBUG: '0',
        CARGO_PROFILE_DEV_STRIP: 'debuginfo',
    })

    const emulatorPath = findExecutable('emulator')
    startServerIfNeeded(adbPath)
    let devices = parseDevices(runCapture(adbPath, ['devices']))
    const onlineDevices = devices.filter((item) => item.state === 'device')
    if (physicalOnly && onlineDevices.length > 1) {
        throw new Error(
            `检测到多个在线 Android 设备：${onlineDevices.map((item) => item.serial).join(', ')}。` +
            '真机 Dev 为避免 Tauri 按不稳定设备名称选错目标，要求只保留一台在线设备。'
        )
    }
    let serial = physicalOnly
        ? onlineDevices.find((item) => isPhysicalAndroidDevice(adbPath, item.serial))
        : onlineDevices[0]

    if (!serial) {
        if (physicalOnly) {
            const unauthorized = devices.filter((item) => item.state === 'unauthorized')
            const hint = unauthorized.length
                ? `发现未授权设备：${unauthorized.map((item) => item.serial).join(', ')}。请在手机上允许 USB 调试后重试。`
                : '请连接已开启 USB 调试的 Android 真机，并确认 `adb devices -l` 显示为 device。'
            throw new Error(`未检测到在线 Android 真机。${hint}`)
        }
        if (!emulatorPath) {
            throw new Error('未检测到已连接设备且未找到 emulator 命令，无法自动启动模拟器。')
        }

        const avds = listAvds(emulatorPath)
        if (!avds.length) {
            throw new Error('未找到可用的 AVD。请先在 Android Studio 创建并配置虚拟机。')
        }

        const targetAvd = process.env.ANDROID_AVD_NAME || avds[0]
        const exists = avds.includes(targetAvd)
        if (!exists) {
            throw new Error(
                `未找到指定 AVD: ${targetAvd}。可用 AVD: ${avds.join(', ')}。可设置 ANDROID_AVD_NAME 环境变量指定。`
            )
        }

        startEmulator(emulatorPath, targetAvd)
        serial = await waitForDevice(adbPath)
        if (!serial) {
            throw new Error(
                `启动模拟器后在 ${ADB_WAIT_TIMEOUT_SECONDS}s 内未检测到可用设备。请检查 adb 环境和 Android Studio。`
            )
        }
    } else {
        serial = serial.serial
    }

    console.log(`检测到设备就绪: ${serial}`)

    // adb 报 device 只代表 adbd 连上，framework 可能还没起来；等 boot_completed 再装包，避免安装失败。
    if (!(await waitForBoot(adbPath, serial))) {
        throw new Error(
            `设备 ${serial} 在 ${ADB_WAIT_TIMEOUT_SECONDS}s 内未完成系统启动（sys.boot_completed）。请检查模拟器/设备状态。`
        )
    }

    await prepareDevServerPorts()

    for (const port of DEV_SERVER_PORTS) {
        adbReverseReset(adbPath, serial, port)
    }

    // Tauri 的位置参数匹配设备“名称”而非 serial，且部分厂商会在蓝牙名和型号间回退。
    // 此处已保证真机模式只有一个在线设备，省略位置参数可让 Tauri 用 ADB serial 精确运行。
    const npmArgs = ['run', 'tauri', '--', 'android', 'dev', '--host', '127.0.0.1']
    const result =
        process.platform === 'win32'
            ? cp.spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...npmArgs], {
                stdio: 'inherit',
                windowsHide: true,
                cwd: PROJECT_ROOT,
                env: runEnv,
            })
            : cp.spawnSync('npm', npmArgs, {
                stdio: 'inherit',
                windowsHide: true,
                cwd: PROJECT_ROOT,
                env: runEnv,
            })

    if (result.error) {
        throw result.error
    }
    if (result.status !== 0) {
        throw new Error(`tauri android dev 执行失败，退出码: ${result.status}`)
    }
}

module.exports = {configureAndroidNdkBuildEnv}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error)
        process.exitCode = 1
    })
}
