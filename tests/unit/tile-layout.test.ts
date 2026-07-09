import { describe, it, expect } from 'vitest'
import { computeTileLayout, orderForLayout } from '../../src/renderer/utils/tileLayout'

describe('computeTileLayout', () => {
  it('n=0 返回空布局', () => {
    expect(computeTileLayout(0)).toEqual({ cols: 0, rows: 0, hasBigSlot: false, slots: [] })
  })

  it('n=1 单格全屏', () => {
    expect(computeTileLayout(1)).toEqual({
      cols: 1,
      rows: 1,
      hasBigSlot: false,
      slots: [{ row: 1, col: 1, rowSpan: 1, colSpan: 1 }],
    })
  })

  it('n=2 两列均分，无大格', () => {
    const r = computeTileLayout(2)
    expect(r.cols).toBe(2)
    expect(r.rows).toBe(1)
    expect(r.hasBigSlot).toBe(false)
  })

  it('n=3 大格占第一列全高，右侧上下两格', () => {
    const r = computeTileLayout(3)
    expect(r.cols).toBe(2)
    expect(r.rows).toBe(2)
    expect(r.hasBigSlot).toBe(true)
    expect(r.slots[0]).toEqual({ row: 1, col: 1, rowSpan: 2, colSpan: 1 })
    expect(r.slots.slice(1)).toEqual([
      { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
      { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ])
  })

  it('n=5 大格左侧全高，右侧 2x2', () => {
    const r = computeTileLayout(5)
    expect(r.cols).toBe(3)
    expect(r.rows).toBe(2)
    expect(r.hasBigSlot).toBe(true)
    expect(r.slots[0]).toEqual({ row: 1, col: 1, rowSpan: 2, colSpan: 1 })
  })

  // 通用不变量：无空洞、无重叠、槽数吻合、不越界
  for (let n = 1; n <= 12; n++) {
    it(`n=${n} 无空洞、无重叠、槽数吻合`, () => {
      const { cols, rows, slots } = computeTileLayout(n)
      expect(slots).toHaveLength(n)
      const covered = new Set<string>()
      for (const s of slots) {
        for (let r = s.row; r < s.row + s.rowSpan; r++) {
          for (let c = s.col; c < s.col + s.colSpan; c++) {
            const key = `${r},${c}`
            expect(covered.has(key), `重叠格子 ${key}`).toBe(false)
            covered.add(key)
            expect(r).toBeLessThanOrEqual(rows)
            expect(c).toBeLessThanOrEqual(cols)
          }
        }
      }
      expect(covered.size).toBe(cols * rows)
    })
  }
})

describe('orderForLayout — 纯按数组顺序', () => {
  const ts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('原样返回数组顺序', () => {
    expect(orderForLayout(ts).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('不修改入参数组', () => {
    const input = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    orderForLayout(input)
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})
