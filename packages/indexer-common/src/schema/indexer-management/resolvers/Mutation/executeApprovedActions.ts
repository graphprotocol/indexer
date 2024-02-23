import type { MutationResolvers } from './../../../types.generated'

export const executeApprovedActions: NonNullable<
  MutationResolvers['executeApprovedActions']
> = async (_parent, _arg, { logger: parentLogger, actionManager }) => {
  const logger = parentLogger.child({ function: 'executeApprovedActions' })
  logger.trace(`Begin executing 'executeApprovedActions' mutation`)
  if (!actionManager) {
    throw Error('IndexerManagementClient must be in `network` mode to modify actions')
  }
  const result = await actionManager.multiNetworks.map(async (network) => {
    logger.debug(`Execute 'executeApprovedActions' mutation`, {
      protocolNetwork: network.specification.networkIdentifier,
    })
    try {
      return await actionManager.executeApprovedActions(network)
    } catch (error) {
      logger.error('Failed to execute approved actions for network', {
        protocolNetwork: network.specification.networkIdentifier,
        error,
      })
      return []
    }
  })
  return Object.values(result).flat()
}
