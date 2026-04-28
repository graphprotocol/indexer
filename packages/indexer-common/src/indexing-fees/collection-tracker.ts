export interface AgreementTimingState {
  lastCollectedAt: number // unix timestamp (0 = never collected, use acceptedAt externally)
  minSecondsPerCollection: number
  maxSecondsPerCollection: number
  lastAttemptedAt?: number // unix timestamp of last failed collection attempt
}

const DEFAULT_RETRY_THROTTLE_SECONDS = 15 * 60

export class CollectionTracker {
  private state: Map<string, AgreementTimingState> = new Map()
  private targetPct: number
  private retryThrottleSeconds: number

  constructor(
    targetPercentage: number,
    retryThrottleSeconds: number = DEFAULT_RETRY_THROTTLE_SECONDS,
  ) {
    this.targetPct = Math.min(90, Math.max(1, targetPercentage)) / 100
    this.retryThrottleSeconds = retryThrottleSeconds
  }

  track(agreementId: string, timing: AgreementTimingState): void {
    const existing = this.state.get(agreementId)
    if (!existing) {
      this.state.set(agreementId, { ...timing })
      return
    }

    // Always refresh min/max from subgraph
    existing.minSecondsPerCollection = timing.minSecondsPerCollection
    existing.maxSecondsPerCollection = timing.maxSecondsPerCollection

    // Adopt subgraph's lastCollectedAt if it's newer (collection happened externally
    // or our local state is behind). Equal-or-older means subgraph is lagging.
    if (timing.lastCollectedAt > existing.lastCollectedAt) {
      existing.lastCollectedAt = timing.lastCollectedAt
      // External collection counts as success — clear failure throttle
      existing.lastAttemptedAt = undefined
    }
  }

  remove(agreementId: string): void {
    this.state.delete(agreementId)
  }

  updateAfterCollection(agreementId: string, collectedAt: number): void {
    const existing = this.state.get(agreementId)
    if (existing) {
      existing.lastCollectedAt = collectedAt
      existing.lastAttemptedAt = undefined
    }
  }

  markAttempted(agreementId: string, attemptedAt: number): void {
    const existing = this.state.get(agreementId)
    if (existing) {
      existing.lastAttemptedAt = attemptedAt
    }
  }

  isReadyForCollection(agreementId: string, now: number): boolean {
    const timing = this.state.get(agreementId)
    if (!timing) return true // untracked → force check

    if (this.isThrottled(timing, now)) return false

    const elapsed = now - timing.lastCollectedAt
    const targetSeconds = this.computeTargetSeconds(timing)
    return elapsed >= targetSeconds
  }

  getReadyAgreements(now: number): string[] {
    const ready: string[] = []
    for (const [id, timing] of this.state) {
      if (this.isThrottled(timing, now)) continue
      const elapsed = now - timing.lastCollectedAt
      if (elapsed >= this.computeTargetSeconds(timing)) {
        ready.push(id)
      }
    }
    return ready
  }

  private isThrottled(timing: AgreementTimingState, now: number): boolean {
    if (timing.lastAttemptedAt === undefined) return false
    return now - timing.lastAttemptedAt < this.retryThrottleSeconds
  }

  private computeTargetSeconds(timing: AgreementTimingState): number {
    const windowSize = timing.maxSecondsPerCollection - timing.minSecondsPerCollection
    return timing.minSecondsPerCollection + windowSize * this.targetPct
  }
}
