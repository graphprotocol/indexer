import { extractNetwork } from '../../../../indexer-management/resolvers/utils'
import {
  IdentifierType,
  IndexingDecisionBasis,
  type MutationResolvers,
} from './../../../types.generated'
import { SubgraphDeploymentID, formatGRT, parseGRT } from '@graphprotocol/common-ts'
import { AllocationStatus } from '../../../../allocations/types'
import { IndexerErrorCode, indexerError } from '../../../../errors'
import { allocationIdProof, uniqueAllocationID } from '../../../../allocations/keys'
import { utils } from 'ethers'

export const createAllocation: NonNullable<
  MutationResolvers['createAllocation']
> = async (
  _parent,
  { deployment, amount, protocolNetwork },
  { logger, multiNetworks, graphNode, models },
) => {
  logger.debug('Execute createAllocation() mutation', {
    deployment,
    amount,
    protocolNetwork,
  })
  if (!multiNetworks) {
    throw Error('IndexerManagementClient must be in `network` mode to fetch allocations')
  }
  const network = extractNetwork(protocolNetwork, multiNetworks)
  const networkMonitor = network.networkMonitor
  const contracts = network.contracts
  const transactionManager = network.transactionManager
  const address = network.specification.indexerOptions.address

  const allocationAmount = parseGRT(amount)
  const subgraphDeployment = new SubgraphDeploymentID(deployment)

  const activeAllocations = await networkMonitor.allocations(AllocationStatus.ACTIVE)

  const allocation = activeAllocations.find(
    (allocation) =>
      allocation.subgraphDeployment.id.toString() === subgraphDeployment.toString(),
  )
  if (allocation) {
    logger.warn('Already allocated to deployment', {
      deployment: allocation.subgraphDeployment.id.ipfsHash,
      activeAllocation: allocation.id,
    })
    throw indexerError(
      IndexerErrorCode.IE060,
      `Allocation failed. An active allocation already exists for deployment '${allocation.subgraphDeployment.id.ipfsHash}'`,
    )
  }

  if (allocationAmount.lt('0')) {
    logger.warn('Cannot allocate a negative amount of GRT', {
      amount: formatGRT(allocationAmount),
    })
    throw indexerError(
      IndexerErrorCode.IE061,
      `Invalid allocation amount provided (${amount.toString()}). Must use positive allocation amount`,
    )
  }

  try {
    const currentEpoch = await contracts.epochManager.currentEpoch()

    // Identify how many GRT the indexer has staked
    const freeStake = await contracts.staking.getIndexerCapacity(address)

    // If there isn't enough left for allocating, abort
    if (freeStake.lt(allocationAmount)) {
      logger.error(
        `Allocation of ${formatGRT(
          allocationAmount,
        )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT`,
      )
      throw indexerError(
        IndexerErrorCode.IE013,
        `Allocation of ${formatGRT(
          allocationAmount,
        )} GRT cancelled: indexer only has a free stake amount of ${formatGRT(
          freeStake,
        )} GRT`,
      )
    }

    // Ensure subgraph is deployed before allocating
    await graphNode.ensure(
      `indexer-agent/${subgraphDeployment.ipfsHash.slice(-10)}`,
      subgraphDeployment,
    )

    logger.debug('Obtain a unique Allocation ID')

    // Obtain a unique allocation ID
    const { allocationSigner, allocationId } = uniqueAllocationID(
      transactionManager.wallet.mnemonic.phrase,
      currentEpoch.toNumber(),
      subgraphDeployment,
      activeAllocations.map((allocation) => allocation.id),
    )

    // Double-check whether the allocationID already exists on chain, to
    // avoid unnecessary transactions.
    // Note: We're checking the allocation state here, which is defined as
    //
    //     enum AllocationState { Null, Active, Closed, Finalized }
    //
    // in the contracts.
    const state = await contracts.staking.getAllocationState(allocationId)
    if (state !== 0) {
      logger.debug(`Skipping allocation as it already exists onchain`, {
        indexer: address,
        allocation: allocationId,
        state,
      })
      throw indexerError(
        IndexerErrorCode.IE066,
        `Allocation '${allocationId}' already exists onchain`,
      )
    }

    logger.debug('Generating new allocation ID proof', {
      newAllocationSigner: allocationSigner,
      newAllocationID: allocationId,
      indexerAddress: address,
    })

    const proof = await allocationIdProof(allocationSigner, address, allocationId)

    logger.debug('Successfully generated allocation ID proof', {
      allocationIDProof: proof,
    })

    logger.debug(`Sending allocateFrom transaction`, {
      indexer: address,
      subgraphDeployment: subgraphDeployment.ipfsHash,
      amount: formatGRT(allocationAmount),
      allocation: allocationId,
      proof,
      protocolNetwork,
    })

    const receipt = await transactionManager.executeTransaction(
      async () =>
        contracts.staking.estimateGas.allocateFrom(
          address,
          subgraphDeployment.bytes32,
          allocationAmount,
          allocationId,
          utils.hexlify(Array(32).fill(0)),
          proof,
        ),
      async (gasLimit) =>
        contracts.staking.allocateFrom(
          address,
          subgraphDeployment.bytes32,
          allocationAmount,
          allocationId,
          utils.hexlify(Array(32).fill(0)),
          proof,
          { gasLimit },
        ),
      logger.child({ action: 'allocate' }),
    )

    if (receipt === 'paused' || receipt === 'unauthorized') {
      throw indexerError(
        IndexerErrorCode.IE062,
        `Allocation not created. ${
          receipt === 'paused' ? 'Network paused' : 'Operator not authorized'
        }`,
      )
    }

    const createAllocationEventLogs = network.transactionManager.findEvent(
      'AllocationCreated',
      network.contracts.staking.interface,
      'subgraphDeploymentID',
      subgraphDeployment.toString(),
      receipt,
      logger,
    )

    if (!createAllocationEventLogs) {
      throw indexerError(
        IndexerErrorCode.IE014,
        `Allocation create transaction was never mined`,
      )
    }

    logger.info(`Successfully allocated to subgraph deployment`, {
      amountGRT: formatGRT(createAllocationEventLogs.tokens),
      allocation: createAllocationEventLogs.allocationID,
      epoch: createAllocationEventLogs.epoch.toString(),
      transaction: receipt.transactionHash,
    })

    logger.debug(
      `Updating indexing rules, so indexer-agent will now manage the active allocation`,
    )
    const indexingRule = {
      identifier: subgraphDeployment.ipfsHash,
      allocationAmount: allocationAmount.toString(),
      identifierType: IdentifierType.deployment,
      decisionBasis: IndexingDecisionBasis.always,
      protocolNetwork,
    }

    await models.IndexingRule.upsert(indexingRule)

    // Since upsert succeeded, we _must_ have a rule
    const updatedRule = await models.IndexingRule.findOne({
      where: { identifier: indexingRule.identifier },
    })
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    logger.debug(`DecisionBasis.ALWAYS rule merged into indexing rules`, {
      rule: updatedRule,
    })

    return {
      actionID: 0,
      type: 'allocate',
      transactionID: receipt.transactionHash,
      deployment,
      allocation: createAllocationEventLogs.allocationID,
      allocatedTokens: formatGRT(allocationAmount.toString()),
      protocolNetwork,
    }
  } catch (error) {
    logger.error(`Failed to allocate`, {
      amount: formatGRT(allocationAmount),
      error,
    })
    throw error
  }
}
