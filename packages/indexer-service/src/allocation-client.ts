import { Wallet as ServerWallet } from '@statechannels/server-wallet'
import {
  Message as WireMessage,
  GetStateResponse,
} from '@statechannels/client-api-schema'
import { Message as PushMessage, BN } from '@statechannels/wallet-core'
import { Logger, Attestation } from '@graphprotocol/common-ts'
import {
  StateType,
  computeNextState,
  Attestation as SCAttestation,
} from '@statechannels/graph'
import { ChannelResult } from '@statechannels/client-api-schema'

import { Wallet, utils, constants, BigNumber } from 'ethers'

import {
  AllocationPaymentClient as AllocationPaymentClientInterface,
  Allocation,
  PaidQuery,
} from './types'

interface AllocationPaymentClientOptions {
  allocation: Allocation
  logger: Logger
  wallet: Wallet
  serverWallet: ServerWallet
}

type ChannelID = string
export class AllocationPaymentClient implements AllocationPaymentClientInterface {
  // TODO: Import ChannelResult type
  cachedState: Record<ChannelID, GetStateResponse['result']> = {}
  allocation: Allocation
  wallet: Wallet
  serverWallet: ServerWallet

  private logger: Logger

  constructor({
    allocation,
    logger,
    wallet,
    serverWallet,
  }: AllocationPaymentClientOptions) {
    this.allocation = allocation
    this.wallet = wallet
    this.serverWallet = serverWallet

    this.logger = logger.child({
      component: 'AllocationPaymentClient',
      createdAtEpoch: allocation.createdAtEpoch,
    })
  }

  public async getChannelResult(channelId: string): Promise<ChannelResult> {
    const channelResult = await this.getChannelState(channelId)
    if (!channelResult) throw new Error(`No channel result for channelId ${channelId}.`)
    return channelResult
  }

  async handleMessage({ data, sender }: WireMessage): Promise<WireMessage | undefined> {
    const {
      channelResults: [channelResult],
      outbox,
    } = await this.serverWallet.pushMessage(data as PushMessage)

    if (!channelResult) throw Error('Received a new state that did nothing')

    this.cachedState[channelResult.channelId] = channelResult

    /**
     * Initial request to create a channelResult is received. In this case, join
     * the channel and — we assume it is unfunded here — auto-advance to
     * the running stage. Two outbound messages (turnNum 0 and 3) to be sent.
     */
    if (channelResult.status === 'proposed' && outbox.length === 0) {
      const { outbox } = await this.serverWallet.joinChannel(channelResult)
      if (outbox.length !== 1 && outbox.length !== 2) {
        throw new Error('Expected one or two outbox items after joining channel')
      }

      // This is the countersignature on turn 0 state.
      // Aka prefund2 state
      const [{ params: outboundJoinedChannelState }] = outbox

      this.logger.info(`Channel creation succeeded`, {
        sender,
        channelid: channelResult.channelId,
      })

      // This assumes a single state channel allocation per channel
      const totalInChannel = channelResult.allocations[0].allocationItems
        .map(a => a.amount)
        .reduce(BN.add, BN.from(0))
      const zeroFundPostFund2State =
        outbox.length === 2 && BN.eq(totalInChannel, 0) ? outbox[1].params : undefined

      const fundedPostFund2State = zeroFundPostFund2State
        ? undefined
        : (
            await this.serverWallet.updateChannelFunding({
              channelId: channelResult.channelId,
              token: channelResult.allocations[0].token,
              amount: totalInChannel,
            })
          ).outbox[0].params

      const postFund2State = zeroFundPostFund2State ?? fundedPostFund2State
      if (!postFund2State) {
        throw new Error('Unexpected undefined postFund2State')
      }

      return {
        sender: (outboundJoinedChannelState as WireMessage).sender,
        recipient: (outboundJoinedChannelState as WireMessage).recipient,
        data: {
          signedStates: [
            // eslint-disable-next-line
            ((outboundJoinedChannelState as WireMessage).data as PushMessage)
              .signedStates![0],
            // eslint-disable-next-line
            ((postFund2State as WireMessage).data as PushMessage).signedStates![0],
          ],
        },
      }
    }

    /**
     * This is an expected response from the counterparty upon seeing 0 and 3,
     * they will countersign 3 and send it back. Now, we don't need to reply.
     */
    if (channelResult.status === 'running' && outbox.length === 0) {
      return
    }

    if (channelResult.status === 'closed' && outbox.length === 1) {
      this.logger.info('Closed channel', {
        channelId: channelResult.channelId,
      })
      const [{ params: outboundClosedChannelState }] = outbox
      return outboundClosedChannelState as WireMessage
    }

    throw new Error(
      'Received a message which was neither a new channel request, nor a closure request',
    )
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

    const {
      channelResults: [channelResult],
    } = await this.serverWallet.pushMessage(stateChannelMessage.data as PushMessage)

    this.cachedState[channelResult.channelId] = channelResult

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

    return channelResult.channelId
  }

  async provideAttestation(
    channelId: string,
    query: PaidQuery,
    attestation: Attestation,
  ): Promise<WireMessage> {
    return this.nextState(StateType.AttestationProvided, channelId, query, attestation)
  }

  async declineQuery(channelId: string, query: PaidQuery): Promise<WireMessage> {
    return this.nextState(StateType.QueryDeclined, channelId, query)
  }

  private async nextState(
    stateType: StateType,
    channelId: string,
    query: PaidQuery,
    attestation: Attestation | null = null,
  ): Promise<WireMessage> {
    const { appData: appData, allocations } = await this.getChannelResult(channelId)

    let inputAttestation: SCAttestation = {
      responseCID: '',
      signature: '',
    }
    if (attestation) {
      inputAttestation = {
        responseCID: attestation.responseCID,
        signature: utils.joinSignature(attestation),
      }
    }

    const nextState = computeNextState(appData, allocations, {
      toStateType: stateType,
      query,
      attestation: inputAttestation,
    })

    const {
      channelResult,
      outbox: [{ params: outboundMsg }],
    } = await this.serverWallet.updateChannel({
      channelId,
      appData: nextState.appData,
      allocations: nextState.allocation,
    })

    this.cachedState[channelId] = channelResult

    return outboundMsg as WireMessage
  }

  private async getChannelState(
    channelId: ChannelID,
  ): Promise<GetStateResponse['result']> {
    if (!this.cachedState[channelId]) {
      const { channelResult } = await this.serverWallet.getState({ channelId })
      this.cachedState[channelId] = channelResult
    }
    return this.cachedState[channelId]
  }

  async settle(): Promise<void> {
    // We expect the gateway to close the channel, so here we can do some logic like
    // waiting for 5 minutes for the close channel state to be signed and if we don't see
    // it, then go to chain to forceMove the closure. Otherwise, if we have it
    // then go to chain with a withdrawal transaction to get the money instantly.
  }
}
