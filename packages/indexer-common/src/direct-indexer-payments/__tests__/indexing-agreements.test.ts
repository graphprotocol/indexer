// Make global Jest variables available

import { Sequelize } from 'sequelize'
import {
  DirectIndexerPaymentModels,
  IndexingAgreementState,
  IndexingVoucher,
  defineDirectIndexingPaymentModels,
} from '../models'
import { connectDatabase } from '@graphprotocol/common-ts'
import { Wallet, ethers } from 'ethers'
import { hexlify } from 'ethers/lib/utils'
import {
  IndexingAgreementVoucherABI,
  IndexingAgreementVoucherABIFields,
  SubgraphIndexingAgreementVoucherMetadataABI,
  SubgraphIndexingVoucherMetadataABIFields,
  fromSignatureAndData,
} from '../abi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any

let paymentModels: DirectIndexerPaymentModels
let sequelize: Sequelize

const setup = async () => {
  sequelize = await connectDatabase(__DATABASE__)
  paymentModels = defineDirectIndexingPaymentModels(sequelize)
  sequelize = await sequelize.sync({ force: true })
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
}
const teardownEach = async () => {
  // Clear out indexing agreement models
  await paymentModels.IndexingAgreementModel.truncate({ cascade: true })
  await paymentModels.IndexingVoucherModel.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
}

// Utility to generate random Ethereum address
const randomAddress = () => Wallet.createRandom().address

// Utility to generate random bytes32 data
const randomBytes32 = () => hexlify(ethers.utils.randomBytes(32))
const randomBigInt = () =>
  BigInt(parseInt(ethers.utils.hexlify(ethers.utils.randomBytes(8))))

/**
 * @returns A mock voucher with random data
 * @field signerAddress The address of the signer
 * @field signature The signature of the voucher
 * @field data The ABI encoded voucher
 * @field voucher The voucher generated
 * @field metadata The metadata of the voucher
 */
async function generateMockVoucher(): Promise<{
  signerAddress: string
  signature: string
  data: string
  voucher: IndexingAgreementVoucherABI
  metadata: SubgraphIndexingAgreementVoucherMetadataABI
}> {
  const metadata: SubgraphIndexingAgreementVoucherMetadataABI = {
    subgraphDeploymentId: randomBytes32(),
    pricePerBlock: randomBigInt(),
  }

  const voucher: IndexingAgreementVoucherABI = {
    payer: randomAddress(),
    payee: randomAddress(),
    service: randomAddress(),
    maxInitialAmount: randomBigInt(),
    maxOngoingAmountPerEpoch: randomBigInt(),
    deadline: Date.now() + 86400 * 1000 * 7, // One week from now in milliseconds
    maxEpochsPerCollection: Math.floor(Math.random() * 10) + 1,
    minEpochsPerCollection: Math.floor(Math.random() * 5) + 1,
    durationEpochs: Math.floor(Math.random() * 30) + 10,
    metadata: encodeMetadataABI(metadata),
  }

  const wallet = Wallet.createRandom()
  const signerAddress = wallet.address
  const data = encodeVoucherABI(voucher)
  const signature = await wallet.signMessage(data)

  return { signerAddress, signature, data, voucher, metadata }
}

function encodeMetadataABI(metadata: SubgraphIndexingAgreementVoucherMetadataABI) {
  return ethers.utils.defaultAbiCoder.encode(SubgraphIndexingVoucherMetadataABIFields, [
    metadata.subgraphDeploymentId,
    metadata.pricePerBlock,
  ])
}

// This is here in the test since we don't plan on encoding the voucher in the indexer.
function encodeVoucherABI(voucher: IndexingAgreementVoucherABI) {
  return ethers.utils.defaultAbiCoder.encode(IndexingAgreementVoucherABIFields, [
    voucher.payer,
    voucher.payee,
    voucher.service,
    voucher.maxInitialAmount,
    voucher.maxOngoingAmountPerEpoch,
    voucher.deadline,
    voucher.maxEpochsPerCollection,
    voucher.minEpochsPerCollection,
    voucher.durationEpochs,
    voucher.metadata,
  ])
}

describe('Direct Indexer Payments', () => {
  beforeAll(setup)
  beforeEach(setupEach)
  afterEach(teardownEach)
  afterAll(teardownAll)

  it('should throw an error when the signer is not valid', async () => {
    const { signature, data } = await generateMockVoucher()
    const validSigners = [randomAddress(), randomAddress()]
    expect(() => fromSignatureAndData(signature, data, validSigners)).toThrow()
  })

  it('should deserialize a voucher from an ABI encoded values', async () => {
    const { signerAddress, signature, data, voucher } = await generateMockVoucher()
    const deserialized: IndexingVoucher = fromSignatureAndData(signature, data, [
      signerAddress,
    ])
    expect(deserialized.payer).toEqual(voucher.payer)
    expect(deserialized.payee).toEqual(voucher.payee)
    expect(deserialized.service).toEqual(voucher.service)
    expect(deserialized.maxInitialAmount).toEqual(voucher.maxInitialAmount)
    expect(deserialized.maxOngoingAmountPerEpoch).toEqual(
      voucher.maxOngoingAmountPerEpoch,
    )
  })

  it('should create a new agreement from a voucher recieved', async () => {
    const { signerAddress, signature, data } = await generateMockVoucher()

    try {
      const newVoucher = await fromSignatureAndData(signature, data, [signerAddress])
      const savedVoucher = await paymentModels.IndexingVoucherModel.create(newVoucher)

      const savedAgreement = await paymentModels.IndexingAgreementModel.create({
        signature,
        subgraphDeploymentId: newVoucher.subgraphDeploymentId,
        openedAt: new Date(),
        status: IndexingAgreementState.OPEN,
      })

      expect(savedAgreement.signature).toEqual(savedVoucher.signature)

      const agreement = await paymentModels.IndexingAgreementModel.findOne({
        where: {
          signature: signature,
        },
      })

      expect(agreement).not.toBeNull()
    } catch (e) {
      console.log(e)
      throw e
    }
  })
})
