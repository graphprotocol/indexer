import { DataTypes, Sequelize, Model, Association } from 'sequelize'
import { Address } from '@tokene-q/common-ts'

export interface AllocationReceiptAttributes {
  id: string
  allocation: Address
  fees: string
  signature: string
}

export class AllocationReceipt
  extends Model<AllocationReceiptAttributes>
  implements AllocationReceiptAttributes
{
  public id!: string
  public allocation!: Address
  public fees!: string
  public signature!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date
}

export interface VoucherAttributes {
  allocation: Address
  amount: string
  signature: string
}

export class Voucher extends Model<VoucherAttributes> implements VoucherAttributes {
  public allocation!: Address
  public amount!: string
  public signature!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly allocationSummary?: AllocationSummary

  public static associations: {
    allocationSummary: Association<Voucher, AllocationSummary>
  }
}

export interface TransferReceiptAttributes {
  id: number
  signer: Address
  fees: string
  signature: string
}

export class TransferReceipt
  extends Model<TransferReceiptAttributes>
  implements TransferReceiptAttributes
{
  public id!: number
  public signer!: Address
  public fees!: string
  public signature!: string

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
}

export class Transfer extends Model<TransferAttributes> implements TransferAttributes {
  public routingId!: string
  public allocation!: Address
  public signer!: Address
  public allocationClosedAt!: Date | null
  public status!: TransferStatus

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

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly transfers?: Transfer[]
  public readonly allocationReceipts?: AllocationReceipt[]
  public readonly voucher?: Voucher

  public static associations: {
    transfers: Association<AllocationSummary, Transfer>
    allocationReceipts: Association<AllocationSummary, AllocationReceipt>
    voucher: Association<AllocationSummary, Voucher>
  }
}

export interface QueryFeeModels {
  allocationReceipts: typeof AllocationReceipt
  vouchers: typeof Voucher
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
    },
    { sequelize, tableName: 'vouchers' },
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

  AllocationSummary.hasOne(Voucher, {
    sourceKey: 'allocation',
    foreignKey: 'allocation',
    as: 'voucher',
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
    transferReceipts: TransferReceipt,
    transfers: Transfer,
    allocationSummaries: AllocationSummary,
  }
}
