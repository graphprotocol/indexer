import {
  Message as WireMessage,
  GetStateResponse,
  ChannelResult,
} from '@statechannels/client-api-schema'
import { Wallet, Outgoing } from '@statechannels/server-wallet'
import {
  Message as WalletMessage,
  BN,
  SignedState,
  calculateChannelId,
  ChannelConstants,
} from '@statechannels/wallet-core'
import { Logger } from '@graphprotocol/common-ts'
import {
  Attestation as SCAttestation,
  StateType,
  computeNextState,
  toJS,
} from '@statechannels/graph'
import _ from 'lodash'

interface ReceiptManagerInterface {
  inputStateChannelMessage(message: WireMessage): Promise<WireMessage[]>
  getChannelIdIfExists(message: WireMessage): Promise<string | undefined>
  provideAttestation(requestCID: string, attestation: SCAttestation): Promise<RMResponse>
  declineQuery(requestCID: string): Promise<RMResponse>
}

class RMError extends Error {
  constructor(errorMessage: string) {
    super(`ReceiptManager: ${errorMessage}`)
  }
}

type RMResponse = Promise<WireMessage>
export type PayerMessage = WireMessage & { data: WalletMessage }

function mergeOutgoing(outgoing1: Outgoing, outgoing2: Outgoing): WireMessage[] {
  if (outgoing1.method !== 'MessageQueued' || outgoing2.method !== 'MessageQueued') {
    throw new RMError('Expected MessageQueued notifications')
  }

  const message1 = outgoing1.params as WireMessage
  const message2 = outgoing2.params as WireMessage

  if (message1.recipient !== message2.recipient || message1.sender !== message2.sender) {
    throw new RMError('Receipient and sender of messages must match')
  }

  return [message1, message2]
}

export class ReceiptManager implements ReceiptManagerInterface {
  constructor(
    private logger: Logger,
    public privateKey: string,
    private wallet = new Wallet(),
    private cachedState: Record<string, GetStateResponse['result']> = {},
    private requestToChannelId: Record<string, string> = {},
  ) {}

  async getChannelIdIfExists(message: WireMessage): Promise<string | undefined> {
    const firstState = (message.data as SignedState[])[0]
    const channelConstants: ChannelConstants = {
      ...firstState,
    }

    const channelId = calculateChannelId(channelConstants)
    return (await this.getChannelResult(calculateChannelId(channelConstants)))
      ? channelId
      : undefined
  }

  async inputStateChannelMessage(message: PayerMessage): Promise<WireMessage[]> {
    const {
      channelResults: [channelResult],
      outbox: pushMessageOutbox,
    } = await this.wallet.pushMessage(message.data)

    if (!channelResult)
      throw new RMError(
        'Received new state, but the wallet did not create a follow up state',
      )

    this.cachedState[channelResult.channelId] = channelResult

    /**
     * Initial request to create a channelResult is received. In this case, join
     * the channel.
     */
    if (channelResult.status === 'proposed') {
      if (pushMessageOutbox.length !== 0) {
        throw new RMError('expected outbox to not contain messages')
      }
      const { outbox } = await this.wallet.joinChannel(channelResult)
      if (outbox.length !== 1 && outbox.length !== 2) {
        throw new RMError('Expected one or two outbox items after joining channel')
      }

      // This assumes a single state channel allocation per channel
      const totalInChannel = channelResult.allocations[0].allocationItems
        .map(a => a.amount)
        .reduce(BN.add, BN.from(0))

      if (BN.eq(totalInChannel, 0) && outbox.length !== 2) {
        throw new RMError(
          'Expected two outbox items after joining a channel with zero allocations',
        )
      }

      this.logger.info(`Channel creation succeeded`, {
        sender: message.sender,
        channelid: channelResult.channelId,
      })

      // This is the countersignature on turn 0 state.
      // Aka prefund2 state
      const [prefund2Outgoing] = outbox
      const postFund2Outgoing = BN.eq(totalInChannel, 0)
        ? outbox[1]
        : (
            await this.wallet.updateChannelFunding({
              channelId: channelResult.channelId,
              token: channelResult.allocations[0].token,
              amount: totalInChannel,
            })
          ).outbox[0]

      return mergeOutgoing(prefund2Outgoing, postFund2Outgoing)
    }
    /**
     * This is one of two scenarios:
     *  - The counterparty sent a postFund state.
     *  - The counterparty sent a query state.
     * In both case, we do not expect the wallet to create a new state as a response.
     */
    if (channelResult.status === 'running') {
      if (pushMessageOutbox.length !== 0) {
        throw new RMError('Unexpected outbox items when wallet is in the running stage')
      }
      this.requestToChannelId = {
        ...this.requestToChannelId,
        [toJS(channelResult.appData).variable.requestCID]: channelResult.channelId,
      }
      return []
    }

    if (channelResult.status === 'closed') {
      if (pushMessageOutbox.length !== 1) {
        throw new RMError('Expected the wallet to counter sign the closing state')
      }
      this.logger.info('Closed channel', {
        channelId: channelResult.channelId,
      })
      const [{ params: outboundClosedChannelState }] = pushMessageOutbox
      return [outboundClosedChannelState as WireMessage]
    }

    throw new RMError('Unexpectedly reached the end of inputStateChannelMessage')
  }

  async provideAttestation(
    requestCID: string,
    attestation: SCAttestation,
  ): Promise<RMResponse> {
    const channelId = this.requestToChannelId[requestCID]
    const responseMessage = await this.nextState(
      StateType.AttestationProvided,
      channelId,
      attestation,
    )
    this.requestToChannelId = _.omit(this.getChannelResult, requestCID)
    return responseMessage
  }

  async declineQuery(requestCID: string): Promise<RMResponse> {
    const channelId = this.requestToChannelId[requestCID]
    const responseMessage = this.nextState(StateType.QueryDeclined, channelId)
    this.requestToChannelId = _.omit(this.getChannelResult, requestCID)
    return responseMessage
  }

  private async nextState(
    stateType: StateType,
    channelId: string,
    attestation: SCAttestation | null = null,
  ): Promise<WireMessage> {
    const { appData: appData, allocations } = await this.getChannelResult(channelId)

    const inputAttestation: SCAttestation = attestation ?? {
      responseCID: '',
      signature: '',
    }

    const nextState = computeNextState(appData, allocations, {
      toStateType: stateType,
      // todo: currently unused and should be removed
      query: { requestCID: '' },
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

  private async getChannelResult(channelId: string): Promise<ChannelResult> {
    const channelResult = await this.getChannelState(channelId)
    if (!channelResult) throw new RMError(`No channel result for channelId ${channelId}.`)
    return channelResult
  }

  private async getChannelState(channelId: string): Promise<GetStateResponse['result']> {
    if (!this.cachedState[channelId]) {
      const { channelResult } = await this.wallet.getState({ channelId })
      this.cachedState[channelId] = channelResult
    }
    return this.cachedState[channelId]
  }
}
