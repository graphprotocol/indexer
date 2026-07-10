// SubgraphService reverts a close on an allocation with an active indexing
// agreement when its close guard is enabled; translate that raw revert into
// the command that resolves it instead of leaving an opaque error string.
export function activeAgreementRevertGuidance(errorMessage: string): string | null {
  if (!errorMessage.includes('SubgraphServiceAllocationHasActiveAgreement')) {
    return null
  }
  return [
    'The network blocked this close: the allocation has an active indexing agreement.',
    'Cancel the agreement first by opting the deployment out:',
    '',
    '  graph indexer rules never <deployment> --network <network>',
  ].join('\n')
}
