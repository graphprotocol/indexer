import {
  Message as WireMessage,
  GetStateResponse,
  ChannelResult,
} from '@statechannels/client-api-schema'
import { Wallet } from '@statechannels/server-wallet'
import { Message as PushMessage, BN } from '@statechannels/wallet-core'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  Attestation as SCAttestation,
  StateType,
  computeNextState,
} from '@statechannels/graph'
import { PaidQuery } from './types'
import { utils } from 'ethers'
import base58 from 'bs58'

// remove these mocks
const mockSubgraphId = (): SubgraphDeploymentID =>
  new SubgraphDeploymentID(
    base58.encode([
      0x12,
      0x20,
      ...utils.arrayify(utils.sha256(Buffer.from('network-subgraph-indexer-1'))),
    ]),
  )

const mockQuery = (): PaidQuery => ({
  stateChannelMessage: { recipient: '', sender: '', data: null },
  subgraphDeploymentID: mockSubgraphId(),
  query: '',
  allocationID: 'abc',
  requestCID: '',
})

interface iReceiptManager {
  inputStateChannelMessage(message: WireMessage): Promise<RMResponse>

  // provideAttestation(channelId: string, attestation: SCAttestation): Promise<RMResponse>
  // declineQuery(channelId: string): Promise<RMResponse>
}

type RMResponse = Promise<WireMessage | SCError | undefined>

type SCError = Error

export class ReceiptManager implements iReceiptManager {
  constructor(
    private logger: Logger,
    private wallet = new Wallet(),
    private cachedState: Record<string, GetStateResponse['result']> = {},
  ) {}

  async inputStateChannelMessage(message: WireMessage): Promise<RMResponse> {
    const {
      channelResults: [channelResult],
      outbox,
    } = await this.wallet.pushMessage(message.data as PushMessage)

    if (!channelResult) throw Error('Received a new state that did nothing')

    this.cachedState[channelResult.channelId] = channelResult

    /**
     * Initial request to create a channelResult is received. In this case, join
     * the channel and — we assume it is unfunded here — auto-advance to
     * the running stage. Two outbound messages (turnNum 0 and 3) to be sent.
     */
    if (channelResult.status === 'proposed' && outbox.length === 0) {
      const { outbox } = await this.wallet.joinChannel(channelResult)
      if (outbox.length !== 1 && outbox.length !== 2) {
        throw new Error('Expected one or two outbox items after joining channel')
      }

      // This is the countersignature on turn 0 state.
      // Aka prefund2 state
      const [{ params: outboundJoinedChannelState }] = outbox

      this.logger.info(`Channel creation succeeded`, {
        sender: message.sender,
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
            await this.wallet.updateChannelFunding({
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

  async provideAttestation(
    channelId: string,
    attestation: SCAttestation,
  ): Promise<WireMessage> {
    const query = mockQuery()
    return this.nextState(StateType.AttestationProvided, channelId, query, attestation)
  }

  async declineQuery(channelId: string, query: PaidQuery): Promise<WireMessage> {
    return this.nextState(StateType.QueryDeclined, channelId, query)
  }

  private async nextState(
    stateType: StateType,
    channelId: string,
    query: PaidQuery,
    attestation: SCAttestation | null = null,
  ): Promise<WireMessage> {
    const { appData: appData, allocations } = await this.getChannelResult(channelId)

    const inputAttestation: SCAttestation = attestation ?? {
      responseCID: '',
      signature: '',
    }

    const nextState = computeNextState(appData, allocations, {
      toStateType: stateType,
      query,
      attestation: inputAttestation,
    })

    const {
      channelResult,
      outbox: [{ params: outboundMsg }],
    } = await this.wallet.updateChannel({
      channelId,
      appData: nextState.appData,
      allocations: nextState.allocation,
    })

    this.cachedState[channelId] = channelResult

    return outboundMsg as WireMessage
  }

  private async getChannelState(channelId: string): Promise<GetStateResponse['result']> {
    if (!this.cachedState[channelId]) {
      const { channelResult } = await this.wallet.getState({ channelId })
      this.cachedState[channelId] = channelResult
    }
    return this.cachedState[channelId]
  }

  private async getChannelResult(channelId: string): Promise<ChannelResult> {
    const channelResult = await this.getChannelState(channelId)
    if (!channelResult) throw new Error(`No channel result for channelId ${channelId}.`)
    return channelResult
  }
}
