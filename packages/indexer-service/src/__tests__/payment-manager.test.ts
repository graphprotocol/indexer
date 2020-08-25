/* eslint-disable @typescript-eslint/no-non-null-assertion */

process.env.SERVER_DB_NAME = 'indexer-sw'

import * as base58 from 'bs58'
import { Wallet, utils, constants } from 'ethers'

import {
  createLogger,
  createMetrics,
  SubgraphDeploymentID,
} from '@graphprotocol/common-ts'
import { signState, SignedState, calculateChannelId } from '@statechannels/wallet-core'

// This is a bit awkward, but is convenient to create reproducible tests
import serverWalletKnex from '@statechannels/server-wallet/lib/src/db/connection'
import { seedAlicesSigningWallet } from '@statechannels/server-wallet/lib/src/db/seeds/1_signing_wallet_seeds'
import { alice as me } from '@statechannels/server-wallet/lib/src/wallet/__test__/fixtures/signing-wallets'

import { PaymentManager } from '../payment-manager'
import { AllocationPaymentClient } from '../types'
import { State, makeDestination, BN } from '@statechannels/wallet-core'

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

  const TEST_SUBGRAPH_ID = new SubgraphDeploymentID(
    base58.encode([
      0x12,
      0x20,
      ...utils.arrayify(utils.sha256(Buffer.from('network-subgraph-indexer-1'))),
    ]),
  )

  const TEST_ALLOCATION = {
    id: 'abc',
    publicKey: '-- unused --',
    subgraphDeploymentID: TEST_SUBGRAPH_ID,
    createdAtEpoch: 0,
  }

  it('can create an allocation client', () => {
    paymentManager.createAllocationPaymentClients([TEST_ALLOCATION])
    const client = paymentManager.getAllocationPaymentClient('abc')
    expect(client).toBeDefined()
    expect(client!.allocation).toBe(TEST_ALLOCATION)
  })

  describe('AllocationClient', () => {
    let allocationClient: AllocationPaymentClient

    beforeAll(() => {
      allocationClient = paymentManager.getAllocationPaymentClient('abc')!
    })

    const MOCK_GATEWAY = {
      wallet: Wallet.createRandom(),
    }

    const MOCK_FIRST_STATE: State = {
      channelNonce: 0,
      chainId: '0',
      appDefinition: constants.AddressZero,
      appData: '0x',
      participants: [
        {
          participantId: 'gateway',
          destination: makeDestination(MOCK_GATEWAY.wallet.address),
          signingAddress: MOCK_GATEWAY.wallet.address,
        },
        {
          participantId: 'me',
          destination: makeDestination(me().address),
          signingAddress: me().address,
        },
      ],
      turnNum: 0,
      isFinal: false,
      challengeDuration: 0,
      outcome: {
        type: 'SimpleAllocation',
        assetHolderAddress: constants.AddressZero,
        allocationItems: [
          {
            amount: BN.from(0),
            destination: makeDestination(constants.AddressZero),
          },
          { amount: BN.from(0), destination: makeDestination(constants.AddressZero) },
        ],
      },
    }

    const channelId = calculateChannelId(MOCK_FIRST_STATE)

    const MOCK_CREATED_CHANNEL_MESSAGE = {
      sender: 'gateway',
      recipient: 'me',
      data: {
        signedStates: [
          {
            ...MOCK_FIRST_STATE,
            signatures: [
              {
                signer: MOCK_GATEWAY.wallet.address,
                signature: signState(MOCK_FIRST_STATE, MOCK_GATEWAY.wallet.privateKey),
              },
            ],
          },
        ],
      },
    }

    it('can call joinChannel and auto-sign funding state', async () => {
      const outbound = await allocationClient.handleMessage(MOCK_CREATED_CHANNEL_MESSAGE)

      const {
        data: {
          signedStates: [outboundOne, outboundTwo],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(outboundOne).toMatchObject({ turnNum: 0 })
      expect(outboundTwo).toMatchObject({ turnNum: 3 })
    })

    const MOCK_RUNNING_STATE = {
      ...MOCK_FIRST_STATE,
      turnNum: 4,
    }

    const MOCK_QUERY_REQUEST_STATE = {
      sender: 'gateway',
      recipient: 'me',
      data: {
        signedStates: [
          {
            ...MOCK_RUNNING_STATE,
            signatures: [
              {
                signer: MOCK_GATEWAY.wallet.address,
                signature: signState(MOCK_RUNNING_STATE, MOCK_GATEWAY.wallet.privateKey),
              },
            ],
          },
        ],
      },
    }

    const MOCK_QUERY = {
      stateChannelMessage: MOCK_QUERY_REQUEST_STATE,
      subgraphDeploymentID: TEST_SUBGRAPH_ID,
      query: '',
      allocationID: 'abc',
      requestCID: '',
    }

    it('can validate a payment', async () => {
      await expect(allocationClient.validatePayment(MOCK_QUERY)).resolves.not.toThrow()
    })

    it('can deny a query', async () => {
      const outbound = await allocationClient.declineQuery(channelId, MOCK_QUERY)

      const {
        data: {
          signedStates: [nextState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(nextState).toMatchObject({ turnNum: 5 })
    })

    // it can accept a payment

    const MOCK_CLOSING_STATE = {
      ...MOCK_FIRST_STATE,
      turnNum: 6,
      isFinal: true,
    }

    const MOCK_CLOSE_CHANNEL_MESSAGE = {
      sender: 'gateway',
      recipient: 'me',
      data: {
        signedStates: [
          {
            ...MOCK_CLOSING_STATE,
            signatures: [
              {
                signer: MOCK_GATEWAY.wallet.address,
                signature: signState(MOCK_CLOSING_STATE, MOCK_GATEWAY.wallet.privateKey),
              },
            ],
          },
        ],
      },
    }

    it('can accept a channel closure', async () => {
      const outbound = await allocationClient.handleMessage(MOCK_CLOSE_CHANNEL_MESSAGE)

      const {
        data: {
          signedStates: [outboundState],
        },
      } = outbound as { data: { signedStates: SignedState[] } }

      expect(outboundState).toMatchObject({ turnNum: 5, status: 'closed' })
    })
  })
})
