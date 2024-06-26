import { DataTypes, Model, Sequelize } from 'sequelize'
import { Address, toAddress } from '@graphprotocol/common-ts'
import {
  IndexingAgreementVoucherABI,
  SubgraphIndexingAgreementVoucherMetadataABI,
} from './abi'

/** Represents a signed indexing agreement voucher.  */

// REVIEW INT TYPES
export interface IndexingVoucher {
  /** signature of voucher data. */
  signature: string

  /** Payer's address for the voucher. Should coincide with the signer.*/
  payer: Address

  /** Payee's address for the voucher. Should coincide with the indexer's address.*/
  payee: Address

  /** Address of the service that the indexing request is intended for.*/
  service: Address

  /** Max payment for the initial work of indexing the subgraph.*/
  maxInitialAmount: bigint

  /** Max payment for the ongoing work of indexing the subgraph.*/
  maxOngoingAmountPerEpoch: bigint

  /** The deadline (instant in unix epoch ms) that the indexer must accept this agreement by.*/
  deadline: bigint

  /** Max number of epochs per collection. */
  maxEpochsPerCollection: number

  /** Min number of epochs per collection. */
  minEpochsPerCollection: number

  /** The subgraph deployment id.*/
  subgraphDeploymentId: string

  /** The price per block in wei GRT.*/
  pricePerBlock: bigint
}

/**
 * Represents the status of an indexing agreement.
 *
 * ### State transitions:
 * - open -> accepted | cancelled | expired
 * - accepted -> cancelled | ended
 * */
export enum IndexingAgreementState {
  OPEN = 'OPEN',
  ACCEPTED = 'ACCEPTED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  ENDED = 'ENDED',
}

/** Encoded form of the indexing agreement. Represents an agreement in the form we recieve it from the gateway.*/
export interface IndexingAgreementData {
  signature: string
  data: string
}

/**
 * Represents an indexing agreement, which is an instance of a voucher attached to a status.
 */
export interface IndexingAgreement {
  /** The agreement's signature */
  signature: string

  /** The subgraph deployment id. */
  subgraphDeploymentId: string

  /** The agreement's status */
  status: IndexingAgreementState

  /** Status modified at */
  statusModifiedAt: Date | null

  /** Agreement opened at */
  openedAt: Date
}

/** Represents the price per block that an indexer proposees for incoming agreements. */
// prices will eventually be stored in the contract
export interface IndexingPrice {
  /** The id of the price record */
  id?: number

  // in prod always arbitrum one, else arbitrum sepolia
  /** protocol network - where the contract lives and therefore where you allocate */
  protocolNetwork: string

  /** chainid - what network is indexed by that deployment*/
  chainId: string

  /** The price per block in wei GRT. */
  pricePerBlock: bigint
}

export class IndexingAgreementModel
  extends Model<IndexingAgreement>
  implements IndexingAgreement
{
  public signature!: string
  public subgraphDeploymentId!: string
  public openedAt!: Date

  public status!: IndexingAgreementState
  public statusModifiedAt: Date | null = null

  public readonly voucher?: IndexingVoucher
}

export class IndexingVoucherModel
  extends Model<IndexingVoucher>
  implements IndexingVoucher
{
  public signature!: string
  public payer!: Address
  public payee!: Address
  public service!: Address
  public maxInitialAmount!: bigint
  public maxOngoingAmountPerEpoch!: bigint
  public deadline!: bigint
  public maxEpochsPerCollection!: number
  public minEpochsPerCollection!: number
  public subgraphDeploymentId!: string
  public pricePerBlock!: bigint

  public static fromABI(
    signature: string,
    abi: IndexingAgreementVoucherABI,
    metadata: SubgraphIndexingAgreementVoucherMetadataABI,
  ): IndexingVoucher {
    const payer = toAddress(abi.payer)
    const payee = toAddress(abi.payee)
    const service = toAddress(abi.service)
    console.log('length of address: ', payer.length)
    return {
      signature: signature,
      payer: payer,
      payee: payee,
      service: service,
      maxInitialAmount: abi.maxInitialAmount,
      maxOngoingAmountPerEpoch: abi.maxOngoingAmountPerEpoch,
      deadline: BigInt(abi.deadline),
      maxEpochsPerCollection: abi.maxEpochsPerCollection,
      minEpochsPerCollection: abi.minEpochsPerCollection,
      subgraphDeploymentId: metadata.subgraphDeploymentId,
      pricePerBlock: metadata.pricePerBlock,
    }
  }
}

export class IndexingPriceModel extends Model<IndexingPrice> implements IndexingPrice {
  public id!: number
  public pricePerBlock!: bigint
  public protocolNetwork!: string
  public chainId!: string
}

export interface DirectIndexerPaymentModels {
  IndexingAgreementModel: typeof IndexingAgreementModel
  IndexingVoucherModel: typeof IndexingVoucherModel
  IndexingPriceModel: typeof IndexingPriceModel
}

export function defineDirectIndexingPaymentModels(
  sequelize: Sequelize,
): DirectIndexerPaymentModels {
  IndexingAgreementModel.init(
    {
      signature: {
        type: DataTypes.STRING(),
        allowNull: false,
        primaryKey: true,
      },
      subgraphDeploymentId: {
        type: DataTypes.STRING(66),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM,
        values: Object.values(IndexingAgreementState).map((v) => v.toString()),
        allowNull: false,
      },
      statusModifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      openedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'IndexingAgreement',
    },
  )

  IndexingVoucherModel.init(
    {
      signature: {
        type: DataTypes.STRING(132),
        allowNull: false,
        primaryKey: true,
      },
      payer: {
        type: DataTypes.STRING(42),
        allowNull: false,
      },
      payee: {
        type: DataTypes.STRING(42),
        allowNull: false,
      },
      service: {
        type: DataTypes.STRING(42),
        allowNull: false,
      },
      maxInitialAmount: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      maxOngoingAmountPerEpoch: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: { min: 0.0 },
      },
      deadline: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: { min: 0.0 },
      },
      maxEpochsPerCollection: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      minEpochsPerCollection: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subgraphDeploymentId: {
        type: DataTypes.STRING(66),
        allowNull: false,
      },
      pricePerBlock: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: { min: 0.0 },
      },
    },
    {
      sequelize,
      modelName: 'IndexingVoucher',
    },
  )

  IndexingPriceModel.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      pricePerBlock: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: { min: 0.0 },
      },
      protocolNetwork: {
        type: DataTypes.STRING(42),
        allowNull: false,
      },
      chainId: {
        type: DataTypes.STRING(42),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'IndexingPrice',
    },
  )

  return {
    ['IndexingAgreementModel']: IndexingAgreementModel,
    ['IndexingVoucherModel']: IndexingVoucherModel,
    ['IndexingPriceModel']: IndexingPriceModel,
  }
}
