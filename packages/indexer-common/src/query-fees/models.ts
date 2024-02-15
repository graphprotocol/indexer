import { DataTypes, Sequelize, Model, Association, CreationOptional } from 'sequelize'
import { Address, toAddress } from '@graphprotocol/common-ts'
import { caip2IdRegex } from '../parsers'
import { TAPVerifier } from '@semiotic-labs/tap-contracts-bindings'
// import { JSONParse, JSONStringify, camelize, snakefy } from './object-conversion'
export interface AllocationReceiptAttributes {
  id: string
  allocation: Address
  fees: string
  signature: string
  protocolNetwork: string
}

export class AllocationReceipt
  extends Model<AllocationReceiptAttributes>
  implements AllocationReceiptAttributes
{
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
  allocation_id: string
  sender_address: string
  signature: Uint8Array
  timestamp_ns: bigint
  value_aggregate: bigint
  //rav: unknown
  final: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/*export type RAVData = {
  message: {
    allocationId: string
    timestampNs: bigint
    valueAggregate: bigint
  }
  signature: {
    r: string
    s: string
    v: number
  }
}*/

export class ReceiptAggregateVoucher
  extends Model<ReceiptAggregateVoucherAttributes>
  implements ReceiptAggregateVoucherAttributes
{
  public allocation_id!: Address
  public sender_address!: Address
  public signature!: Uint8Array
  public timestamp_ns!: bigint
  public value_aggregate!: bigint
  // public rav!: SignedRAV
  public final!: boolean

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  public readonly allocationSummary?: AllocationSummary

  public static associations: {
    allocationSummary: Association<ReceiptAggregateVoucher, AllocationSummary>
  }

  getSingedRAV(): SignedRAV {
    return {
      rav: {
        allocationId: toAddress(this.allocation_id),
        timestampNs: this.timestamp_ns,
        valueAggregate: this.value_aggregate,
      },
      signature: this.signature,
    }
  }
}

export type SignedRAV = TAPVerifier.SignedRAVStruct

export interface TransferReceiptAttributes {
  id: number
  signer: Address
  fees: string
  signature: string
  protocolNetwork: string
}

export class TransferReceipt
  extends Model<TransferReceiptAttributes>
  implements TransferReceiptAttributes
{
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
  implements AllocationSummaryAttributes
{
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

  public voucherType?: 'Voucher' | 'ReceiptAggregateVoucher'

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
  transferReceipts: typeof TransferReceipt
  transfers: typeof Transfer
  allocationSummaries: typeof AllocationSummary
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
      allocation_id: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('allocation_id')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('allocation_id', addressWithoutPrefix)
        },
      },
      sender_address: {
        type: DataTypes.CHAR(40), // 40 because prefix '0x' gets removed by TAP agent
        allowNull: false,
        primaryKey: true,
        get() {
          const rawValue = this.getDataValue('sender_address')
          return toAddress(rawValue)
        },
        set(value: string) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('sender_address', addressWithoutPrefix)
        },
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      timestamp_ns: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      value_aggregate: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      final: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      tableName: 'scalar_tap_ravs',
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

  ReceiptAggregateVoucher.belongsTo(AllocationSummary, {
    targetKey: 'allocation',
    foreignKey: 'allocation_id',
    as: 'allocationSummary',
  })

  return {
    allocationReceipts: AllocationReceipt,
    vouchers: Voucher,
    receiptAggregateVouchers: ReceiptAggregateVoucher,
    transferReceipts: TransferReceipt,
    transfers: Transfer,
    allocationSummaries: AllocationSummary,
  }
}
