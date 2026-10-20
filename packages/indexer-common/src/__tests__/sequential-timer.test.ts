import { createLogger } from '@graphprotocol/common-ts'
import { sequentialTimerReduce } from '../sequential-timer'

describe('sequentialTimerReduce', () => {
  const logger = createLogger({
    name: 'Sequential timer tests',
    async: false,
    level: 'error',
  })
  const options = { logger, milliseconds: 20 }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('publishes synchronous results and passes the latest value to the reducer', async () => {
    const reducer = jest.fn((value: number) => value + 1)
    const result = sequentialTimerReduce<number, number>(options, reducer, 0)
    const observed: number[] = []
    result.subscribe((value) => observed.push(value))

    await expect(result.value()).resolves.toBe(1)
    expect(observed).toEqual([1])

    await jest.advanceTimersByTimeAsync(20)

    await expect(result.value()).resolves.toBe(2)
    expect(observed).toEqual([1, 2])
    expect(reducer).toHaveBeenNthCalledWith(2, 1, expect.any(Number))
  })

  it('publishes changed asynchronous results without repeating equal values', async () => {
    const initial = { synced: false, health: 'healthy' }
    const reducer = jest
      .fn()
      .mockResolvedValueOnce({ synced: true, health: 'healthy' })
      .mockResolvedValueOnce({ synced: true, health: 'healthy' })
      .mockResolvedValueOnce({ synced: false, health: 'unhealthy' })
    const result = sequentialTimerReduce(options, reducer, initial)
    const observed: (typeof initial)[] = []
    result.subscribe((value) => observed.push(value))

    expect(observed).toEqual([initial])
    await jest.advanceTimersByTimeAsync(0)
    await expect(result.value()).resolves.toEqual({ synced: true, health: 'healthy' })

    await jest.advanceTimersByTimeAsync(20)
    expect(observed).toHaveLength(2)

    await jest.advanceTimersByTimeAsync(20)
    expect(observed).toEqual([
      initial,
      { synced: true, health: 'healthy' },
      { synced: false, health: 'unhealthy' },
    ])
    await expect(result.value()).resolves.toEqual({ synced: false, health: 'unhealthy' })
  })

  it('waits for each result and retries after a rejected reduction', async () => {
    let resolveFirst: (value: number) => void = () => undefined
    const first = new Promise<number>((resolve) => {
      resolveFirst = resolve
    })
    const reducer = jest
      .fn()
      .mockReturnValueOnce(first)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(2)
    const logError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = sequentialTimerReduce(options, reducer, 0)

    await jest.advanceTimersByTimeAsync(40)
    expect(reducer).toHaveBeenCalledTimes(1)

    resolveFirst(1)
    await jest.advanceTimersByTimeAsync(0)
    await expect(result.value()).resolves.toBe(1)

    await jest.advanceTimersByTimeAsync(20)
    expect(logError).toHaveBeenCalledTimes(1)
    await expect(result.value()).resolves.toBe(1)

    await jest.advanceTimersByTimeAsync(20)
    expect(reducer).toHaveBeenNthCalledWith(3, 1, expect.any(Number))
    await expect(result.value()).resolves.toBe(2)
  })
})
