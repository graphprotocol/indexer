// TODO: (Liam) Provide instructions for setting up test to use local PostgreSQL
//              This must run _before_ any server-wallet code gets imported
// ❯ cd node_modules/@statechannels/server-wallet
// ❯ SERVER_DB_NAME=indexer-sw NODE_ENV=development yarn db:migrate
//
process.env.SERVER_DB_NAME = 'indexer-sw'

import { Wallet, constants } from 'ethers'

import { createLogger, createMetrics } from '@graphprotocol/common-ts'
import {
  SignedState,
  makeDestination,
  SimpleAllocation,
  BN,
} from '@statechannels/wallet-core'

// This is a bit awkward, but is convenient to create reproducible tests
import serverWalletKnex from '@statechannels/server-wallet/lib/src/db/connection'
import { seedAlicesSigningWallet } from '@statechannels/server-wallet/lib/src/db/seeds/1_signing_wallet_seeds'

import { ReceiptManager } from '../receipt-manager'
import { AllocationPaymentClient } from '../types'
import {
  mockCreatedChannelMessage,
  mockCreatedZeroChannelMessage,
  mockQuery,
  mockQueryRequestMessage,
} from './receipt-manager.mocks'
import { toJS, StateType } from '@statechannels/graph'

const logger = createLogger({ name: 'receipt-manager.test.ts' })

let receiptManager: ReceiptManager

beforeEach(async () => {
  logger.info(`Truncating ${process.env.SERVER_DB_NAME}; Seeding new SigningWallet`)
  await seedAlicesSigningWallet(serverWalletKnex)
  receiptManager = new ReceiptManager(logger)
})

afterAll(async () => {
  await serverWalletKnex.destroy()
})

describe('ReceiptManager', () => {
  it('can call joinChannel and auto-sign funding state with non-zero allocations channel', async () => {
    const outbound = await receiptManager.inputStateChannelMessage(
      mockCreatedChannelMessage(),
    )

    const {
      data: {
        signedStates: [outboundOne, outboundTwo],
      },
    } = outbound as { data: { signedStates: SignedState[] } }

    expect(outboundOne).toMatchObject({ turnNum: 0 })
    expect(outboundTwo).toMatchObject({ turnNum: 3 })
  })

  it('can call joinChannel and auto-sign funding state with zero allocations channel', async () => {
    const outbound = await receiptManager.inputStateChannelMessage(
      mockCreatedZeroChannelMessage(),
    )

    const {
      data: {
        signedStates: [outboundOne, outboundTwo],
      },
    } = outbound as { data: { signedStates: SignedState[] } }

    expect(outboundOne).toMatchObject({ turnNum: 0 })
    expect(outboundTwo).toMatchObject({ turnNum: 3 })
  })

  it('can validate a payment', async () => {
    await receiptManager.inputStateChannelMessage(mockCreatedZeroChannelMessage())
    await expect(
      receiptManager.inputStateChannelMessage(mockQueryRequestMessage()),
    ).resolves.not.toThrow()
  })
})
