import { Wallet, utils } from 'ethers'
import {
  BaseProvider,
  JsonRpcProvider,
  getDefaultProvider,
} from '@ethersproject/providers'
import { Logger, Metrics, timer } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from './errors'
import { Sequelize } from 'sequelize'

interface ConnectOptions {
  host: string
  port?: number
  username: string
  password: string
  database: string
  logging?: (sql: string, timing?: number) => void
  poolMin?: number
  poolMax?: number
}

export const parseBoolean = (
  val: string | boolean | number | undefined | null,
): boolean => {
  const s = val && val.toString().toLowerCase().trim()
  return s != 'false' && s != 'f' && s != '0'
}

export function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

export function getTestProvider(network: string): BaseProvider {
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
  wallet: Wallet,
  metrics: Metrics,
  networkIdentifier: string,
): Promise<void> {
  logger = logger.child({ component: 'ETHBalanceMonitor' })

  logger.info('Monitor operator ETH balance (refreshes every 120s)')

  const balanceMetrics = registerMetrics(metrics, networkIdentifier)

  timer(120_000).pipe(async () => {
    try {
      const balance = await wallet.getBalance()
      const eth = parseFloat(utils.formatEther(balance))
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

// Copied from @graphprotocol/common-ts, but adding pool size options
// TODO: Add these options in common-ts and remove this
export const connectDatabase = async (options: ConnectOptions): Promise<Sequelize> => {
  const { host, username, password, database, logging } = options

  // Use port 5432 by default
  const port = options.port || 5432
  const poolMin = options.poolMin || 0
  const poolMax = options.poolMax || 10

  // Connect to the database
  const sequelize = new Sequelize({
    dialect: 'postgres',
    host,
    port,
    username,
    password,
    database,
    pool: {
      max: poolMax,
      min: poolMin,
    },
    logging,
  })

  // Test the connection
  await sequelize.authenticate()

  // All good, return the connection
  return sequelize
}
