/**
 * 主进程持久化日志（electron-log）
 *
 * 背景：2026-07-11 主进程 AppHang 事件排查时应用没有任何落盘日志，
 * 只能依赖 Windows 事件日志 + WER 签名反推。接入轻量持久日志后，
 * 下次出问题直接看 %APPDATA%/multicc/logs/main.log。
 *
 * 策略：把主进程所有既有的 console.log/warn/error 原样路由到文件，
 * 不改动任何现有调用点。文件 5MB 自动轮转（保留一份 main.old.log）。
 */

import log from 'electron-log/main'
import { app } from 'electron'

export function initMainLogger(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  // 控制台照常输出（dev 时看得见），文件同步落盘
  log.transports.console.level = 'info'

  // 主进程所有 console.* 走 electron-log（现有几十处 [PTY]/[Main]/[Security] 日志全部持久化）
  Object.assign(console, log.functions)

  log.info(
    `[App] MultiCC ${app.getVersion()} starting.`,
    `electron=${process.versions.electron} node=${process.versions.node}`,
    `packaged=${app.isPackaged} logFile=${log.transports.file.getFile().path}`
  )
}
