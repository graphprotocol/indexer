/** To run the unit tests:
 *  1. Install and run postgres.
 *  2. Run 'createdb receipt-manager'
 */
process.env.SERVER_DB_NAME = 'receipt-manager'

import { constants } from 'ethers'

import { createLogger } from '@graphprotocol/common-ts'
import {
  SignedState,
  makeDestination,
  SimpleAllocation,
  BN,
} from '@statechannels/wallet-core'

import { Message as WireMessage } from '@statechannels/client-api-schema'

import { seedAlicesSigningWallet } from '@statechannels/server-wallet/lib/src/db/seeds/1_signing_wallet_seeds'
import knex from '@statechannels/server-wallet/lib/src/db/connection'
import { WalletKnex } from '@statechannels/server-wallet'

import { ReceiptManager, PayerMessage } from '../receipt-manager'
import {
  mockCreatedChannelMessage,
  mockCreatedZeroChannelMessage,
  mockQueryRequestMessage,
  mockSCAttestation,
  mockAppData,
  mockPostFundMessage,
  mockCloseChannelMessage,
} from '../__mocks__/receipt-manager.mocks'
import { toJS, StateType } from '@graphprotocol/statechannels'

const logger = createLogger({ name: 'receipt-manager.test.ts' })

let receiptManager: ReceiptManager

function stateFromMessage(message: WireMessage | undefined, index = 0): SignedState {
  expect(message).toBeDefined()
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return (message as PayerMessage).data.signedStates![index]
}

beforeAll(async () => {
  await WalletKnex.migrate.rollback()
  await WalletKnex.migrate.latest()
})

beforeEach(async () => {
  logger.info(`Truncating ${process.env.SERVER_DB_NAME}; Seeding new SigningWallet`)
  await seedAlicesSigningWallet(WalletKnex)
  receiptManager = new ReceiptManager(logger, '')
})

afterAll(async () => {
  await WalletKnex.destroy()
  await knex.destroy()
})

describe('ReceiptManager', () => {
  it('can call joinChannel and auto-sign funding state with non-zero allocations channel', async () => {
    const outbound = await receiptManager.inputStateChannelMessage(
      mockCreatedChannelMessage(),
    )

    const state1 = stateFromMessage(outbound)
    const state2 = stateFromMessage(outbound, 1)
    expect(state1).toMatchObject({ turnNum: 0 })
    expect(state2).toMatchObject({ turnNum: 3 })
  })

  it('can call joinChannel and auto-sign funding state with zero allocations channel', async () => {
    const outbound = await receiptManager.inputStateChannelMessage(
      mockCreatedZeroChannelMessage(),
    )

    const state1 = stateFromMessage(outbound)
    const state2 = stateFromMessage(outbound, 1)
    expect(state1).toMatchObject({ turnNum: 0 })
    expect(state2).toMatchObject({ turnNum: 3 })
  })

  it('can validate a payment', async () => {
    await receiptManager.inputStateChannelMessage(mockCreatedZeroChannelMessage())
    await expect(
      receiptManager.inputStateChannelMessage(mockQueryRequestMessage()),
    ).resolves.not.toThrow()
  })

  it('can provide attestation response', async () => {
    await receiptManager.inputStateChannelMessage(mockCreatedChannelMessage())
    await receiptManager.inputStateChannelMessage(mockQueryRequestMessage())

    const attestationMessage = await receiptManager.provideAttestation(
      mockQueryRequestMessage(),
      mockSCAttestation(),
    )

    const nextState = stateFromMessage(attestationMessage)
    const appData = toJS(nextState.appData)
    expect(appData.constants).toEqual(mockAppData().constants)
    expect(appData.variable.responseCID).toEqual(mockSCAttestation().responseCID)
    expect(appData.variable.stateType).toEqual(StateType.AttestationProvided)
    expect((nextState.outcome as SimpleAllocation).allocationItems).toEqual([
      { amount: BN.from(99), destination: makeDestination(constants.AddressZero) },
      { amount: BN.from(1), destination: makeDestination(constants.AddressZero) },
    ])
  })

  it('can deny a query', async () => {
    await receiptManager.inputStateChannelMessage(mockCreatedChannelMessage())
    await receiptManager.inputStateChannelMessage(mockQueryRequestMessage())
    const outbound = await receiptManager.declineQuery(mockQueryRequestMessage())

    const nextState = stateFromMessage(outbound)
    const appData = toJS(nextState.appData)
    expect(appData.constants).toEqual(mockAppData().constants)
    expect(appData.variable.stateType).toEqual(StateType.QueryDeclined)
    expect(nextState).toMatchObject({ turnNum: 5 })
  })

  it('can accept a channel closure', async () => {
    await receiptManager.inputStateChannelMessage(mockCreatedChannelMessage())
    await receiptManager.inputStateChannelMessage(mockPostFundMessage())
    const outbound = await receiptManager.inputStateChannelMessage(
      mockCloseChannelMessage(),
    )

    const nextState = stateFromMessage(outbound)
    expect(nextState).toMatchObject({ turnNum: 4, isFinal: true })
  })
})
