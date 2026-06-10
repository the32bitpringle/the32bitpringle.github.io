import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaybackScheduler } from './scheduler'

describe('PlaybackScheduler', () => {
  afterEach(() => vi.useRealTimers())

  it('cancels stale callbacks when pace changes', () => {
    vi.useFakeTimers()
    const scheduler = new PlaybackScheduler()
    const stale = vi.fn()
    const current = vi.fn()
    scheduler.schedule(1000, stale)
    scheduler.schedule(500, current)
    vi.advanceTimersByTime(1000)
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  })
})
