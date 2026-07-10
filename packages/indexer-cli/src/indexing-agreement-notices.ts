import { IndexingDecisionBasis, IndexingRuleAttributes } from '@graphprotocol/indexer-common'

// The network settles an indexing agreement inside the allocation close itself
// (SubgraphService cancels it, or reverts the close when its guard is enabled).
// These notices surface that at the terminal instead of only in the agent log.

export function isDipsManagedRule(
  rule: Partial<IndexingRuleAttributes> | null | undefined,
): boolean {
  return rule?.decisionBasis === IndexingDecisionBasis.DIPS
}

export function closedAllocationAgreementNotice(
  deployment: string,
  network: string,
): string {
  return [
    'This deployment is managed by an indexing agreement (DIPS).',
    'Closing an allocation cancels any agreement bound to it on-chain, and payments for it stop.',
    'Future agreement proposals remain allowed; to opt out of those as well:',
    '',
    `  graph indexer rules never ${deployment} --network ${network}`,
  ].join('\n')
}

export function queuedUnallocateAgreementWarning(
  actionID: number,
  network: string,
): string {
  return [
    'This deployment is managed by an indexing agreement (DIPS).',
    'When this unallocate executes, the network will cancel any agreement bound to the',
    'allocation and payments for it will stop. To back out before it executes:',
    '',
    `  graph indexer actions cancel ${actionID} --network ${network}`,
  ].join('\n')
}

export function activeAgreementRevertGuidance(
  errorMessage: string,
  deployment: string | undefined,
  network: string,
): string | null {
  if (!errorMessage.includes('SubgraphServiceAllocationHasActiveAgreement')) {
    return null
  }
  return [
    'The network blocked this close: the allocation has an active indexing agreement.',
    'Cancel the agreement first by opting the deployment out:',
    '',
    `  graph indexer rules never ${deployment ?? '<deployment>'} --network ${network}`,
  ].join('\n')
}
