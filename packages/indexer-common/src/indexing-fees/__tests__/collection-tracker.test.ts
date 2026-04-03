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
})
