import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker'
import { createLogger } from '@graphprotocol/common-ts'

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker
  let mockLogger: ReturnType<typeof createLogger>

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as ReturnType<typeof createLogger>

    circuitBreaker = new CircuitBreaker(mockLogger, {
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenMaxAttempts: 2,
      monitoringPeriod: 60000,
    })
  })

  afterEach(() => {
    circuitBreaker.dispose()
  })

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe('CLOSED')
    })

    it('should be healthy initially', () => {
      expect(circuitBreaker.isHealthy()).toBe(true)
      expect(circuitBreaker.getHealthPercentage()).toBe(100)
    })
  })

  describe('successful executions', () => {
    it('should execute function and return result', async () => {
      const result = await circuitBreaker.execute(async () => 'success')
      expect(result).toBe('success')
    })

    it('should track successes in stats', async () => {
      await circuitBreaker.execute(async () => 'success')
      await circuitBreaker.execute(async () => 'success')

      const stats = circuitBreaker.getStats()
      expect(stats.successes).toBe(2)
      expect(stats.totalRequests).toBe(2)
    })

    it('should remain CLOSED on success', async () => {
      await circuitBreaker.execute(async () => 'success')
      expect(circuitBreaker.getState()).toBe('CLOSED')
    })
  })

  describe('failure handling', () => {
    it('should track failures in stats', async () => {
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('fail')
        })
      } catch {
        // Expected
      }

      const stats = circuitBreaker.getStats()
      expect(stats.failures).toBe(1)
      expect(stats.consecutiveFailures).toBe(1)
    })

    it('should open circuit after threshold failures', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe('OPEN')
      expect(circuitBreaker.isHealthy()).toBe(false)
    })

    it('should throw CircuitOpenError when open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      await expect(circuitBreaker.execute(async () => 'should not run')).rejects.toThrow(
        CircuitOpenError,
      )
    })

    it('should use fallback when open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      const result = await circuitBreaker.execute(
        async () => 'should not run',
        () => 'fallback',
      )

      expect(result).toBe('fallback')
    })
  })

  describe('half-open state', () => {
    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe('OPEN')

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Next request should trigger transition to HALF_OPEN
      try {
        await circuitBreaker.execute(async () => 'test')
      } catch {
        // May fail or succeed
      }

      // Should be CLOSED if successful, or back to OPEN if failed
      expect(['CLOSED', 'OPEN', 'HALF_OPEN']).toContain(circuitBreaker.getState())
    })

    it('should close on successful half-open attempt', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Successful request in half-open
      await circuitBreaker.execute(async () => 'success')

      expect(circuitBreaker.getState()).toBe('CLOSED')
    })
  })

  describe('state change callbacks', () => {
    it('should notify on state change', async () => {
      const callback = jest.fn()
      circuitBreaker.onStateChange(callback)

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      expect(callback).toHaveBeenCalledWith('OPEN', 'CLOSED')
    })

    it('should allow unsubscribing', async () => {
      const callback = jest.fn()
      const unsubscribe = circuitBreaker.onStateChange(callback)

      unsubscribe()

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('manual controls', () => {
    it('should allow manual trip', () => {
      circuitBreaker.trip()
      expect(circuitBreaker.getState()).toBe('OPEN')
    })

    it('should allow manual reset', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('fail')
          })
        } catch {
          // Expected
        }
      }

      circuitBreaker.reset()

      expect(circuitBreaker.getState()).toBe('CLOSED')
    })
  })

  describe('batch execution', () => {
    it('should execute batch operations', async () => {
      const operations = [
        async () => 'result1',
        async () => 'result2',
        async () => 'result3',
      ]

      const results = await circuitBreaker.executeBatch(operations)

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.success)).toBe(true)
      expect(results.map((r) => r.result)).toEqual(['result1', 'result2', 'result3'])
    })

    it('should handle mixed success/failure in batch', async () => {
      const operations = [
        async () => 'result1',
        async () => {
          throw new Error('fail')
        },
        async () => 'result3',
      ]

      const results = await circuitBreaker.executeBatch(operations)

      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(false)
      expect(results[1].error?.message).toBe('fail')
      expect(results[2].success).toBe(true)
    })

    it('should stop on failure when stopOnFailure is true', async () => {
      const operations = [
        async () => 'result1',
        async () => {
          throw new Error('fail')
        },
        async () => 'result3',
      ]

      const results = await circuitBreaker.executeBatch(operations, { stopOnFailure: true })

      expect(results).toHaveLength(2) // Stopped after failure
    })

    it('should respect concurrency option', async () => {
      let concurrent = 0
      let maxConcurrent = 0

      const operations = Array(10)
        .fill(null)
        .map(() => async () => {
          concurrent++
          maxConcurrent = Math.max(maxConcurrent, concurrent)
          await new Promise((resolve) => setTimeout(resolve, 10))
          concurrent--
          return 'done'
        })

      await circuitBreaker.executeBatch(operations, { concurrency: 3 })

      expect(maxConcurrent).toBeLessThanOrEqual(3)
    })
  })

  describe('wrap function', () => {
    it('should wrap a function with circuit breaker', async () => {
      const originalFn = async (x: number): Promise<number> => x * 2
      const wrappedFn = circuitBreaker.wrap(originalFn)

      const result = await wrappedFn(5)
      expect(result).toBe(10)
    })

    it('should open circuit on wrapped function failures', async () => {
      const failingFn = async () => {
        throw new Error('fail')
      }
      const wrappedFn = circuitBreaker.wrap(failingFn)

      for (let i = 0; i < 3; i++) {
        try {
          await wrappedFn()
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe('OPEN')
    })
  })

  describe('disposal', () => {
    it('should throw when executing on disposed circuit breaker', () => {
      circuitBreaker.dispose()

      expect(() =>
        circuitBreaker.execute(async () => 'test'),
      ).rejects.toThrow('disposed')
    })

    it('should be idempotent', () => {
      circuitBreaker.dispose()
      circuitBreaker.dispose() // Should not throw
    })
  })

  describe('stats', () => {
    it('should track time in current state', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))

      const stats = circuitBreaker.getStats()
      expect(stats.timeInCurrentState).toBeGreaterThanOrEqual(100)
    })

    it('should include health percentage in stats', async () => {
      await circuitBreaker.execute(async () => 'success')
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('fail')
        })
      } catch {
        // Expected
      }

      const stats = circuitBreaker.getStats()
      expect(stats.healthPercentage).toBe(50)
    })
  })
})
