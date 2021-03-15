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

export interface TransferAttributes {
  routingId: string
  allocation: Address
  signer: Address
  isResolved: boolean
}

export class Transfer extends Model<TransferAttributes> implements TransferAttributes {
  public routingId!: string
  public allocation!: Address
  public signer!: Address
  public isResolved!: boolean

  public readonly createdAt!: Date
  public readonly updatedAt!: Date

  public readonly receipts?: Receipt[]

  public static associations: {
    receipts: Association<Transfer, Receipt>
  }
}

export interface PaymentModels {
  receipts: typeof Receipt
  transfers: typeof Transfer
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
      isResolved: {
        type: DataTypes.BOOLEAN,
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

  return { receipts: Receipt, transfers: Transfer }
}
