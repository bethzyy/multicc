/**
 * xterm 的 windowsPty 适配参数 —— resize 后内容重复/排版错乱的根治开关。
 *
 * 取证结论（2026-07-29，基于 %APPDATA%/multicc/pty-debug.log 36k 真实帧回放）：
 * ConPTY 在每次 resize 后会按"自己的世界观"全量重印视口（37 次 resize 有 29 次
 * 紧跟 ≥50% 重复的大帧），且它的世界观是"行一旦进入 scrollback 就永不复出"。
 * 而 xterm 默认按 Unix pty 语义处理 resize：行数变多时把 scrollback 的旧行拉回
 * 视口（Buffer.ts ybase--）。两个模型一冲突，ConPTY 的重印就落在被拉回的旧行上
 * ——旧行被部分覆盖成乱版、重印内容成为第二份 → "重复 + 排版错乱"（tile 布局
 * 增删终端 / 聚焦切换都会触发全体 pane resize，故偶发且随终端数量增多而频繁）。
 *
 * 设置 windowsPty 后 xterm 走 ConPTY 适配分支：行数变多时补空行（与 ConPTY 模型
 * 一致），重印变成幂等覆盖，重复消失。见 xterm Buffer.ts resize() 的 windowsMode/
 * windowsPty 分支注释："conpty reprints the screen with it's view of the world"。
 */

/**
 * xterm 以 21376 为界判断 conpty 是否自带 reflow（Buffer.ts _isReflowEnabled）：
 * ≥21376 时 xterm 保留自身 reflow 与 conpty 同步；<21376 时禁用 reflow 并启用
 * 换行启发式。我们通过 useConptyDll 使用 node-pty 捆绑的 conpty.dll
 * （1.23.2510，Windows Terminal 2025-10 代码线，远新于 21376），与宿主 OS 版本
 * 无关——所以这里传阈值本身表示"现代 conpty"，勿改成 os.release() 的系统版本号
 * （本机 Win10 19045 会落到旧分支，行为反而错误）。
 */
export const CONPTY_HAS_REFLOW_BUILD = 21376

export interface WindowsPtyOptions {
  backend: 'conpty' | 'winpty'
  buildNumber: number
}

/**
 * @param backend 主进程实际使用的 PTY 后端（conpty.dll 加载失败时会回退 winpty，
 *                由 terminal.create 的返回值告知）
 * @param osBuild winpty 回退时传宿主 OS build（winpty 是屏幕抓取器，无自带 conpty，
 *                语义跟随系统；backend='winpty' 时 xterm 会禁用 reflow——winpty
 *                同样会在 resize 后重印，禁 reflow 避免两边折行算法打架）
 */
export function getWindowsPtyOptions(
  backend: 'conpty' | 'winpty',
  osBuild?: number
): WindowsPtyOptions {
  if (backend === 'conpty') {
    return { backend, buildNumber: CONPTY_HAS_REFLOW_BUILD }
  }
  return { backend, buildNumber: osBuild ?? 19045 }
}
