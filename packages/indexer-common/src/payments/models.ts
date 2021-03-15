import { DataTypes, Sequelize, Model, Association } from 'sequelize'
import { Address } from '@graphprotocol/common-ts'

export interface ReceiptAttributes {
  id: number
  signer: Address
  paymentAmount: string
  signature: string
}

export class Receipt extends Model<ReceiptAttributes> implements ReceiptAttributes {
  public id!: number
  public signer!: Address
  public paymentAmount!: string
  public signature!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly transfer?: Transfer

  public static associations: {
    transfer: Association<Receipt, Transfer>
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

  public readonly receipts?: Receipt[]

  public static associations: {
    receipts: Association<Transfer, Receipt>
  }
}

export interface AllocationSummaryAttributes {
  allocation: Address
  closedAt: Date | null
  createdTransfers: number
  resolvedTransfers: number
  failedTransfers: number
  openTransfers: number
  queryFees: string
  withdrawnFees: string
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
  public queryFees!: string
  public withdrawnFees!: string

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public static associations: {
    transfers: Association<AllocationSummary, Transfer>
  }
}

export interface PaymentModels {
  receipts: typeof Receipt
  transfers: typeof Transfer
  allocationSummaries: typeof AllocationSummary
}

export function definePaymentModels(sequelize: Sequelize): PaymentModels {
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

  Receipt.init(
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
      paymentAmount: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: {
          min: 0.0,
        },
      },
    },
    { sequelize, tableName: 'receipts' },
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
      queryFees: {
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

  Transfer.hasMany(Receipt, {
    sourceKey: 'signer',
    foreignKey: 'signer',
    as: 'receipts',
  })

  Receipt.belongsTo(Transfer, {
    targetKey: 'signer',
    foreignKey: 'signer',
    as: 'transfer',
  })

  AllocationSummary.hasMany(Transfer, {
    sourceKey: 'allocation',
    foreignKey: 'allocation',
    as: 'transfers',
  })

  Transfer.belongsTo(AllocationSummary, {
    targetKey: 'allocation',
    foreignKey: 'allocation',
    as: 'allocationSummary',
  })

  return {
    receipts: Receipt,
    transfers: Transfer,
    allocationSummaries: AllocationSummary,
  }
}
