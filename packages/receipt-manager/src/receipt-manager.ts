import * as path from 'path'
import knex from '@statechannels/server-wallet/lib/src/db/connection'
import { Message as WireMessage } from '@statechannels/client-api-schema'
import { Wallet, Outgoing } from '@statechannels/server-wallet'
import { Message as WalletMessage, BN } from '@statechannels/wallet-core'
import { Logger } from '@graphprotocol/common-ts'
import {
  Attestation as SCAttestation,
  StateType,
  computeNextState,
} from '@graphprotocol/statechannels'
import _ from 'lodash'

interface ReceiptManagerInterface {
  migrateWalletDB(): Promise<void>
  inputStateChannelMessage(message: WireMessage): Promise<WireMessage | undefined>
  provideAttestation(
    message: PayerMessage,
    attestation: SCAttestation,
  ): Promise<RMResponse>
  declineQuery(message: PayerMessage): Promise<RMResponse>
}

class RMError extends Error {
  constructor(errorMessage: string) {
    super(`ReceiptManager: ${errorMessage}`)
  }
}

type RMResponse = Promise<WireMessage>
export type PayerMessage = WireMessage & { data: WalletMessage }

function mergeOutgoing(outgoing1: Outgoing, outgoing2: Outgoing): PayerMessage {
  if (outgoing1.method !== 'MessageQueued' || outgoing2.method !== 'MessageQueued') {
    throw new RMError('Expected MessageQueued notifications')
  }

  const message1 = outgoing1.params as PayerMessage
  const message2 = outgoing2.params as PayerMessage

  if (message1.recipient !== message2.recipient || message1.sender !== message2.sender) {
    throw new RMError('Receipient and sender of messages must match')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function customizer(objValue: any, srcValue: any) {
    if (_.isArray(objValue)) {
      return objValue.concat(srcValue)
    }
  }
  return _.mergeWith(message1, message2, customizer)
}
export class ReceiptManager implements ReceiptManagerInterface {
  constructor(
    private logger: Logger,
    public privateKey: string,
    private wallet = new Wallet(),
  ) {}

  async migrateWalletDB(): Promise<void> {
    this.logger.info('Migrate server-wallet database')
    await knex.migrate.latest({
      loadExtensions: ['.js'],
      directory: path.resolve(
        require.resolve('@statechannels/server-wallet'),
        '..',
        'db',
        'migrations',
      ),
    })
    this.logger.info('Successfully migrated server-wallet database')
  }

  async inputStateChannelMessage(
    message: PayerMessage,
  ): Promise<WireMessage | undefined> {
    const {
      channelResults: [channelResult],
      outbox: pushMessageOutbox,
    } = await this.wallet.pushMessage(message.data)

    if (!channelResult)
      throw new RMError(
        'Received new state, but the wallet did not create a follow up state',
      )

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
      return
    }

    if (channelResult.status === 'closed') {
      if (pushMessageOutbox.length !== 1) {
        throw new RMError('Expected the wallet to counter sign the closing state')
      }
      this.logger.info('Closed channel', {
        channelId: channelResult.channelId,
      })
      const [{ params: outboundClosedChannelState }] = pushMessageOutbox
      return outboundClosedChannelState as WireMessage
    }

    throw new RMError('Unexpectedly reached the end of inputStateChannelMessage')
  }

  async provideAttestation(
    message: PayerMessage,
    attestation: SCAttestation,
  ): Promise<RMResponse> {
    return await this.nextState(StateType.AttestationProvided, message, attestation)
  }

  async declineQuery(message: PayerMessage): Promise<RMResponse> {
    return this.nextState(StateType.QueryDeclined, message)
  }

  private async nextState(
    stateType: StateType,
    message: PayerMessage,
    attestation: SCAttestation | null = null,
  ): Promise<WireMessage> {
    const {
      channelResults: [channelResult],
      outbox: pushMessageOutbox,
    } = await this.wallet.pushMessage(message.data)
    if (pushMessageOutbox.length) {
      throw new RMError('Did not expect any outbox items')
    }

    const { appData: appData, allocations } = channelResult

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
      outbox: [{ params: outboundMsg }],
    } = await this.wallet.updateChannel({
      channelId: channelResult.channelId,
      appData: nextState.appData,
      allocations: nextState.allocation,
    })

    return outboundMsg as WireMessage
  }
}
