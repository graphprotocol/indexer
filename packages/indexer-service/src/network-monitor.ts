import gql from 'graphql-tag'
import { Evt } from 'evt'
import {
  Logger,
  createNetworkSubgraphClient,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { delay } from '@connext/utils'
import { Wallet } from 'ethers'
import { ChannelInfo } from './types'

export interface ChannelsUpdatedEvent {
  added: ChannelInfo[]
  removed: ChannelInfo[]
  unchanged: ChannelInfo[]
}

const channelInList = (channels: ChannelInfo[], needle: ChannelInfo): boolean =>
  channels.find(channel => channel.id === needle.id) !== undefined

export interface NetworkMonitorOptions {
  logger: Logger
  wallet: Wallet
  graphNode: string
  networkSubgraphDeployment: SubgraphDeploymentID
}

export class NetworkMonitor {
  channelsUpdated: Evt<ChannelsUpdatedEvent>
  channels: ChannelInfo[]

  constructor(options: NetworkMonitorOptions) {
    this.channelsUpdated = Evt.create<ChannelsUpdatedEvent>()
    this.channels = []
    this.periodicallySyncChannels(options)
  }

  async periodicallySyncChannels({
    logger,
    wallet,
    networkSubgraphDeployment,
    graphNode,
  }: NetworkMonitorOptions): Promise<never> {
    const url = new URL(`/subgraphs/id/${networkSubgraphDeployment.ipfsHash}`, graphNode)
    const client = await createNetworkSubgraphClient({
      url: url.toString(),
    })

    const indexerAddress = wallet.address.toLowerCase()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Query graph-node for indexing subgraph versions
        const result = await client
          .query(
            gql`
              query indexedSubgraphs($id: ID!) {
                indexer(id: $id) {
                  channels {
                    id
                    publicKey
                    subgraphDeployment {
                      id
                    }
                    createdAtEpoch
                  }
                }
              }
            `,
            { id: indexerAddress },
          )
          .toPromise()

        if (result.error) {
          throw new Error(
            `Failed to query data for indexer '${indexerAddress}': ${result.error}`,
          )
        }

        if (!result.data || !result.data.indexer) {
          throw new Error(`Indexer '${indexerAddress}' has not registered itself yet`)
        }

        // Extract the channels
        const channels: ChannelInfo[] = result.data.indexer.channels.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ({ id, publicKey, subgraphDeployment, createdAtEpoch }: any) => ({
            id,
            publicKey,
            subgraphDeploymentID: new SubgraphDeploymentID(subgraphDeployment.id),
            createdAtEpoch,
          }),
        )

        // Identify channel changes
        const removed = this.channels.filter(channel => !channelInList(channels, channel))
        const added = channels.filter(
          newChannel => !channelInList(this.channels, newChannel),
        )
        const unchanged = this.channels.filter(channel =>
          channelInList(channels, channel),
        )

        // Update channels
        this.channels = channels

        // Emit the update
        if (removed.length > 0 || added.length > 0) {
          this.channelsUpdated.post({ added, removed, unchanged })
        }
      } catch (error) {
        logger.warn(`Failed to query channels`, { error })
      }

      // Wait 5s
      await delay(5000)
    }
  }
}
