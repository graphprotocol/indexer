/* eslint-disable @typescript-eslint/no-explicit-any */

import { GluegunPrint } from 'gluegun'
import { getBorderCharacters, table } from 'table'
import yaml from 'yaml'
import moment from 'moment'

import { formatGRT, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { AllocationInfo } from 'indexer-common'
import { BigNumber } from 'ethers'

type SubgraphDeploymentIDIsh = SubgraphDeploymentID | 'all'

export const formatAllocation = (allocation: AllocationInfo): any => ({
  id: allocation.id,
  deployment: new SubgraphDeploymentID(allocation.deployment).ipfsHash,
  status: allocation.status.toLowerCase(),
  allocatedTokens: formatGRT(allocation.allocatedTokens),
  pendingRewards: formatGRT(
    BigNumber.from(allocation.indexingRewards).add(allocation.queryFees),
  ),
  closable: allocation.status === 'ACTIVE' ? allocation.ageInEpochs > 0 : false,
  closeDeadline:
    allocation.status === 'ACTIVE'
      ? `epoch ${
          allocation.closeDeadlineEpoch
        } (${allocation.closeDeadlineBlocksRemaining.toLocaleString()} blocks remaining, ~ ${moment
          .duration(moment().diff(moment().add(allocation.closeDeadlineTimeRemaining)))
          .humanize()})`
      : '',
})

export const printAllocations = (
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  deployment: SubgraphDeploymentIDIsh,
  allocations: AllocationInfo[],
): void => {
  if (Array.isArray(allocations)) {
    allocations = allocations.map(allocation => formatAllocation(allocation))
    allocations.sort(
      (a, b) => a.closeDeadlineTimeRemaining - b.closeDeadlineTimeRemaining,
    )
    print.info(displayAllocations(outputFormat, allocations))
  } else if (allocations) {
    const allocation = formatAllocation(allocations)
    print.info(displayAllocation(outputFormat, allocation))
  } else if (deployment) {
    print.error(`No allocation found for "${deployment}"`)
  } else {
    print.error(`No allocations found`)
  }
}

export const displayAllocations = (
  outputFormat: 'table' | 'json' | 'yaml',
  rules: any[],
): string =>
  outputFormat === 'json'
    ? JSON.stringify(rules, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(rules).trim()
    : rules.length === 0
    ? 'No allocations found'
    : table([Object.keys(rules[0]), ...rules.map(rule => Object.values(rule))], {
        border: getBorderCharacters('norc'),
      }).trim()

export const displayAllocation = (
  outputFormat: 'table' | 'json' | 'yaml',
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  rule: any,
): string =>
  outputFormat === 'json'
    ? JSON.stringify(rule, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(rule).trim()
    : table([Object.keys(rule), Object.values(rule)], {
        border: getBorderCharacters('norc'),
      }).trim()
