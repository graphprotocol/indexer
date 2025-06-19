import { DataTypes, Sequelize, Model, Association, CreationOptional } from 'sequelize'
import { Address, toAddress } from '@graphprotocol/common-ts'
import { caip2IdRegex } from '../parsers'
import { TAPVerifier } from '@semiotic-labs/tap-contracts-bindings'
import { RAV as RAVv2 } from '@graphprotocol/toolshed'
import { BytesLike } from 'ethers'

export interface ScalarTapReceiptsAttributes {
  id: number
  allocation_id: Address
  signer_address: Address
  signature: Uint8Array
  timestamp_ns: bigint
  nonce: bigint
  value: bigint
  error_log?: string
}
export class ScalarTapReceipts
  extends Model<ScalarTapReceiptsAttributes>
  implements ScalarTapReceiptsAttributes {
  public id!: number
  public allocation_id!: Address
  public signer_address!: Address
  public signature!: Uint8Array
  public timestamp_ns!: bigint
  public nonce!: bigint
  public value!: bigint

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export interface TapHorizonReceiptsAttributes {
  id: number
  allocation_id: Address
  signer_address: Address
  signature: Uint8Array
  timestamp_ns: bigint
  nonce: bigint
  value: bigint
  error_log?: string
}
export class TapHorizonReceipts
  extends Model<TapHorizonReceiptsAttributes>
  implements TapHorizonReceiptsAttributes {
  public id!: number
  public allocation_id!: Address
  public signer_address!: Address
  public signature!: Uint8Array
  public timestamp_ns!: bigint
  public nonce!: bigint
  public value!: bigint

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export class ScalarTapReceiptsInvalid
  extends Model<ScalarTapReceiptsAttributes>
  implements ScalarTapReceiptsAttributes {
  public id!: number
  public allocation_id!: Address
  public signer_address!: Address
  public timestamp_ns!: bigint
  public nonce!: bigint
  public value!: bigint
  public signature!: Uint8Array
  public error_log!: string

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export class TapHorizonReceiptsInvalid
  extends Model<TapHorizonReceiptsAttributes>
  implements TapHorizonReceiptsAttributes {
  public id!: number
  public allocation_id!: Address
  public signer_address!: Address
  public timestamp_ns!: bigint
  public nonce!: bigint
  public value!: bigint
  public signature!: Uint8Array
  public error_log!: string

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

export interface AllocationReceiptAttributes {
  id: string
  allocation: Address
  fees: string
  signature: string
  protocolNetwork: string
}

export class AllocationReceipt
  extends Model<AllocationReceiptAttributes>
  implements AllocationReceiptAttributes {
  public id!: string
  public allocation!: Address
  public fees!: string
  public signature!: string
  public protocolNetwork!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

export interface VoucherAttributes {
  allocation: Address
  amount: string
  signature: string
  protocolNetwork: string
}

export class Voucher extends Model<VoucherAttributes> implements VoucherAttributes {
  public allocation!: Address
  public amount!: string
  public signature!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date
  public protocolNetwork!: string

  public readonly allocationSummary?: AllocationSummary

  public static associations: {
    allocationSummary: Association<Voucher, AllocationSummary>
  }
}

export interface ReceiptAggregateVoucherAttributes {
  allocationId: string
  senderAddress: string
  signature: Uint8Array
  timestampNs: bigint
  valueAggregate: bigint
  last: boolean
  redeemedAt: Date | null
  final: boolean
}

export interface ReceiptAggregateVoucherV2Attributes {
  collectionId: string
  senderAddress: string
  serviceProviderAddress: string
  dataServiceAddress: string
  metadata: string
  signature: Uint8Array
  timestampNs: bigint
  valueAggregate: bigint
  last: boolean
  redeemedAt: Date | null
  final: boolean
}

export interface FailedReceiptAggregateVoucherAttributes {
  allocationId: string
  senderAddress: string
  expectedRav: JSON
  rav_response: JSON
  reason: string
}


export interface FailedReceiptAggregateVoucherV2Attributes {
  collectionId: string
  senderAddress: string
  serviceProviderAddress: string
  dataServiceAddress: string
  expectedRav: JSON
  rav_response: JSON
  reason: string
}

export class ReceiptAggregateVoucher
  extends Model<ReceiptAggregateVoucherAttributes>
  implements ReceiptAggregateVoucherAttributes {
  public allocationId!: Address
  public senderAddress!: Address
  public signature!: Uint8Array
  public timestampNs!: bigint
  public valueAggregate!: bigint
  public final!: boolean
  public last!: boolean
  public redeemedAt!: Date | null

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  public readonly allocationSummary?: AllocationSummary

  public static associations: {
    allocationSummary: Association<ReceiptAggregateVoucher, AllocationSummary>
  }

  getSignedRAV(): SignedRAV {
    return {
      rav: {
        allocationId: this.allocationId,
        timestampNs: this.timestampNs,
        valueAggregate: this.valueAggregate,
      },
      signature: this.signature,
    }
  }
}

// TODO HORIZON: move this to the toolshed package
export type SignedRAVv2 = {
  rav: Omit<RAVv2, 'payer' | 'serviceProvider' | 'dataService'> & {
    senderAddress: string
    serviceProviderAddress: string
    dataServiceAddress: string
  }
  signature: BytesLike
}

export class ReceiptAggregateVoucherV2
  extends Model<ReceiptAggregateVoucherV2Attributes>
  implements ReceiptAggregateVoucherV2Attributes {
  public collectionId!: Address
  public senderAddress!: Address
  public serviceProviderAddress!: Address
  public dataServiceAddress!: Address
  public metadata!: string
  public signature!: Uint8Array
  public timestampNs!: bigint
  public valueAggregate!: bigint
  public final!: boolean
  public last!: boolean
  public redeemedAt!: Date | null

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  public readonly allocationSummary?: AllocationSummary

  public static associations: {
    allocationSummary: Association<ReceiptAggregateVoucherV2, AllocationSummary>
  }

  getSignedRAV(): SignedRAVv2 {
    return {
      rav: {
        collectionId: this.collectionId,
        senderAddress: this.senderAddress,
        serviceProviderAddress: this.serviceProviderAddress,
        dataServiceAddress: this.dataServiceAddress,
        timestampNs: Number(this.timestampNs),
        valueAggregate: this.valueAggregate,
        metadata: this.metadata,
      },
      signature: this.signature,
    }
  }
}

export type SignedRAV = TAPVerifier.SignedRAVStruct

export class FailedReceiptAggregateVoucher
  extends Model<FailedReceiptAggregateVoucherAttributes>
  implements FailedReceiptAggregateVoucherAttributes {
  public allocationId!: Address
  public senderAddress!: Address
  public expectedRav!: JSON
  public rav_response!: JSON
  public reason!: string
}


export class FailedReceiptAggregateVoucherV2
  extends Model<FailedReceiptAggregateVoucherV2Attributes>
  implements FailedReceiptAggregateVoucherV2Attributes {
  public collectionId!: Address
  public senderAddress!: Address
  public serviceProviderAddress!: Address
  public dataServiceAddress!: Address
  public expectedRav!: JSON
  public rav_response!: JSON
  public reason!: string
}

export interface TransferReceiptAttributes {
  id: number
  signer: Address
  fees: string
  signature: string
  protocolNetwork: string
}

export class TransferReceipt
  extends Model<TransferReceiptAttributes>
  implements TransferReceiptAttributes {
  public id!: number
  public signer!: Address
  public fees!: string
  public signature!: string
  public protocolNetwork!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly transfer?: Transfer

  public static associations: {
    transfer: Association<TransferReceipt, Transfer>
  }
}

export enum TransferStatus {
  OPEN = 'OPEN',
  ALLOCATION_CLOSED = 'ALLOCATION_CLOSED',
  RESOLVED = 'RESOLVED',
  FAILED = 'FAILED',
}

export interface TransferAttributes {
  routingId: string
  allocation: Address
  signer: Address
  allocationClosedAt: Date | null
  status: TransferStatus
  protocolNetwork: string
}

export class Transfer extends Model<TransferAttributes> implements TransferAttributes {
  public routingId!: string
  public allocation!: Address
  public signer!: Address
  public allocationClosedAt!: Date | null
  public status!: TransferStatus
  public protocolNetwork!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly receipts?: TransferReceipt[]

  public static associations: {
    receipts: Association<Transfer, TransferReceipt>
  }
}

export interface AllocationSummaryAttributes {
  allocation: Address
  closedAt: Date | null
  createdTransfers: number
  resolvedTransfers: number
  failedTransfers: number
  openTransfers: number
  collectedFees: string
  withdrawnFees: string
  protocolNetwork: string
}

export class AllocationSummary
  extends Model<AllocationSummaryAttributes>
  implements AllocationSummaryAttributes {
  public allocation!: Address
  public closedAt!: Date
  public createdTransfers!: number
  public resolvedTransfers!: number
  public failedTransfers!: number
  public openTransfers!: number
  public collectedFees!: string
  public withdrawnFees!: string
  public protocolNetwork!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly transfers?: Transfer[]
  public readonly allocationReceipts?: AllocationReceipt[]
  public readonly voucher?: Voucher
  public readonly receiptAggregateVoucher?: ReceiptAggregateVoucher
  public readonly receiptAggregateVoucherV2?: ReceiptAggregateVoucherV2

  public voucherType?: 'Voucher' | 'ReceiptAggregateVoucher' | 'ReceiptAggregateVoucherV2'

  public static associations: {
    transfers: Association<AllocationSummary, Transfer>
    allocationReceipts: Association<AllocationSummary, AllocationReceipt>
    voucher: Association<AllocationSummary, Voucher>
    receiptAggregateVoucher: Association<AllocationSummary, ReceiptAggregateVoucher>
  }
}

export interface QueryFeeModels {
  allocationReceipts: typeof AllocationReceipt
  vouchers: typeof Voucher
  receiptAggregateVouchers: typeof ReceiptAggregateVoucher
  receiptAggregateVouchersV2: typeof ReceiptAggregateVoucherV2
  transferReceipts: typeof TransferReceipt
  transfers: typeof Transfer
  allocationSummaries: typeof AllocationSummary
  scalarTapReceipts: typeof ScalarTapReceipts
  scalarTapReceiptsInvalid: typeof ScalarTapReceiptsInvalid
  failedReceiptAggregateVouchers: typeof FailedReceiptAggregateVoucher
  failedReceiptAggregateVouchersV2: typeof FailedReceiptAggregateVoucherV2
}

export function defineQueryFeeModels(sequelize: Sequelize): QueryFeeModels {
  AllocationReceipt.init(
    {
      // TODO: To distinguish between (id, allocation) pairs from different
      // clients, the primary key should really be (id, allocation,
      // clientAddress)
      id: {
        type: DataTypes.STRING(66),
        allowNull: false,
        primaryKey: true,
      },
      allocation: {
        type: DataTypes.STRING(42),
        allowNull: false,
        primaryKey: true,
      },

      signature: {
        type: DataTypes.STRING(132),
        allowNull: false,
      },
      fees: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: {
          min: 0.0,
        },
      },
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
      },
    },
    { sequelize, tableName: 'allocation_receipts' },
  )

  Voucher.init(
    {
      allocation: {
        type: DataTypes.STRING(42),
        allowNull: false,
        primaryKey: true,
      },
      amount: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: {
          min: 0.0,
        },
      },
      signature: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
      },
    },
    { sequelize, tableName: 'vouchers' },
  )

  ReceiptAggregateVoucher.init(
    {
      allocationId: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('allocationId')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('allocationId', addressWithoutPrefix)
        },
      },
      senderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('senderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('senderAddress', addressWithoutPrefix)
        },
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      // ternary operator added to timestampNs and valueAggregate
      // due to sequelize UPDATE
      // calls  the getters with undefined data
      // 0 is returned since no real data is being requested
      timestampNs: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        get() {
          return BigInt(this.getDataValue('timestampNs'))
        },
      },
      valueAggregate: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        get() {
          return BigInt(this.getDataValue('valueAggregate'))
        },
      },
      last: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      final: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      redeemedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'scalar_tap_ravs',
    },
  )

  ReceiptAggregateVoucherV2.init(
    {
      collectionId: {
        type: DataTypes.CHAR(64), // 64 because prefix '0x' gets removed by GraphTally agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('collectionId')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('collectionId', addressWithoutPrefix)
        },
      },
      senderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('senderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('senderAddress', addressWithoutPrefix)
        },
      },
      serviceProviderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('serviceProviderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('serviceProviderAddress', addressWithoutPrefix)
        },
      },
      dataServiceAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('dataServiceAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('dataServiceAddress', addressWithoutPrefix)
        },
      },
      metadata: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      // ternary operator added to timestampNs and valueAggregate
      // due to sequelize UPDATE
      // calls  the getters with undefined data
      // 0 is returned since no real data is being requested
      timestampNs: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        get() {
          return BigInt(this.getDataValue('timestampNs'))
        },
      },
      valueAggregate: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        get() {
          return BigInt(this.getDataValue('valueAggregate'))
        },
      },
      last: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      final: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      redeemedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'tap_horizon_ravs',
    },
  )

  TransferReceipt.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      signer: {
        type: DataTypes.STRING(42),
        allowNull: false,
        primaryKey: true,
      },
      signature: {
        type: DataTypes.STRING(132),
        allowNull: false,
      },
      fees: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: {
          min: 0.0,
        },
      },
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
      },
    },
    { sequelize, tableName: 'transfer_receipts' },
  )

  Transfer.init(
    {
      signer: {
        type: DataTypes.STRING(42),
        allowNull: false,
        primaryKey: true,
      },
      allocation: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      routingId: {
        type: DataTypes.STRING(66),
        allowNull: false,
        primaryKey: true,
      },
      allocationClosedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          TransferStatus.OPEN,
          TransferStatus.ALLOCATION_CLOSED,
          TransferStatus.RESOLVED,
          TransferStatus.FAILED,
        ),
        allowNull: false,
      },
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
      },
    },
    { sequelize, tableName: 'transfers' },
  )

  AllocationSummary.init(
    {
      allocation: {
        type: DataTypes.STRING(42),
        allowNull: false,
        primaryKey: true,
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdTransfers: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      resolvedTransfers: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      failedTransfers: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      openTransfers: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      collectedFees: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      withdrawnFees: {
        type: DataTypes.DECIMAL,
        allowNull: false,
      },
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
      },
    },
    { sequelize, tableName: 'allocation_summaries' },
  )

  FailedReceiptAggregateVoucher.init(
    {
      allocationId: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('allocationId')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('allocationId', addressWithoutPrefix)
        },
      },
      senderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('senderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('senderAddress', addressWithoutPrefix)
        },
      },
      expectedRav: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      rav_response: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'failed_receipt_aggregate_vouchers',
    },
  )


  FailedReceiptAggregateVoucherV2.init(
    {
      collectionId: {
        type: DataTypes.CHAR(64),
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('collectionId')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('collectionId', addressWithoutPrefix)
        },
      },
      senderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('senderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('senderAddress', addressWithoutPrefix)
        },
      },
      serviceProviderAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('serviceProviderAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('serviceProviderAddress', addressWithoutPrefix)
        },
      },
      dataServiceAddress: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('dataServiceAddress')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('dataServiceAddress', addressWithoutPrefix)
        },
      },
      expectedRav: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      rav_response: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'failed_receipt_aggregate_vouchers_v2',
    },
  )

  ScalarTapReceipts.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      nonce: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      value: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'scalar_tap_receipts',
    },
  )

  TapHorizonReceipts.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      nonce: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      value: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'tap_horizon_receipts',
    },
  )

  ScalarTapReceiptsInvalid.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      nonce: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      value: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      error_log: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'scalar_tap_receipts_invalid',
    },
  )


  TapHorizonReceiptsInvalid.init(
    {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      signer_address: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      nonce: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      value: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      error_log: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
    },
    {
      underscored: true,
      sequelize,
      tableName: 'tap_horizon_receipts_invalid',
    },
  )

  Transfer.hasMany(TransferReceipt, {
    sourceKey: 'signer',
    foreignKey: 'signer',
    as: 'receipts',
  })

  TransferReceipt.belongsTo(Transfer, {
    targetKey: 'signer',
    foreignKey: 'signer',
    as: 'transfer',
  })

  AllocationSummary.hasMany(Transfer, {
    sourceKey: 'allocation',
    foreignKey: 'allocation',
    as: 'transfers',
  })

  AllocationSummary.hasMany(AllocationReceipt, {
    sourceKey: 'allocation',
    foreignKey: 'allocation',
    as: 'allocationReceipts',
  })

  Transfer.belongsTo(AllocationSummary, {
    targetKey: 'allocation',
    foreignKey: 'allocation',
    as: 'allocationSummary',
  })

  AllocationReceipt.belongsTo(AllocationSummary, {
    targetKey: 'allocation',
    foreignKey: 'allocation',
    as: 'allocationSummary',
  })

  Voucher.belongsTo(AllocationSummary, {
    targetKey: 'allocation',
    foreignKey: 'allocation',
    as: 'allocationSummary',
  })

  return {
    allocationReceipts: AllocationReceipt,
    vouchers: Voucher,
    receiptAggregateVouchers: ReceiptAggregateVoucher,
    receiptAggregateVouchersV2: ReceiptAggregateVoucherV2,
    transferReceipts: TransferReceipt,
    transfers: Transfer,
    allocationSummaries: AllocationSummary,
    scalarTapReceipts: ScalarTapReceipts,
    scalarTapReceiptsInvalid: ScalarTapReceiptsInvalid,
    failedReceiptAggregateVouchers: FailedReceiptAggregateVoucher,
    failedReceiptAggregateVouchersV2: FailedReceiptAggregateVoucherV2,
  }
}
