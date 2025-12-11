import { Network, validateNetworkIdentifier } from '@graphprotocol/indexer-common'
import { IndexerManagementResolverContext } from '../client'

/**
 * Gets the protocol network identifier from the context's single network.
 * Falls back to provided value if given (for backwards compatibility during migration).
 */
export function getProtocolNetwork(
  context: IndexerManagementResolverContext,
  providedNetwork?: string | null,
): string {
  // If provided, validate and use it (backwards compatibility)
  if (providedNetwork) {
    return validateNetworkIdentifier(providedNetwork)
  }

  // Otherwise, get from the single configured network
  if (!context.network) {
    throw new Error(
      'No network configured. Either provide protocolNetwork argument or configure a network.',
    )
  }
  return context.network.specification.networkIdentifier
}

/**
 * Gets the Network object from context, optionally validating a provided network identifier.
 */
export function getNetwork(
  context: IndexerManagementResolverContext,
  providedNetwork?: string | null,
): Network {
  if (!context.network) {
    throw new Error(
      'No network configured. Either provide protocolNetwork argument or configure a network.',
    )
  }

  // If a network was provided, validate it matches the configured one
  if (providedNetwork) {
    const validated = validateNetworkIdentifier(providedNetwork)
    if (validated !== context.network.specification.networkIdentifier) {
      throw new Error(
        `Provided network '${validated}' does not match configured network '${context.network.specification.networkIdentifier}'`,
      )
    }
  }

  return context.network
}
