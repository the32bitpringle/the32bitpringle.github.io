export class PlaybackScheduler {
  private timeout: number | null = null
  private generation = 0

  schedule(delay: number, callback: () => void) {
    this.cancel()
    const generation = this.generation
    this.timeout = window.setTimeout(() => {
      if (generation === this.generation) callback()
    }, delay)
  }

  cancel() {
    this.generation += 1
    if (this.timeout !== null) window.clearTimeout(this.timeout)
    this.timeout = null
  }
}
