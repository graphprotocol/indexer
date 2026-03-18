import { createLogger } from '@graphprotocol/common-ts'
import { OfferMonitor } from '../offer-monitor'

const logger = createLogger({
  name: 'OfferMonitor.test',
  async: false,
  level: 'error',
})

describe('OfferMonitor', () => {
  it('converts UUID-format agreement ids to bytes16 hex before querying', async () => {
    const query = jest.fn().mockResolvedValue({ data: { offer: { id: '0xabc' } } })
    const subgraph = { query } as never
    const monitor = new OfferMonitor(logger, subgraph)

    const exists = await monitor.offerExists(
      'bea99452-e465-e9d9-8a79-2356edcc7e92',
    )

    expect(exists).toBe(true)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][1]).toEqual({
      id: '0xbea99452e465e9d98a792356edcc7e92',
    })
  })

  it('passes through already-hex ids unchanged (lowercased)', async () => {
    const query = jest.fn().mockResolvedValue({ data: { offer: { id: '0xabc' } } })
    const subgraph = { query } as never
    const monitor = new OfferMonitor(logger, subgraph)

    await monitor.offerExists('0xBEA99452E465E9D98A792356EDCC7E92')

    expect(query.mock.calls[0][1]).toEqual({
      id: '0xbea99452e465e9d98a792356edcc7e92',
    })
  })

  it('returns false when the subgraph reports the offer is missing', async () => {
    const query = jest.fn().mockResolvedValue({ data: { offer: null } })
    const subgraph = { query } as never
    const monitor = new OfferMonitor(logger, subgraph)

    const exists = await monitor.offerExists(
      'bea99452-e465-e9d9-8a79-2356edcc7e92',
    )

    expect(exists).toBe(false)
  })

  it('treats subgraph errors as transient (not yet on-chain)', async () => {
    const query = jest
      .fn()
      .mockResolvedValue({ error: new Error('subgraph hiccup') })
    const subgraph = { query } as never
    const monitor = new OfferMonitor(logger, subgraph)

    const exists = await monitor.offerExists(
      'bea99452-e465-e9d9-8a79-2356edcc7e92',
    )

    expect(exists).toBe(false)
  })
})
