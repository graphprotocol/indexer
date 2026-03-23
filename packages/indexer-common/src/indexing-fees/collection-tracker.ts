export interface AgreementTimingState {
  lastCollectedAt: number // unix timestamp (0 = never collected, use acceptedAt externally)
  minSecondsPerCollection: number
  maxSecondsPerCollection: number
}

export class CollectionTracker {
  private state: Map<string, AgreementTimingState> = new Map()
  private targetPct: number

  constructor(targetPercentage: number) {
    this.targetPct = Math.min(90, Math.max(1, targetPercentage)) / 100
  }

  track(agreementId: string, timing: AgreementTimingState): void {
    const existing = this.state.get(agreementId)
    if (existing && existing.lastCollectedAt > timing.lastCollectedAt) {
      // Keep local lastCollectedAt if more recent (subgraph may lag behind)
      existing.minSecondsPerCollection = timing.minSecondsPerCollection
      existing.maxSecondsPerCollection = timing.maxSecondsPerCollection
      return
    }
    this.state.set(agreementId, { ...timing })
  }

  remove(agreementId: string): void {
    this.state.delete(agreementId)
  }

  updateAfterCollection(agreementId: string, collectedAt: number): void {
    const existing = this.state.get(agreementId)
    if (existing) {
      existing.lastCollectedAt = collectedAt
    }
  }

  isReadyForCollection(agreementId: string, now: number): boolean {
    const timing = this.state.get(agreementId)
    if (!timing) return true // untracked → force check

    const elapsed = now - timing.lastCollectedAt
    const targetSeconds = this.computeTargetSeconds(timing)
    return elapsed >= targetSeconds
  }

  getReadyAgreements(now: number): string[] {
    const ready: string[] = []
    for (const [id, timing] of this.state) {
      const elapsed = now - timing.lastCollectedAt
      if (elapsed >= this.computeTargetSeconds(timing)) {
        ready.push(id)
      }
    }
    return ready
  }

  private computeTargetSeconds(timing: AgreementTimingState): number {
    const windowSize = timing.maxSecondsPerCollection - timing.minSecondsPerCollection
    return timing.minSecondsPerCollection + windowSize * this.targetPct
  }
}
