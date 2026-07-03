/**
 * 平铺布局计算（纯函数，供 TileLayout 组件与单测共用）。
 *
 * 规则（见 2026-07-03 设计文档）：
 * - cols = ceil(sqrt(n))，rows = ceil(n/cols)，holes = cols*rows - n
 * - holes = 0：均分网格，无大格
 * - holes > 0：大格 = 第 1 列纵向跨 (holes+1) 行，其余格子行优先填充，永远无空洞
 * - 焦点终端通过 orderForLayout 与首位"交换"进大格：每次焦点变化只有
 *   两个槽位互换，其余终端不动，避免全局跳动
 */
export interface TileSlot {
  row: number
  col: number
  rowSpan: number
  colSpan: number
}

export interface TileLayoutResult {
  cols: number
  rows: number
  hasBigSlot: boolean
  slots: TileSlot[]
}

export function computeTileLayout(n: number): TileLayoutResult {
  if (n <= 0) return { cols: 0, rows: 0, hasBigSlot: false, slots: [] }

  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const holes = cols * rows - n

  if (holes === 0) {
    const slots: TileSlot[] = []
    for (let i = 0; i < n; i++) {
      slots.push({ row: Math.floor(i / cols) + 1, col: (i % cols) + 1, rowSpan: 1, colSpan: 1 })
    }
    return { cols, rows, hasBigSlot: false, slots }
  }

  const bigRowSpan = holes + 1
  const slots: TileSlot[] = [{ row: 1, col: 1, rowSpan: bigRowSpan, colSpan: 1 }]
  for (let r = 1; r <= rows && slots.length < n; r++) {
    for (let c = 1; c <= cols && slots.length < n; c++) {
      if (c === 1 && r <= bigRowSpan) continue // 被大格覆盖
      slots.push({ row: r, col: c, rowSpan: 1, colSpan: 1 })
    }
  }
  return { cols, rows, hasBigSlot: true, slots }
}

export function orderForLayout<T extends { id: string }>(
  visible: T[],
  focusedId: string | null,
  hasBigSlot: boolean
): T[] {
  const ordered = [...visible]
  if (!hasBigSlot || !focusedId) return ordered
  const idx = ordered.findIndex((t) => t.id === focusedId)
  if (idx > 0) {
    const tmp = ordered[0]
    ordered[0] = ordered[idx]
    ordered[idx] = tmp
  }
  return ordered
}
