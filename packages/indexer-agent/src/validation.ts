import {
  parseTaggedUrl,
  parseTaggedIpfsHash,
  validateNetworkIdentifier,
} from '@graphprotocol/indexer-common'

import {
  MaybeTaggedIpfsHash,
  MaybeTaggedUrl,
} from 'indexer-common/src/parsers/tagged'
import countBy from 'lodash.countby'
import isEqual from 'lodash.isequal'
import { Argv } from 'yargs'

type NetworkOptions = {
  providers: Array<MaybeTaggedUrl>
  epochSubgraphs: Array<MaybeTaggedUrl>
  networkSubgraphEndpoints: Array<MaybeTaggedUrl> | undefined
  networkSubgraphDeployments: Array<MaybeTaggedIpfsHash> | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentOptions = { [key: string]: any } & Argv['argv']

export function validateNetworkOptions(argv: AgentOptions) {
  const [networkOptions, helpText] = parseNetworkOptions(argv)
  checkMixedIdentifiers(networkOptions, helpText)
  checkDuplicatedNetworkIdentifiers(networkOptions, helpText)
  reassignParsedValues(argv, networkOptions)
}

function parseNetworkOptions(argv: AgentOptions): [NetworkOptions, string] {
  // Parse each option group, making a special case for the Network Subgraph options that can be
  // partially defined.
  const providers = argv.networkProvider.map(parseTaggedUrl)
  const epochSubgraphs = argv.epochSubgraphEndpoint.map(parseTaggedUrl)
  const networkSubgraphEndpoints =
    argv.networkSubgraphEndpoint?.map(parseTaggedUrl)
  const networkSubgraphDeployments =
    argv.networkSubgraphDeployment?.map(parseTaggedIpfsHash)

  // Check if at least one of those two options is being used
  if (!networkSubgraphEndpoints && !networkSubgraphDeployments) {
    throw new Error(
      'At least one of --network-subgraph-endpoint and --network-subgraph-deployment must be provided',
    )
  }

  // Refine which option lists to check, while formatting a string with the used ones.
  const options = {
    providers,
    epochSubgraphs,
    networkSubgraphEndpoints: undefined,
    networkSubgraphDeployments: undefined,
  }
  let helpText = '[--network-provider, --epoch-subgraph-endpoint'
  if (networkSubgraphEndpoints !== undefined) {
    options.networkSubgraphEndpoints = networkSubgraphEndpoints
    helpText += ', --network-subgraph-endpoint'
  }
  if (networkSubgraphDeployments !== undefined) {
    options.networkSubgraphDeployments = networkSubgraphDeployments
    helpText += ', --network-subgraph-deployment'
  }
  helpText += ']'

  return [options, helpText]
}

interface MaybeTagged {
  networkId: string | null
}

// Extracs an array of arrays from the NetworkOptions type
function getOptionGroups(options: NetworkOptions): Array<Array<MaybeTagged>> {
  function getTag(x: MaybeTagged): MaybeTagged {
    return { networkId: x.networkId }
  }

  const optionGroups: Array<Array<MaybeTagged>> = [
    options.providers,
    options.epochSubgraphs,
  ]
  if (options.networkSubgraphEndpoints) {
    optionGroups.push(options.networkSubgraphEndpoints)
  }
  if (options.networkSubgraphDeployments) {
    optionGroups.push(options.networkSubgraphDeployments)
  }
  return optionGroups.map(sublist => sublist.map(getTag))
}

// Check for consistent network identification
function checkMixedIdentifiers(options: NetworkOptions, usedOptions: string) {
  const optionGroups = getOptionGroups(options)
  const setList = optionGroups.map(subList => new Set(subList))
  const [firstSet, ...otherSets] = setList
  for (const set of otherSets) {
    if (!isEqual(set, firstSet)) {
      throw new Error(
        `Indexer-Agent was configured with mixed network identifiers for these options: ${usedOptions}. ` +
          'Ensure that every network identifier is evenly used among options.',
      )
    }
  }
}

// Check for duplicated network identification
function checkDuplicatedNetworkIdentifiers(
  options: NetworkOptions,
  usedOptions: string,
) {
  const optionGroups = getOptionGroups(options)
  for (const optionGroup of optionGroups) {
    const usedNetworks = countBy(optionGroup, option => option.networkId)
    const maxUsed = Math.max(...Object.values(usedNetworks))
    if (maxUsed > 1) {
      throw new Error(
        `Indexer-Agent was configured with duplicate network identifiers for these options: ${usedOptions}. ` +
          'Ensure that each network identifier is used at most once.',
      )
    }
  }
}

function reassignParsedValues(argv: AgentOptions, options: NetworkOptions) {
  argv.networkProvider = options.providers
  argv.epochSubgraphEndpoint = options.epochSubgraphs
  argv.networkSubgraphEndpoint = options.networkSubgraphEndpoints
  argv.networkSubgraphDeployment = options.networkSubgraphDeployments
}
