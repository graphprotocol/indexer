import { extractNetwork } from 'indexer-common/src/indexer-management/resolvers/utils'
import geohash from 'ngeohash'
import type { QueryResolvers } from './../../../types.generated'

export const indexerRegistration: NonNullable<
  QueryResolvers['indexerRegistration']
> = async (
  _parent,
  { protocolNetwork: unvalidatedProtocolNetwork },
  { multiNetworks },
) => {
  if (!multiNetworks) {
    throw Error(
      'IndexerManagementClient must be in `network` mode to fetch indexer registration information',
    )
  }

  const network = extractNetwork(unvalidatedProtocolNetwork, multiNetworks)
  const protocolNetwork = network.specification.networkIdentifier
  const address = network.specification.indexerOptions.address
  const contracts = network.contracts
  const registered = await contracts.serviceRegistry.isRegistered(address)

  if (registered) {
    const service = await contracts.serviceRegistry.services(address)
    const location = geohash.decode(service.geohash)
    return {
      address,
      protocolNetwork,
      url: service.url,
      location: {
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString(),
      },
      registered,
      __typename: 'IndexerRegistration',
    }
  }

  return {
    address,
    url: null,
    registered,
    protocolNetwork,
    location: null,
    __typename: 'IndexerRegistration',
  }
}
