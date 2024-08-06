import type { MutationResolvers } from './../../../types.generated'
import { extractNetwork } from '../utils'

export const submitCollectReceiptsJob: NonNullable<
  MutationResolvers['submitCollectReceiptsJob']
> = async (_parent, { allocation, protocolNetwork }, { logger, multiNetworks }) => {
  logger.debug('Execute collectAllocationReceipts() mutation', {
    allocationID: allocation,
    protocolNetwork,
  })
  if (!multiNetworks) {
    throw Error(
      'IndexerManagementClient must be in `network` mode to collect receipts for an allocation',
    )
  }
  const network = extractNetwork(protocolNetwork, multiNetworks)
  const networkMonitor = network.networkMonitor
  const receiptCollector = network.receiptCollector

  const allocationData = await networkMonitor.allocation(allocation)

  try {
    logger.info('Identifying receipts worth collecting', {
      allocation: allocation,
    })

    // Collect query fees for this allocation
    const collecting = await receiptCollector.collectReceipts(0, allocationData)

    logger.info(`Submitted allocation receipt collection job for execution`, {
      allocationID: allocation,
      protocolNetwork: network.specification.networkIdentifier,
    })
    return collecting
  } catch (error) {
    logger.error(error.toString())
    throw error
  }
}
