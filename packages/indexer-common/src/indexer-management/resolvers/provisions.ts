import { indexerError, IndexerErrorCode, Network } from '@graphprotocol/indexer-common'
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint-disable @typescript-eslint/ban-types */

import gql from 'graphql-tag'

import { IndexerManagementResolverContext } from '@graphprotocol/indexer-common'
import { extractNetwork } from './utils'
import { formatGRT, parseGRT } from '@graphprotocol/common-ts'
import { ThawRequestType } from '@graphprotocol/toolshed'

enum ProvisionQuery {
  all = 'all',
  thawRequests = 'thawRequests',
}

interface ProvisionInfo {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: string
  tokensAllocated: string
  tokensThawing: string
  maxVerifierCut: string
  thawingPeriod: string
  protocolNetwork: string
  idleStake: string
}

interface AddToProvisionResult {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: string
  protocolNetwork: string
}

interface ThawFromProvisionResult {
  id: string
  dataService: string
  indexer: string
  tokensThawing: string
  thawingPeriod: string
  thawingUntil: string
  protocolNetwork: string
}

interface ThawRequestInfo {
  id: string
  fulfilled: string
  dataService: string
  indexer: string
  shares: string
  thawingUntil: string
  currentBlockTimestamp: string
}

interface RemoveFromProvisionResult {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: string
  tokensThawing: string
  tokensRemoved: string
  protocolNetwork: string
}

const PROVISION_QUERIES = {
  // No need to paginate, there can only be one provision per (indexer, dataService) pair
  [ProvisionQuery.all]: gql`
    query provisions($indexer: String!, $dataService: String!) {
      provisions(
        where: { indexer: $indexer, dataService: $dataService }
        orderBy: id
        orderDirection: asc
        first: 1000
      ) {
        id
        indexer {
          id
        }
        dataService {
          id
        }
        tokensProvisioned
        tokensAllocated
        tokensThawing
        thawingPeriod
        maxVerifierCut
      }
    }
  `,
  // No need to paginate, there can be at most 1000 thaw requests for any given (indexer, dataService) pair
  [ProvisionQuery.thawRequests]: gql`
    query thawRequests($indexer: String!, $dataService: String!) {
      thawRequests(
        where: { indexer: $indexer, dataService: $dataService, owner: $indexer }
        orderBy: thawingUntil
        orderDirection: asc
        first: 1000
      ) {
        id
        fulfilled
        shares
        thawingUntil
      }
    }
  `,
}

export default {
  provisions: async (
    {
      protocolNetwork,
    }: {
      protocolNetwork: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<ProvisionInfo[]> => {
    logger.debug('Execute provisions() query', {
      protocolNetwork,
    })

    if (!multiNetworks) {
      throw Error('IndexerManagementClient must be in `network` mode to fetch provisions')
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)

    if (!(await network.isHorizon.value())) {
      throw indexerError(IndexerErrorCode.IE082)
    }

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = network.contracts.SubgraphService.target.toString().toLowerCase()
    const idleStake = await network.contracts.HorizonStaking.getIdleStake(indexer)

    const provisionsByNetwork = await multiNetworks.map(
      async (network: Network): Promise<ProvisionInfo[]> => {
        // Return early if a different protocol network is specifically requested
        if (
          protocolNetwork &&
          protocolNetwork !== network.specification.networkIdentifier
        ) {
          return []
        }

        const { networkSubgraph } = network

        logger.trace('Query Provisions', {
          indexer,
          dataService,
        })

        const result = await networkSubgraph.checkedQuery(PROVISION_QUERIES.all, {
          indexer,
          dataService,
        })

        if (result.error) {
          logger.error('Querying provisions failed', {
            error: result.error,
          })
        }

        return result.data.provisions.map((provision) => ({
          id: provision.id,
          dataService,
          indexer,
          tokensProvisioned: provision.tokensProvisioned,
          tokensAllocated: provision.tokensAllocated,
          tokensThawing: provision.tokensThawing,
          maxVerifierCut: provision.maxVerifierCut,
          thawingPeriod: provision.thawingPeriod,
          protocolNetwork: network.specification.networkIdentifier,
          idleStake: idleStake.toString(),
        }))
      },
    )

    return Object.values(provisionsByNetwork).flat()
  },
  addToProvision: async (
    {
      protocolNetwork,
      amount,
    }: {
      protocolNetwork: string
      amount: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<AddToProvisionResult> => {
    logger.debug('Execute addToProvision() mutation', {
      protocolNetwork,
      amount,
    })

    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to add stake to a provision',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager

    if (!(await network.isHorizon.value())) {
      throw indexerError(IndexerErrorCode.IE082)
    }

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = contracts.SubgraphService.target.toString().toLowerCase()
    const provisionAmount = parseGRT(amount)

    if (provisionAmount < 0n) {
      logger.warn('Cannot add a negative amount of GRT', {
        amount: formatGRT(provisionAmount),
      })
      throw indexerError(
        IndexerErrorCode.IE079,
        `Invalid stake amount provided (${amount.toString()}). Must use positive stake amount`,
      )
    }

    try {
      // Check if the provision exists - this will throw if it doesn't
      const provision = await networkMonitor.provision(indexer, dataService)

      logger.debug('Provision found', {
        provision,
      })

      logger.debug(`Sending addToProvision transaction`, {
        indexer: indexer,
        dataService: dataService,
        amount: formatGRT(provisionAmount),
        protocolNetwork,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.HorizonStaking.addToProvision.estimateGas(
            indexer,
            dataService,
            provisionAmount,
          ),
        async (gasLimit) =>
          contracts.HorizonStaking.addToProvision(indexer, dataService, provisionAmount, {
            gasLimit,
          }),
        logger.child({ action: 'addToProvision' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw indexerError(
          IndexerErrorCode.IE062,
          `Stake not added to provision. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const addToProvisionEventLogs = network.transactionManager.findEvent(
        'ProvisionIncreased',
        network.contracts.HorizonStaking.interface,
        'tokens',
        provisionAmount.toString(),
        receipt,
        logger,
      )

      if (!addToProvisionEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE080,
          `Add to provision transaction was never mined`,
        )
      }

      logger.info(`Successfully added stake to provision`, {
        amountGRT: formatGRT(addToProvisionEventLogs.tokens),
        transaction: receipt.hash,
      })

      return {
        id: provision.id,
        dataService,
        indexer,
        tokensProvisioned: (provision.tokensProvisioned + provisionAmount).toString(), // TODO: we could re-fetch the provision instead
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      logger.error('Failed to add stake to provision', {
        amount: formatGRT(provisionAmount),
        error,
      })
      throw error
    }
  },
  thawFromProvision: async (
    {
      protocolNetwork,
      amount,
    }: {
      protocolNetwork: string
      amount: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<ThawFromProvisionResult> => {
    logger.debug('Execute thawFromProvision() mutation', {
      protocolNetwork,
      amount,
    })

    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to add stake to a provision',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager

    if (!(await network.isHorizon.value())) {
      throw indexerError(IndexerErrorCode.IE082)
    }

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = contracts.SubgraphService.target.toString().toLowerCase()
    const thawAmount = parseGRT(amount)

    if (thawAmount < 0n) {
      logger.warn('Cannot thaw a negative amount of GRT', {
        amount: formatGRT(thawAmount),
      })
      throw indexerError(
        IndexerErrorCode.IE083,
        `Invalid stake amount provided (${amount.toString()}). Must use positive stake amount`,
      )
    }

    try {
      // Check if the provision exists - this will throw if it doesn't
      const provision = await networkMonitor.provision(indexer, dataService)

      logger.debug('Provision found', {
        provision,
      })

      const delegationRatio = await contracts.SubgraphService.getDelegationRatio()
      const tokensAvailable = await contracts.HorizonStaking.getTokensAvailable(
        indexer,
        dataService,
        delegationRatio,
      )

      if (thawAmount > tokensAvailable) {
        throw indexerError(
          IndexerErrorCode.IE083,
          `Cannot thaw more stake than is available in the provision: thaw amount (${formatGRT(
            thawAmount,
          )}) > tokens available (${formatGRT(tokensAvailable)})`,
        )
      }

      logger.debug(`Sending thawFromProvision transaction`, {
        indexer: indexer,
        dataService: dataService,
        amount: formatGRT(thawAmount),
        protocolNetwork,
      })

      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.HorizonStaking.thaw.estimateGas(indexer, dataService, thawAmount),
        async (gasLimit) =>
          contracts.HorizonStaking.thaw(indexer, dataService, thawAmount, {
            gasLimit,
          }),
        logger.child({ action: 'thawFromProvision' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw indexerError(
          IndexerErrorCode.IE062,
          `Stake not thawed from provision. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const thawFromProvisionEventLogs = network.transactionManager.findEvent(
        'ProvisionThawed',
        network.contracts.HorizonStaking.interface,
        'tokens',
        thawAmount.toString(),
        receipt,
        logger,
      )

      if (!thawFromProvisionEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE083,
          `Thaw from provision transaction was never mined`,
        )
      }

      const thawRequestCreatedTopic =
        network.contracts.HorizonStaking.interface.getEvent(
          'ThawRequestCreated',
        ).topicHash
      const thawRequestCreatedLog = receipt.logs.filter((log) =>
        log.topics.includes(thawRequestCreatedTopic),
      )[0]
      const thawRequestCreatedEvent =
        network.contracts.HorizonStaking.interface.decodeEventLog(
          network.contracts.HorizonStaking.interface.getEvent('ThawRequestCreated'),
          thawRequestCreatedLog.data,
          thawRequestCreatedLog.topics,
        )

      logger.info(`Successfully thawed stake from provision`, {
        amountGRT: formatGRT(thawFromProvisionEventLogs.tokens),
        thawingUntil: thawRequestCreatedEvent.thawingUntil,
        transaction: receipt.hash,
      })

      return {
        id: provision.id,
        dataService,
        indexer,
        tokensThawing: (provision.tokensThawing + thawAmount).toString(), // TODO: we could re-fetch the provision instead
        thawingPeriod: provision.thawingPeriod.toString(),
        thawingUntil: thawRequestCreatedEvent.thawingUntil.toString(),
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      logger.error('Failed to thaw stake from provision', {
        amount: formatGRT(thawAmount),
        error,
      })
      throw error
    }
  },
  thawRequests: async (
    {
      protocolNetwork,
    }: {
      protocolNetwork: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<ThawRequestInfo[]> => {
    logger.debug('Execute thawRequests() query', {
      protocolNetwork,
    })

    if (!multiNetworks) {
      throw Error('IndexerManagementClient must be in `network` mode to fetch provisions')
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)

    if (!(await network.isHorizon.value())) {
      throw indexerError(IndexerErrorCode.IE082)
    }

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = network.contracts.SubgraphService.target.toString().toLowerCase()

    const thawRequestsByNetwork = await multiNetworks.map(
      async (network: Network): Promise<ThawRequestInfo[]> => {
        // Return early if a different protocol network is specifically requested
        if (
          protocolNetwork &&
          protocolNetwork !== network.specification.networkIdentifier
        ) {
          return []
        }

        const { networkSubgraph } = network

        logger.trace('Query Thaw Requests', {
          indexer,
          dataService,
        })

        const result = await networkSubgraph.checkedQuery(
          PROVISION_QUERIES.thawRequests,
          {
            indexer,
            dataService,
          },
        )

        if (result.error) {
          logger.error('Querying thaw requests failed', {
            error: result.error,
          })
        }

        const currentBlockTimestamp =
          (await network.networkProvider.getBlock('latest'))?.timestamp ?? 0

        return result.data.thawRequests.map((thawRequest) => ({
          id: thawRequest.id,
          fulfilled: thawRequest.fulfilled,
          dataService,
          indexer,
          shares: thawRequest.shares,
          thawingUntil: thawRequest.thawingUntil,
          currentBlockTimestamp: currentBlockTimestamp.toString(),
          protocolNetwork: network.specification.networkIdentifier,
        }))
      },
    )

    return Object.values(thawRequestsByNetwork).flat()
  },
  removeFromProvision: async (
    {
      protocolNetwork,
    }: {
      protocolNetwork: string
    },
    { multiNetworks, logger }: IndexerManagementResolverContext,
  ): Promise<RemoveFromProvisionResult> => {
    logger.debug('Execute removeFromProvision() mutation', {
      protocolNetwork,
    })

    if (!multiNetworks) {
      throw Error(
        'IndexerManagementClient must be in `network` mode to add stake to a provision',
      )
    }

    const network = extractNetwork(protocolNetwork, multiNetworks)
    const networkMonitor = network.networkMonitor
    const contracts = network.contracts
    const transactionManager = network.transactionManager

    if (!(await network.isHorizon.value())) {
      throw indexerError(IndexerErrorCode.IE082)
    }

    const indexer = network.specification.indexerOptions.address.toLowerCase()
    const dataService = contracts.SubgraphService.target.toString().toLowerCase()

    try {
      // Check if the provision exists - this will throw if it doesn't
      const provision = await networkMonitor.provision(indexer, dataService)

      logger.debug('Provision found', {
        provision,
      })

      const thawedTokens = await contracts.HorizonStaking.getThawedTokens(
        ThawRequestType.Provision,
        indexer,
        dataService,
        indexer,
      )

      // return early if there are no expired thaw requests
      if (thawedTokens === 0n) {
        return {
          id: provision.id,
          dataService,
          indexer,
          tokensProvisioned: provision.tokensProvisioned.toString(),
          tokensThawing: provision.tokensThawing.toString(),
          tokensRemoved: '0',
          protocolNetwork: network.specification.networkIdentifier,
        }
      }

      logger.debug(`Sending deprovision transaction`, {
        indexer: indexer,
        dataService: dataService,
        protocolNetwork,
      })

      // deprovision all expired thaw requests
      const receipt = await transactionManager.executeTransaction(
        async () =>
          contracts.HorizonStaking.deprovision.estimateGas(indexer, dataService, 0),
        async (gasLimit) =>
          contracts.HorizonStaking.deprovision(indexer, dataService, 0, {
            gasLimit,
          }),
        logger.child({ action: 'deprovision' }),
      )

      if (receipt === 'paused' || receipt === 'unauthorized') {
        throw indexerError(
          IndexerErrorCode.IE062,
          `Stake not thawed from provision. ${
            receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
          }`,
        )
      }

      const thawFromProvisionEventLogs = network.transactionManager.findEvent(
        'TokensDeprovisioned',
        network.contracts.HorizonStaking.interface,
        'serviceProvider',
        indexer.toString(),
        receipt,
        logger,
      )

      if (!thawFromProvisionEventLogs) {
        throw indexerError(
          IndexerErrorCode.IE083,
          `Thaw from provision transaction was never mined`,
        )
      }

      logger.info(`Successfully deprovisioned stake from provision`, {
        amountGRT: formatGRT(thawFromProvisionEventLogs.tokens),
        thawedTokens: thawedTokens.toString(),
        transaction: receipt.hash,
      })

      return {
        id: provision.id,
        dataService,
        indexer,
        tokensProvisioned: provision.tokensProvisioned.toString(),
        tokensThawing: (provision.tokensThawing - thawedTokens).toString(), // TODO: we could re-fetch the provision instead
        tokensRemoved: thawedTokens.toString(),
        protocolNetwork: network.specification.networkIdentifier,
      }
    } catch (error) {
      logger.error('Failed to deprovision stake from provision', {
        error,
      })
      throw error
    }
  },
}
