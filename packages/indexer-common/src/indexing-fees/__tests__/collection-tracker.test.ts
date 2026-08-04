import { CollectionTracker, AgreementTimingState } from '../collection-tracker'

describe('CollectionTracker', () => {
  const DEFAULT_TARGET_PCT = 50
  const NOW = 1000000

  function makeState(
    overrides: Partial<AgreementTimingState> = {},
  ): AgreementTimingState {
    return {
      lastCollectedAt: NOW - 5000,
      minSecondsPerCollection: 3600,
      maxSecondsPerCollection: 86400,
      ...overrides,
    }
  }

  describe('isReadyForCollection', () => {
    test('returns false when elapsed time is below target', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState())
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)
    })

    test('returns true when elapsed time exceeds target', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)
    })

    test('returns true for untracked agreement (forces subgraph refresh)', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      expect(tracker.isReadyForCollection('0xunknown', NOW)).toBe(true)
    })

    test('respects different target percentages', () => {
      const tracker = new CollectionTracker(10)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 12000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)
    })

    test('handles first collection (lastCollectedAt = 0, uses acceptedAt)', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: 0 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)
    })
  })

  describe('track and updateAfterCollection', () => {
    test('updateAfterCollection updates lastCollectedAt', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)

      tracker.updateAfterCollection('0x01', NOW)
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)
    })

    test('track does not overwrite more recent local lastCollectedAt (subgraph lag)', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.updateAfterCollection('0x01', NOW)
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)

      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)
    })

    test('track updates when subgraph has newer data than local', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))

      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 100 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)
    })

    test('remove stops tracking an agreement', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState())
      tracker.remove('0x01')
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)
    })
  })

  describe('getReadyAgreements', () => {
    test('returns only agreements past their target time', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.track('0x02', makeState({ lastCollectedAt: NOW - 5000 }))
      tracker.track('0x03', makeState({ lastCollectedAt: NOW - 46000 }))

      const ready = tracker.getReadyAgreements(NOW)
      expect(ready.sort()).toEqual(['0x01', '0x03'].sort())
    })
  })

  describe('target percentage clamping', () => {
    test('clamps target above 90 to 90', () => {
      const tracker = new CollectionTracker(100)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 80000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(true)
    })

    test('clamps target below 1 to 1', () => {
      const tracker = new CollectionTracker(0)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 4000 }))
      expect(tracker.isReadyForCollection('0x01', NOW)).toBe(false)
    })
  })

  describe('retry throttle', () => {
    test('markAttempted blocks getReadyAgreements within throttle window', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      expect(tracker.getReadyAgreements(NOW)).toEqual(['0x01'])

      tracker.markAttempted('0x01', NOW)
      expect(tracker.getReadyAgreements(NOW + 100)).toEqual([])
      expect(tracker.getReadyAgreements(NOW + 899)).toEqual([])
    })

    test('markAttempted releases agreement after throttle window', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)

      expect(tracker.getReadyAgreements(NOW + 901)).toEqual(['0x01'])
    })

    test('isReadyForCollection respects throttle', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)

      expect(tracker.isReadyForCollection('0x01', NOW + 100)).toBe(false)
      expect(tracker.isReadyForCollection('0x01', NOW + 901)).toBe(true)
    })

    test('updateAfterCollection clears lastAttemptedAt', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)
      expect(tracker.getReadyAgreements(NOW + 100)).toEqual([])

      tracker.updateAfterCollection('0x01', NOW + 50)
      // After success, throttle is cleared. minSecondsPerCollection (3600) now governs.
      // 100 seconds elapsed → not ready by min-collection time, not by throttle.
      expect(tracker.getReadyAgreements(NOW + 50 + 100)).toEqual([])
      // 50000 seconds elapsed → past target, throttle is cleared.
      expect(tracker.getReadyAgreements(NOW + 50 + 50000)).toEqual(['0x01'])
    })

    test('track from subgraph preserves lastAttemptedAt when lastCollectedAt unchanged', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)

      // Re-track with same lastCollectedAt (subgraph hasn't caught up)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      expect(tracker.getReadyAgreements(NOW + 100)).toEqual([])
    })

    test('track from subgraph clears lastAttemptedAt when lastCollectedAt advances', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT, 900)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)

      // Subgraph shows a newer collection (e.g. via different path)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 100 }))
      // Throttle cleared — but minSecondsPerCollection (3600) still blocks
      expect(tracker.getReadyAgreements(NOW + 100)).toEqual([])
    })

    test('default throttle is 15 minutes when not specified', () => {
      const tracker = new CollectionTracker(DEFAULT_TARGET_PCT)
      tracker.track('0x01', makeState({ lastCollectedAt: NOW - 50000 }))
      tracker.markAttempted('0x01', NOW)
      expect(tracker.getReadyAgreements(NOW + 14 * 60)).toEqual([])
      expect(tracker.getReadyAgreements(NOW + 15 * 60 + 1)).toEqual(['0x01'])
    })
  })
})
