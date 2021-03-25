import { providers, Wallet } from 'ethers'
import {
  DEFAULT_CHANNEL_TIMEOUT,
  EngineEvents,
  INodeService,
} from '@connext/vector-types'
import { EventCallbackConfig, RestServerNodeService } from '@connext/vector-utils'
import { Logger, Metrics, NetworkContracts } from '@graphprotocol/common-ts'
import fastify from 'fastify'

export interface CreateVectorClientOptions {
  logger: Logger
  metrics: Metrics
  wallet: Wallet
  ethereum: providers.BaseProvider
  contracts: NetworkContracts
  routerIdentifier: string
  nodeUrl: string
  eventServer?: {
    url: string
    port: string
    evts?: Partial<EventCallbackConfig>
  }
}

interface VectorClientOptions {
  logger: Logger
  metrics: Metrics
  wallet: Wallet
  ethereum: providers.BaseProvider
  routerIdentifier: string
  node: INodeService
  channelAddress: string
}

export class VectorClient {
  logger: Logger
  metrics: Metrics
  wallet: Wallet
  ethereum: providers.BaseProvider
  routerIdentifier: string
  public readonly node: INodeService
  public readonly channelAddress: string

  constructor(options: VectorClientOptions) {
    this.logger = options.logger
    this.metrics = options.metrics
    this.wallet = options.wallet
    this.node = options.node
    this.ethereum = options.ethereum
    this.routerIdentifier = options.routerIdentifier
    this.channelAddress = options.channelAddress
  }
}

export async function createVectorClient(
  options: CreateVectorClientOptions,
): Promise<VectorClient> {
  const logger = options.logger.child({ component: 'VectorClient' })

  if (options.eventServer !== undefined) {
    // Start event server for subscribing to vector events
    const serverLogger = logger.child({ component: 'VectorEventServer' })
    serverLogger.info(`Start vector event server`)
    const server = fastify({
      logger: serverLogger.inner,
    })

    for (const eventType in options.eventServer.evts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventInfo = (options.eventServer.evts as any)[eventType]
      server.post(`/${eventType}`, async (request, response) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventInfo.evt?.post(request.body as any)
        return response.status(200).send({ message: 'success' })
      })
    }
    try {
      const address = await server.listen(options.eventServer.port, '0.0.0.0')
      serverLogger.info(`Listening`, { address })
    } catch (err) {
      serverLogger.error(`Failed to start vector event server`, { err })
      process.exit(1)
    }
  }

  // Connect to the vector node
  const evts: EventCallbackConfig = {
    [EngineEvents.IS_ALIVE]: {},
    [EngineEvents.SETUP]: {},
    [EngineEvents.WITHDRAWAL_CREATED]: {},
    [EngineEvents.WITHDRAWAL_RESOLVED]: {},
    [EngineEvents.WITHDRAWAL_RECONCILED]: {},
    [EngineEvents.REQUEST_COLLATERAL]: {},
    [EngineEvents.RESTORE_STATE_EVENT]: {},
    [EngineEvents.CONDITIONAL_TRANSFER_CREATED]: {},
    [EngineEvents.CONDITIONAL_TRANSFER_RESOLVED]: {},
    [EngineEvents.DEPOSIT_RECONCILED]: {},
    [EngineEvents.TRANSACTION_SUBMITTED]: {},
    [EngineEvents.TRANSACTION_FAILED]: {},
    [EngineEvents.TRANSACTION_MINED]: {},

    // Mix in the event overrides
    ...options.eventServer?.evts,
  }

  logger.info(`Connect to vector node`, { url: options.nodeUrl })
  const node = await RestServerNodeService.connect(
    options.nodeUrl,
    logger.inner,
    // NOTE: Only one client can create a subscripton for the same public
    // identifier, so we need to be very careful not to subscribe with two
    // conflicting `evts` in service and agent;
    //
    // For now, we'll assume that service passes in no custom evts and
    // that the agent passes in some custom evts. The service will then pass
    // undefined to `connect()`, which shouldn't overwrite what the agent
    // subscribes to.
    options.eventServer?.evts ? evts : undefined,
    0,
  )
  logger.info(`Successfully connected to vector node`)

  // Ensure there is a channel set up with the router
  logger.info(`Establish state channel with router`, {
    publicIdentifier: node.publicIdentifier,
    counterpartyIdentifier: options.routerIdentifier,
    chainId: options.ethereum.network.chainId,
  })
  let channelAddress: string
  try {
    const value = (
      await node.getStateChannelByParticipants({
        publicIdentifier: node.publicIdentifier,
        counterparty: options.routerIdentifier,
        chainId: options.ethereum.network.chainId,
      })
    ).getValue()

    if (value === undefined) {
      throw new Error(
        `Channel between "${node.publicIdentifier}" and "${options.routerIdentifier}" does not exist`,
      )
    }

    channelAddress = value.channelAddress
  } catch (err) {
    try {
      const setupResult = (
        await node.setup({
          counterpartyIdentifier: options.routerIdentifier,
          chainId: options.ethereum.network.chainId,
          timeout: DEFAULT_CHANNEL_TIMEOUT.toString(),
        })
      ).getValue()
      const value = (
        await node.getStateChannel({
          channelAddress: setupResult.channelAddress,
        })
      ).getValue()

      if (value === undefined) {
        throw new Error(
          `Channel between "${node.publicIdentifier}" and "${options.routerIdentifier}" could not be set up`,
        )
      }
      channelAddress = value.channelAddress
    } catch (err) {
      logger.error(`Failed to set up state channel with router`, {
        publicIdentifier: node.publicIdentifier,
        counterpartyIdentifier: options.routerIdentifier,
        chainId: options.ethereum.network.chainId,
      })
      throw err
    }
  }

  return new VectorClient({
    ...options,
    logger,
    node,
    channelAddress,
  })
}
