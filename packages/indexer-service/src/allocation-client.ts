import { Wallet as ServerWallet } from '@statechannels/server-wallet'
import { Message as WireMessage } from '@statechannels/client-api-schema'
import { Message as PushMessage } from '@statechannels/wallet-core'
import { Logger, Attestation } from '@graphprotocol/common-ts'

import { Wallet } from 'ethers'

import {
  AllocationPaymentClient as AllocationPaymentClientInterface,
  Allocation,
  PaidQuery,
} from './types'

interface AllocationPaymentClientOptions {
  allocation: Allocation
  logger: Logger
  wallet: Wallet
}

export class AllocationPaymentClient implements AllocationPaymentClientInterface {
  channelIds: Record<string, string> = {}
  allocation: Allocation
  wallet: Wallet

  private logger: Logger

  private serverWallet: ServerWallet = new ServerWallet() //TODO: put unique pk in here?

  constructor({ allocation, logger, wallet }: AllocationPaymentClientOptions) {
    this.allocation = allocation
    this.wallet = wallet
    this.logger = logger
  }

  async handleMessage({ data, sender }: WireMessage): Promise<WireMessage | undefined> {
    this.logger.info(`AllocationPaymentClient received message from ${sender}`)

    const {
      channelResults: [channel],
      outbox,
    } = await this.serverWallet.pushMessage(data as PushMessage)

    if (!channel) throw Error('Received a new state that did nothing')

    /**
     * Initial request to create a channel is received. In this case, join
     * the channel and — we assume it is unfunded here — auto-advance to
     * the running stage. Two outbound messages (turnNum 0 and 3) to be sent.
     */
    if (channel.status === 'proposed' && outbox.length === 0) {
      this.channelIds[sender] = channel.channelId

      const {
        outbox: [
          { params: outboundJoinedChannelState },
          { params: outboundFundedChannelState },
        ],
      } = await this.serverWallet.joinChannel(channel)

      const me = await this.serverWallet.getParticipant()

      if (!me) throw new Error('unreachable1')

      return {
        sender: me.participantId,
        recipient: sender,
        data: {
          signedStates: [
            // eslint-disable-next-line
            ((outboundJoinedChannelState as WireMessage).data as PushMessage)
              .signedStates![0],

            // eslint-disable-next-line
            ((outboundFundedChannelState as WireMessage).data as PushMessage)
              .signedStates![0],
          ],
        },
      }
    }

    /**
     * This is an expected response from the counterparty upon seeing 0 and 3,
     * they will countersign 3 and send it back. Now, we don't need to reply.
     */
    if (channel.status === 'closed' && outbox.length === 1) {
      const [{ params: outboundClosedChannelState }] = outbox

      const me = await this.serverWallet.getParticipant()

      if (!me) throw new Error('unreachable2')

      return {
        sender: me.participantId,
        recipient: sender,
        data: {
          signedStates: [
            // eslint-disable-next-line
            ((outboundClosedChannelState as WireMessage).data as PushMessage)
              .signedStates![0],
          ],
        },
      }
    }

    throw new Error('unreachable3')
  }

  // eslint-disable-next-line
  async validatePayment(query: PaidQuery): Promise<string> {
    const { subgraphDeploymentID, stateChannelMessage, requestCID } = query

    //
    // Decode as Message (client-api-schema?)
    //
    //    throw if not valid message
    //    take decoded message
    //

    const out = await this.serverWallet.pushMessage(stateChannelMessage.data)

    // Push decoded message into the wallet
    //
    //    raise exception if wallet raises one
    //    take ChannelUpdated / ChannelResult
    //

    // Verify channel update matches other parameters
    //
    //    auto-decline query
    // throw {
    //   ...Error('Provided state does not align with query, denied by wallet.'),
    //   envelopedResponse: await allocationClient.declineQuery(),
    // }
    //
    // There are two types of failures here:
    //
    // - If the request is just nonsensical, the pushMessage will return an error because
    //   the transition will be invalid. In that case, verifyQuery should return false or
    //   something and then HTTP response should return a 40x or some equivalent "bad query"
    //
    // - If the request is sensical but does not match the signed state. In this case the
    //   query should still return a 40x or 50x but include a QueryDeclined signed state
    //   (see below) -- this is not implemented yet.

    return out.channelResults[0].channelId
  }

  // eslint-disable-next-line
  async provideAttestation(
    channelId: string,
    query: PaidQuery,
    attestation: Attestation,
  ): Promise<WireMessage> {
    const {
      channelResult: { appData, allocations },
    } = await this.serverWallet.getState({ channelId })

    const {
      outbox: [{ params: outboundMsg }],
    } = await this.serverWallet.updateChannel({
      channelId,
      appData,
      allocations,
    })

    return outboundMsg as WireMessage
  }

  async declineQuery(channelId: string, query: PaidQuery): Promise<WireMessage> {
    const {
      channelResult: { appData, allocations },
    } = await this.serverWallet.getState({ channelId })

    const {
      outbox: [{ params: outboundMsg }],
    } = await this.serverWallet.updateChannel({
      channelId,
      appData,
      allocations,
    })

    return outboundMsg as WireMessage
  }

  async settle(): Promise<void> {
    // We expect the gateway to close the channel, so here we can do some logic like
    // waiting for 5 minutes for the close channel state to be signed and if we don't see
    // it, then go to chain to forceMove the closure. Otherwise, if we have it
    // then go to chain with a withdrawal transaction to get the money instantly.
  }
}
