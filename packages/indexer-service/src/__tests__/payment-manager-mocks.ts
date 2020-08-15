import { SubgraphDeploymentID, Attestation } from '@graphprotocol/common-ts'
import base58 from 'bs58'
import { utils, Wallet, constants } from 'ethers'
import { Allocation, PaidQuery } from '../types'
import { State, makeDestination, BN, signState } from '@statechannels/wallet-core'
import { alice as me } from '@statechannels/server-wallet/lib/src/wallet/__test__/fixtures/signing-wallets'
import { Message as WireMessage } from '@statechannels/client-api-schema'
import { getChannelId } from '@statechannels/nitro-protocol'
import { AppData, StateType, fromJS } from '@statechannels/graph'

export const mockSubgraphId = (): SubgraphDeploymentID =>
  new SubgraphDeploymentID(
    base58.encode([
      0x12,
      0x20,
      ...utils.arrayify(utils.sha256(Buffer.from('network-subgraph-indexer-1'))),
    ]),
  )

export const mockAllocation = (): Allocation => ({
  id: 'abc',
  publicKey: '-- unused --',
  subgraphDeploymentID: mockSubgraphId(),
  createdAtEpoch: 0,
})

export const mockAttestation = (): Attestation => ({
  requestCID: constants.HashZero,
  responseCID: constants.HashZero,
  subgraphDeploymentID: constants.HashZero,
  r: constants.HashZero,
  s: constants.HashZero,
  v: 0,
})

const sampleAttestation = mockAttestation()
export const mockAppData = (): AppData => ({
  constants: {
    chainId: 0,
    canonicalIndexerAddress: constants.AddressZero,
    verifyingContract: constants.AddressZero,
    subgraphDeploymentID: constants.HashZero,
  },
  variable: {
    ...sampleAttestation,
    stateType: StateType.QueryRequested,
    paymentAmount: 1,
    signature: '0x',
  },
})

const MOCK_GATEWAY = {
  wallet: Wallet.createRandom(),
}

const mockFirstState = (): State => ({
  channelNonce: 0,
  chainId: '0',
  appDefinition: constants.AddressZero,
  appData: fromJS(mockAppData()),
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
      {
        amount: BN.from(0),
        destination: makeDestination(constants.AddressZero),
      },
    ],
  },
})

const sampleFirstState = mockFirstState()
export const mockChannelId = getChannelId({
  channelNonce: sampleFirstState.channelNonce,
  participants: sampleFirstState.participants.map(
    participant => participant.signingAddress,
  ),
  chainId: sampleFirstState.chainId,
})

export const mockCreatedChannelMessage = (): WireMessage => ({
  sender: 'gateway',
  recipient: 'me',
  data: {
    signedStates: [
      {
        ...mockFirstState(),
        signatures: [
          {
            signer: MOCK_GATEWAY.wallet.address,
            signature: signState(mockFirstState(), MOCK_GATEWAY.wallet.privateKey),
          },
        ],
      },
    ],
  },
})

const mockRunningState = (): State => ({
  ...mockFirstState(),
  turnNum: 4,
})

export const mockQueryRequestMessage = (): WireMessage => ({
  sender: 'gateway',
  recipient: 'me',
  data: {
    signedStates: [
      {
        ...mockRunningState(),
        signatures: [
          {
            signer: MOCK_GATEWAY.wallet.address,
            signature: signState(mockRunningState(), MOCK_GATEWAY.wallet.privateKey),
          },
        ],
      },
    ],
  },
})

export const mockQuery = (): PaidQuery => ({
  stateChannelMessage: mockQueryRequestMessage(),
  subgraphDeploymentID: mockSubgraphId(),
  query: '',
  allocationID: 'abc',
  requestCID: '',
})

const mockClosingState = (): State => ({
  ...mockFirstState(),
  turnNum: 6,
  isFinal: true,
})

export const mockCloseChannelMessage = (): WireMessage => ({
  sender: 'gateway',
  recipient: 'me',
  data: {
    signedStates: [
      {
        ...mockClosingState(),
        signatures: [
          {
            signer: MOCK_GATEWAY.wallet.address,
            signature: signState(mockClosingState(), MOCK_GATEWAY.wallet.privateKey),
          },
        ],
      },
    ],
  },
})
