/* eslint-disable @typescript-eslint/no-explicit-any */
import { NetworkMonitor } from '../indexer-management/monitor'

const ALLOCATION_ID = '0x1234567890123456789012345678901234567890'
const AGREEMENT_ID = '0xabcdef000000000000000000000000ab'

const createLogger = () =>
  ({
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }) as any

const createMonitor = (opts: {
  agreements?: { id: string; state: string }[] | null
  getCollectionInfo?: jest.Mock
}) => {
  // agreements === null models "no indexing-payments subgraph configured".
  const indexingPaymentsSubgraph =
    opts.agreements === null
      ? undefined
      : ({
          checkedQuery: jest
            .fn()
            .mockResolvedValue({ data: { indexingAgreements: opts.agreements } }),
        } as any)
  const contracts = {
    RecurringCollector: {
      getCollectionInfo:
        opts.getCollectionInfo ?? jest.fn().mockResolvedValue([false, 0n, 0]),
    },
  } as any
  return new NetworkMonitor(
    'eip155:421614',
    contracts,
    {} as any, // indexerOptions
    createLogger(),
    {} as any, // graphNode
    {} as any, // networkSubgraph
    {} as any, // ethereum provider
    {} as any, // epochSubgraph
    indexingPaymentsSubgraph,
  )
}

describe('NetworkMonitor.hasCollectableDipsAgreement', () => {
  it('returns false when no indexing-payments subgraph is configured', async () => {
    const monitor = createMonitor({ agreements: null })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(false)
  })

  it('protects an Accepted agreement without consulting the collector', async () => {
    const getCollectionInfo = jest.fn()
    const monitor = createMonitor({
      agreements: [{ id: AGREEMENT_ID, state: 'Accepted' }],
      getCollectionInfo,
    })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(true)
    expect(getCollectionInfo).not.toHaveBeenCalled()
  })

  it('protects a payer-canceled agreement while the collector reports collectable fees', async () => {
    const getCollectionInfo = jest.fn().mockResolvedValue([true, 120n, 0])
    const monitor = createMonitor({
      agreements: [{ id: AGREEMENT_ID, state: 'CanceledByPayer' }],
      getCollectionInfo,
    })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(true)
    expect(getCollectionInfo).toHaveBeenCalledWith(AGREEMENT_ID)
  })

  it('releases a payer-canceled agreement once the collector reports it fully drained', async () => {
    const getCollectionInfo = jest.fn().mockResolvedValue([false, 0n, 1])
    const monitor = createMonitor({
      agreements: [{ id: AGREEMENT_ID, state: 'CanceledByPayer' }],
      getCollectionInfo,
    })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(false)
  })

  it('keeps protecting when the collector call fails, to avoid stranding fees', async () => {
    const getCollectionInfo = jest.fn().mockRejectedValue(new Error('rpc down'))
    const monitor = createMonitor({
      agreements: [{ id: AGREEMENT_ID, state: 'CanceledByPayer' }],
      getCollectionInfo,
    })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(true)
  })

  it('returns false when there are no protecting agreements for the allocation', async () => {
    const monitor = createMonitor({ agreements: [] })
    expect(await monitor.hasCollectableDipsAgreement(ALLOCATION_ID)).toBe(false)
  })
})
