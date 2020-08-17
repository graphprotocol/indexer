// TODO: (Liam) Provide instructions for setting up test to use local PostgreSQL
//              This must run _before_ any server-wallet code gets imported
// ❯ cd node_modules/@statechannels/server-wallet
// ❯ SERVER_DB_NAME=indexer-sw NODE_ENV=development yarn db:migrate
//
process.env.SERVER_DB_NAME = 'indexer-sw'

import { Wallet, constants } from 'ethers'

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
  mockAllocation,
  mockCreatedChannelMessage,
  mockQuery,
  mockCloseChannelMessage,
  mockAttestation,
  mockChannelId,
  mockAppData,
  mockPostFundMessage,
} from './payment-manager-mocks'
import { toJS, StateType } from '@statechannels/graph'

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

  afterEach(async () => {
    await serverWalletKnex('channels').truncate()
  })

  it('is defined', async () => {
    expect(paymentManager).toBeDefined()
  })

  it('can create an allocation client', () => {
    const testAlloc = mockAllocation()
    paymentManager.createAllocationPaymentClients([testAlloc])
    const client = paymentManager.getAllocationPaymentClient('abc')
    expect(client).toBeDefined()
    expect(client!.allocation).toBe(testAlloc)
  })

  describe('AllocationClient', () => {
    let allocationClient: AllocationPaymentClient

    beforeAll(() => {
      const testAlloc = mockAllocation()
      paymentManager.createAllocationPaymentClients([testAlloc])
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

    it('can provide attestation response', async () => {
      await allocationClient.handleMessage(mockCreatedChannelMessage())
      await allocationClient.validatePayment(mockQuery())

      const attestationMessage = await allocationClient.provideAttestation(
        mockChannelId,
        mockQuery(),
        mockAttestation(),
      )
      const {
        data: {
          signedStates: [nextState],
        },
      } = attestationMessage as { data: { signedStates: SignedState[] } }
      const appData = toJS(nextState.appData)

      expect(appData.constants).toEqual(mockAppData().constants)
      expect(appData.variable.responseCID).toEqual(mockAttestation().responseCID)
      expect(appData.variable.stateType).toEqual(StateType.AttestationProvided)
      expect((nextState.outcome as SimpleAllocation).allocationItems).toEqual([
        { amount: BN.from(99), destination: makeDestination(constants.AddressZero) },
        { amount: BN.from(1), destination: makeDestination(constants.AddressZero) },
      ])
    })

    it('can deny a query', async () => {
      await allocationClient.handleMessage(mockCreatedChannelMessage())
      await allocationClient.validatePayment(mockQuery())
      const outbound = await allocationClient.declineQuery(mockChannelId, mockQuery())

      const {
        data: {
          signedStates: [nextState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      const appData = toJS(nextState.appData)
      expect(appData.constants).toEqual(mockAppData().constants)
      expect(appData.variable.stateType).toEqual(StateType.QueryDeclined)

      expect(nextState).toMatchObject({ turnNum: 5 })
    })

    it('can accept a channel closure', async () => {
      await allocationClient.handleMessage(mockCreatedChannelMessage())
      await allocationClient.handleMessage(mockPostFundMessage())
      const outbound = await allocationClient.handleMessage(mockCloseChannelMessage())

      const {
        data: {
          signedStates: [outboundState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(outboundState).toMatchObject({ turnNum: 4, isFinal: true })
    })
  })
})
