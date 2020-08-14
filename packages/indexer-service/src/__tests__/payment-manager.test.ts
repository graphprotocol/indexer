// TODO: (Liam) Provide instructions for setting up test to use local PostgreSQL
//              This must run _before_ any server-wallet code gets imported
// ❯ cd node_modules/@statechannels/server-wallet
// ❯ SERVER_DB_NAME=indexer-sw NODE_ENV=development yarn db:migrate
//
process.env.SERVER_DB_NAME = 'indexer-sw'

import { Wallet } from 'ethers'

import {
  createLogger,
  createMetrics,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { signState, SignedState, calculateChannelId } from '@statechannels/wallet-core'

// This is a bit awkward, but is convenient to create reproducible tests
import serverWalletKnex from '@statechannels/server-wallet/lib/src/db/connection'
import { seedAlicesSigningWallet } from '@statechannels/server-wallet/lib/src/db/seeds/1_signing_wallet_seeds'

import { PaymentManager } from '../payment-manager'
import { AllocationPaymentClient } from '../types'
import {
  testAllocation,
  mockCreatedChannelMessage,
  mockQuery,
  mockCloseChannelMessage,
} from './payment-manager-mocks'

const logger = createLogger({ name: 'server.test.ts' })

describe('PaymentManager', () => {
  let paymentManager: PaymentManager

  beforeAll(async () => {
    logger.info(`Truncating ${process.env.SERVER_DB_NAME}; Seeding new SigningWallet`)
    await seedAlicesSigningWallet(serverWalletKnex)

    paymentManager = new PaymentManager({
      wallet: Wallet.createRandom(),
      logger: logger.child({ component: 'PaymentManager' }),
      metrics: createMetrics(),
    })
  })

  afterAll(async () => {
    await serverWalletKnex.destroy()
  })

  it('is defined', async () => {
    expect(paymentManager).toBeDefined()
  })

  it('can create an allocation client', () => {
    paymentManager.createAllocationPaymentClients([testAllocation()])
    const client = paymentManager.getAllocationPaymentClient('abc')
    expect(client).toBeDefined()
    expect(client!.allocation).toBe(testAllocation())
  })

  describe('AllocationClient', () => {
    let allocationClient: AllocationPaymentClient

    beforeAll(() => {
      allocationClient = paymentManager.getAllocationPaymentClient('abc')!
    })

    it('can call joinChannel and auto-sign funding state', async () => {
      const outbound = await allocationClient.handleMessage(mockCreatedChannelMessage())

      const {
        data: {
          signedStates: [outboundOne, outboundTwo],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(outboundOne).toMatchObject({ turnNum: 0 })
      expect(outboundTwo).toMatchObject({ turnNum: 3 })
    })

    it('can validate a payment', async () => {
      await expect(allocationClient.validatePayment(mockQuery())).resolves.not.toThrow()
    })

    it.skip('can deny a query', async () => {
      const outbound = await allocationClient.declineQuery('', mockQuery())

      const {
        data: {
          signedStates: [nextState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(nextState).toMatchObject({ turnNum: 5 })
    })

    // it can accept a payment

    it('can accept a channel closure', async () => {
      const outbound = await allocationClient.handleMessage(mockCloseChannelMessage())

      const {
        data: {
          signedStates: [outboundState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(outboundState).toMatchObject({ turnNum: 5, status: 'closed' })
    })
  })
})
