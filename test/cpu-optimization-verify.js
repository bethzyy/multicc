/**
 * CPU 优化双重验证脚本
 *
 * 验证内容：
 * 1. 代码层面：检查所有优化点是否已实现
 * 2. 运行时层面：监控 multicc 进程的 CPU 使用情况
 *
 * 使用方法：
 *   node test/cpu-optimization-verify.js
 */

const { execSync, exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const promisify = require('util').promisify
const execAsync = promisify(exec)

// ============== 颜色输出 ==============
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
}

function log(color, ...args) {
  console.log(colors[color], ...args, colors.reset)
}

// ============== 第一部分：代码验证 ==============
console.log('\n' + '='.repeat(60))
log('cyan', '第一部分：代码层面验证')
console.log('='.repeat(60) + '\n')

const ptyPath = path.join(__dirname, '../src/main/services/pty.ts')
const detectorPath = path.join(__dirname, '../src/main/services/terminal/WindowsProcessDetector.ts')

const ptyCode = fs.readFileSync(ptyPath, 'utf-8')
const detectorCode = fs.readFileSync(detectorPath, 'utf-8')

const codeChecks = [
  {
    name: '统一轮询调度器 - globalPollTimer',
    pattern: /globalPollTimer\s*[?:]\s*ReturnType<typeof setInterval>/,
    code: ptyCode
  },
  {
    name: '统一轮询调度器 - pollQueue',
    pattern: /pollQueue\s*:\s*string\[\]/,
    code: ptyCode
  },
  {
    name: '轮询间隔 5 秒',
    pattern: /POLL_INTERVAL_MS\s*=\s*5000/,
    code: ptyCode
  },
  {
    name: '智能跳过 - lastPolledPid 字段',
    pattern: /lastPolledPid\s*:\s*number\s*\|\s*null/,
    code: ptyCode
  },
  {
    name: '智能跳过 - 跳过逻辑',
    pattern: /如果上次检测到的进程还在运行，跳过完整检测/,
    code: ptyCode
  },
  {
    name: '进程树清理 - cleanupProcessTree 方法',
    pattern: /cleanupProcessTree\s*\(pid/,
    code: ptyCode
  },
  {
    name: '异步进程检测 - detectForegroundProcessAsync',
    pattern: /detectForegroundProcessAsync/,
    code: detectorCode
  },
  {
    name: '轻量级进程检查 - isProcessRunningAsync',
    pattern: /isProcessRunningAsync/,
    code: ptyCode
  },
  {
    name: '关闭时跳过检测 - isShuttingDown',
    pattern: /isShuttingDown/,
    code: ptyCode
  }
]

let passedCount = 0
let failedCount = 0

codeChecks.forEach(check => {
  const passed = check.pattern.test(check.code)
  if (passed) {
    log('green', '✓', check.name)
    passedCount++
  } else {
    log('red', '✗', check.name)
    failedCount++
  }
})

console.log('\n' + '-'.repeat(40))
log('cyan', `代码验证结果: ${passedCount}/${codeChecks.length} 通过`)

// ============== 第二部分：运行时验证 ==============
console.log('\n' + '='.repeat(60))
log('cyan', '第二部分：运行时层面验证')
console.log('='.repeat(60) + '\n')

async function getProcessCpu(processName) {
  try {
    // 使用 PowerShell 获取进程 CPU 使用率
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object Name, Id, CPU, WorkingSet | ConvertTo-Json"`,
      { timeout: 5000 }
    )

    if (!stdout || stdout.includes('null')) {
      return null
    }

    const data = JSON.parse(stdout)
    // 如果是数组，取第一个
    const proc = Array.isArray(data) ? data[0] : data

    return {
      name: proc.Name,
      pid: proc.Id,
      cpu: proc.CPU || 0,
      memoryMB: Math.round((proc.WorkingSet || 0) / 1024 / 1024)
    }
  } catch (err) {
    return null
  }
}

async function getWmiProviderCpu() {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "Get-Process -Name 'WmiPrvSE' -ErrorAction SilentlyContinue | Select-Object Name, Id, CPU | ConvertTo-Json"`,
      { timeout: 5000 }
    )

    if (!stdout || stdout.includes('null')) {
      return []
    }

    const data = JSON.parse(stdout)
    const procs = Array.isArray(data) ? data : [data]

    return procs.map(p => ({
      name: p.Name,
      pid: p.Id,
      cpu: p.CPU || 0
    }))
  } catch (err) {
    return []
  }
}

async function monitorProcesses(durationMs, intervalMs) {
  const samples = []
  const iterations = Math.ceil(durationMs / intervalMs)

  log('yellow', `开始监控 ${iterations} 个采样点，间隔 ${intervalMs}ms...`)

  for (let i = 0; i < iterations; i++) {
    const [multicc, wmiProviders] = await Promise.all([
      getProcessCpu('multicc'),
      getWmiProviderCpu()
    ])

    samples.push({
      time: new Date().toISOString(),
      multicc: multicc ? { cpu: multicc.cpu, memoryMB: multicc.memoryMB } : null,
      wmiCount: wmiProviders.length,
      wmiTotalCpu: wmiProviders.reduce((sum, p) => sum + p.cpu, 0)
    })

    if ((i + 1) % 5 === 0) {
      log('cyan', `进度: ${i + 1}/${iterations}`)
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  return samples
}

function analyzeSamples(samples) {
  const validSamples = samples.filter(s => s.multicc !== null)

  if (validSamples.length === 0) {
    return { error: '未检测到 multicc 进程运行' }
  }

  const cpuValues = validSamples.map(s => s.multicc.cpu)
  const memValues = validSamples.map(s => s.multicc.memoryMB)
  const wmiCpuValues = samples.map(s => s.wmiTotalCpu)

  const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length
  const maxCpu = Math.max(...cpuValues)
  const minCpu = Math.min(...cpuValues)

  const avgMem = memValues.reduce((a, b) => a + b, 0) / memValues.length
  const avgWmiCpu = wmiCpuValues.reduce((a, b) => a + b, 0) / wmiCpuValues.length

  return {
    sampleCount: validSamples.length,
    multicc: {
      avgCpu: avgCpu.toFixed(2),
      maxCpu: maxCpu.toFixed(2),
      minCpu: minCpu.toFixed(2),
      avgMemoryMB: avgMem.toFixed(0)
    },
    wmiProvider: {
      avgCpu: avgWmiCpu.toFixed(2),
      instanceCount: samples[0]?.wmiCount || 0
    }
  }
}

async function runRuntimeVerification() {
  log('yellow', '检查 multicc 进程状态...')

  const multiccProcess = await getProcessCpu('multicc')

  if (!multiccProcess) {
    log('red', '✗ 未检测到 multicc 进程')
    log('yellow', '提示：请先启动 multicc 应用，然后重新运行此脚本')
    return
  }

  log('green', `✓ 检测到 multicc 进程: PID=${multiccProcess.pid}, 内存=${multiccProcess.memoryMB}MB`)

  // 监控 30 秒，每 3 秒采样一次
  const durationMs = 30000
  const intervalMs = 3000

  log('cyan', `\n开始 CPU 监控（${durationMs/1000}秒）...`)
  log('yellow', '请在监控期间正常使用 multicc（例如打开多个 Claude Code 实例）\n')

  const samples = await monitorProcesses(durationMs, intervalMs)
  const analysis = analyzeSamples(samples)

  console.log('\n' + '-'.repeat(40))
  log('cyan', '运行时验证结果:')

  if (analysis.error) {
    log('red', analysis.error)
    return
  }

  console.log('\n  multicc 进程:')
  log('green', `    平均 CPU 时间: ${analysis.multicc.avgCpu}s`)
  log('green', `    最大 CPU 时间: ${analysis.multicc.maxCpu}s`)
  log('green', `    平均内存: ${analysis.multicc.avgMemoryMB}MB`)

  console.log('\n  WMI Provider Host:')
  log('green', `    实例数: ${analysis.wmiProvider.instanceCount}`)
  log('green', `    平均 CPU 时间: ${analysis.wmiProvider.avgCpu}s`)

  // 评估结果
  console.log('\n' + '-'.repeat(40))
  log('cyan', '优化效果评估:')

  // 注意：CPU 属性在 PowerShell 中是累计 CPU 时间，不是百分比
  // 我们通过 CPU 时间增长率来判断
  const firstHalf = samples.slice(0, Math.floor(samples.length / 2))
  const secondHalf = samples.slice(Math.floor(samples.length / 2))

  const firstHalfCpu = firstHalf.filter(s => s.multicc).reduce((sum, s) => sum + s.multicc.cpu, 0)
  const secondHalfCpu = secondHalf.filter(s => s.multicc).reduce((sum, s) => sum + s.multicc.cpu, 0)

  const cpuGrowth = secondHalfCpu - firstHalfCpu

  if (cpuGrowth < 5) {
    log('green', '✓ CPU 使用稳定，优化有效')
  } else if (cpuGrowth < 15) {
    log('yellow', '△ CPU 使用中等，可能需要进一步优化')
  } else {
    log('red', '✗ CPU 使用较高，建议检查')
  }

  if (analysis.wmiProvider.instanceCount <= 2) {
    log('green', '✓ WMI Provider 实例数正常')
  } else {
    log('yellow', `△ WMI Provider 实例数较多 (${analysis.wmiProvider.instanceCount})`)
  }
}

// ============== 执行验证 ==============
async function main() {
  // 如果代码验证全部通过，执行运行时验证
  if (failedCount === 0) {
    log('green', '\n所有代码检查通过，继续运行时验证...\n')
    await runRuntimeVerification()
  } else {
    log('red', '\n代码验证存在失败项，请先修复代码问题')
  }

  console.log('\n' + '='.repeat(60))
  log('cyan', '验证完成')
  console.log('='.repeat(60) + '\n')
}

main().catch(err => {
  log('red', '验证过程出错:', err.message)
})
