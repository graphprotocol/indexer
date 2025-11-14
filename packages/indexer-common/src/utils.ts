import {
  Provider,
  JsonRpcProvider,
  getDefaultProvider,
  formatEther,
  HDNodeWallet,
} from 'ethers'
import { Logger, Metrics } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from './errors'
import { DocumentNode, SelectionSetNode, Kind } from 'graphql'
import cloneDeep from 'lodash.clonedeep'
import { sequentialTimerMap } from './sequential-timer'
import { parseCustomError } from '@graphprotocol/toolshed'

export const parseBoolean = (
  val: string | boolean | number | undefined | null,
): boolean => {
  const s = val && val.toString().toLowerCase().trim()
  return s != 'false' && s != 'f' && s != '0'
}

export function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

export function getTestProvider(network: string): Provider {
  const testJsonRpcProviderUrl = process.env.INDEXER_TEST_JRPC_PROVIDER_URL
  if (testJsonRpcProviderUrl) {
    return new JsonRpcProvider(testJsonRpcProviderUrl)
  } else {
    return getDefaultProvider(network)
  }
}

const registerMetrics = (metrics: Metrics, networkIdentifier: string) => ({
  operatorEthBalance: new metrics.client.Gauge({
    name: `indexer_agent_operator_eth_balance_${networkIdentifier}`,
    help: 'Amount of ETH in the operator wallet; a low amount could cause transactions to fail',
    registers: [metrics.registry],
  }),
})

export async function monitorEthBalance(
  logger: Logger,
  wallet: HDNodeWallet,
  metrics: Metrics,
  networkIdentifier: string,
): Promise<void> {
  logger = logger.child({ component: 'ETHBalanceMonitor' })

  logger.info('Monitor operator ETH balance (refreshes every 120s)')

  const balanceMetrics = registerMetrics(metrics, networkIdentifier)

  sequentialTimerMap({ logger, milliseconds: 120_000 }, async () => {
    try {
      const balance = await wallet.provider!.getBalance(wallet.address)
      const eth = parseFloat(formatEther(balance))
      balanceMetrics.operatorEthBalance.set(eth)
      logger.info('Current operator ETH balance', {
        balance: eth,
      })
    } catch (error) {
      logger.warn(`Failed to check latest ETH balance`, {
        err: indexerError(IndexerErrorCode.IE059),
      })
    }
  })
}

export function mergeSelectionSets(
  first: DocumentNode,
  second: DocumentNode,
): DocumentNode {
  // Work on a copy to avoid mutating inupt
  const copy = cloneDeep(first)
  const firstSelectionSet = extractSelectionSet(copy)
  const secondSelectionSet = extractSelectionSet(second)
  firstSelectionSet.selections = [
    ...firstSelectionSet.selections,
    ...secondSelectionSet.selections,
  ]
  return copy
}

function extractSelectionSet(document: DocumentNode): SelectionSetNode {
  // Ensure that the document contains at least one definition
  if (document.definitions.length === 0) {
    throw new Error('Document must contain at least one definition')
  }
  // Find the first SelectionSet in the document
  const firstDefinition = document.definitions[0]
  if (!firstDefinition || firstDefinition.kind !== Kind.OPERATION_DEFINITION) {
    throw new Error('Invalid document definition')
  }
  const selectionSet = findFirstSelectionSet(firstDefinition.selectionSet)
  if (!selectionSet) {
    throw new Error('No SelectionSet found in the document')
  }
  if (!selectionSet.selections) {
    throw new Error('SelectionSet has no selections')
  }

  return selectionSet
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFirstSelectionSet(node: any): SelectionSetNode | null {
  if (node.kind === Kind.SELECTION_SET) {
    return node
  }
  for (const key of Object.keys(node)) {
    const childNode = node[key]
    if (childNode && typeof childNode === 'object') {
      const result = findFirstSelectionSet(childNode)
      if (result !== null) {
        return result
      }
    }
  }
  return null
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function tryParseCustomError(error: unknown): string | unknown {
  try {
    const typedError = error as { code: string; data: string }
    if (typedError && typedError.code === 'CALL_EXCEPTION' && typedError.data) {
      return parseCustomError(typedError.data)
    }
    return error
  } catch (e) {
    return error
  }
}
