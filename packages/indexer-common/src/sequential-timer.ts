import {
  equal,
  Eventual,
  Logger,
  Mapper,
  mutable,
  Reducer,
  TryMapOptions,
} from '@graphprotocol/common-ts'

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value && typeof (value as PromiseLike<T>).then === 'function'
}

export interface TimerTaskContext {
  logger: Logger
  milliseconds: number
}

/**
 * Create an eventual that performs the work in the Reducer<number, U> function every `milliseconds` milliseconds.
 * The main difference between this and `timer(...).reduce(...)` is that this function will wait for the previous work to complete before starting the next one.
 *
 * @param milliseconds number
 * @param reducer Reducer<number, U>
 * @param initial U
 * @returns Eventual<U>
 */
export function sequentialTimerReduce<T, U>(
  { logger, milliseconds }: TimerTaskContext,
  reducer: Reducer<number, U>,
  initial: U,
): Eventual<U> {
  const output = mutable(initial)
  // obtain the calling method name from the call stack
  const stack = new Error().stack
  const caller = stack?.split('\n')[2].trim()
  let lastWorkStarted = Date.now()

  let acc: U = initial
  let previousT: T | undefined
  let latestT: T | undefined

  function outputReduce(value: U) {
    previousT = latestT
    acc = value
    if (!equal(latestT, previousT)) {
      output.push(value)
    }
  }

  function work() {
    const workStarted = Date.now()
    const promiseOrT = reducer(acc, workStarted)
    const workEnded = Date.now()
    const loopTime = workStarted - lastWorkStarted
    const workTime = workEnded - workStarted
    logger.debug(
      `sequentialTimerReduce loop took ${loopTime}ms, work took ${workTime}ms caller(${caller})`,
    )

    if (workTime > milliseconds) {
      logger.warn(
        'sequentialTimerReduce work took longer than the sequential timer was configured for',
        {
          workTime,
          milliseconds,
        },
      )
    }
    lastWorkStarted = workStarted
    if (isPromiseLike(promiseOrT)) {
      promiseOrT.then(
        function onfulfilled(value) {
          outputReduce(value)
          setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
        },
        function onrejected(err) {
          console.error(err)
          setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
        },
      )
    } else {
      outputReduce(promiseOrT)
      setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
    }
  }
  // initial call
  setTimeout(work, milliseconds)
  return output
}

/**
 * Create an eventual that performs the work in the Mapper<U> function every `milliseconds` milliseconds.
 * The main difference between this and `timer(...).tryMap(...)` is that this function will wait for the previous work to complete before starting the next one.
 *
 * @param milliseconds number
 * @param mapper Mapper<U>
 * @param options TryMapOptions
 * @returns Eventual<U>
 */
export function sequentialTimerMap<U>(
  { logger, milliseconds }: TimerTaskContext,
  mapper: Mapper<number, U>,
  options?: TryMapOptions,
): Eventual<U> {
  // obtain the calling method name from the call stack
  const stack = new Error().stack
  const caller = stack?.split('\n')[2].trim()
  let lastWorkStarted = Date.now()

  const output = mutable<U>()

  let latestU: U | undefined

  // this emulates the behavior of Eventual.tryMap
  function checkMappedValue(value: U) {
    if (!equal(latestU, value)) {
      latestU = value
      output.push(value)
    }
  }

  function work() {
    const workStarted = Date.now()
    const promiseOrU = mapper(Date.now())
    const workEnded = Date.now()
    const loopTime = workStarted - lastWorkStarted
    const workTime = workEnded - workStarted
    logger.debug(
      `sequentialTimerMap loop took ${loopTime}ms, work took ${workTime}ms caller(${caller})`,
    )

    if (workTime > milliseconds) {
      logger.warn(
        'sequentialTimerMap work took longer than the sequential timer was configured for',
        {
          workTime,
          milliseconds,
        },
      )
    }

    lastWorkStarted = workStarted

    if (isPromiseLike(promiseOrU)) {
      promiseOrU.then(
        function onfulfilled(value) {
          checkMappedValue(value)
          setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
        },
        function onrejected(err) {
          options?.onError(err)
          setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
        },
      )
    } else {
      // resolved value
      checkMappedValue(promiseOrU)
      setTimeout(work, Math.max(0, milliseconds - (Date.now() - workStarted)))
    }
  }

  // initial call
  setTimeout(work, milliseconds)
  return output
}
