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

function logWorkTime(
  workStarted: number,
  logger: Logger,
  caller: string | undefined,
  milliseconds: number,
) {
  const workTimeWarningThreshold = 5000
  const workTime = Date.now() - workStarted
  if (workTime > milliseconds + workTimeWarningThreshold) {
    logger.warn(
      `timer work took ${
        (workTime - milliseconds) / 1000
      }s longer than expected, next execution in ${milliseconds / 1000}s`,
      {
        workTime,
        milliseconds,
        caller,
      },
    )
  }
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
    if (isPromiseLike(promiseOrT)) {
      promiseOrT.then(
        function onfulfilled(value) {
          outputReduce(value)
          logWorkTime(workStarted, logger, caller, milliseconds)
          setTimeout(work, milliseconds)
        },
        function onrejected(err) {
          console.error(err)
          logWorkTime(workStarted, logger, caller, milliseconds)
          setTimeout(work, milliseconds)
        },
      )
    } else {
      outputReduce(promiseOrT)
      logWorkTime(workStarted, logger, caller, milliseconds)
      setTimeout(work, milliseconds)
    }
  }
  // initial call
  work()
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
    const promiseOrU = mapper(workStarted)

    if (isPromiseLike(promiseOrU)) {
      promiseOrU.then(
        function onfulfilled(value) {
          checkMappedValue(value)
          logWorkTime(workStarted, logger, caller, milliseconds)
          setTimeout(work, milliseconds)
        },
        function onrejected(err) {
          options?.onError(err)
          logWorkTime(workStarted, logger, caller, milliseconds)
          setTimeout(work, milliseconds)
        },
      )
    } else {
      // resolved value
      checkMappedValue(promiseOrU)
      logWorkTime(workStarted, logger, caller, milliseconds)
      setTimeout(work, milliseconds)
    }
  }

  // initial call
  work()
  return output
}
