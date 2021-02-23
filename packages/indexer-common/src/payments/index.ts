import { DataTypes, Sequelize, ModelCtor, Model } from 'sequelize'
import { BigNumber } from 'ethers'
import { Address } from '@graphprotocol/common-ts'

export type Receipt = {
  signer: string
  id: number
  paymentAmount: BigNumber
  signature: string
}

export type ReceiptStore = {
  signer: string
  id: number
  paymentAmount: string
  signature: string
}

export type ReceiptModel = ModelCtor<Model<ReceiptStore>>

export type ReceiptsTransfer = {
  signer: Address
  allocation: string
}

export type ReceiptsTransferModel = ModelCtor<Model<Receipt>>

export function defineReceiptTransferModel(sequelize: Sequelize): ReceiptsTransferModel {
  const model = {
    signer: {
      type: DataTypes.STRING(42),
      allowNull: false,
    },
    allocation: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    transferRoutingId: {
      type: DataTypes.STRING(66),
      allowNull: false,
      primaryKey: true,
    },
    isResolved: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
  }
  return sequelize.define('receiptTransfers', model)
}

export function defineReceiptModel(sequelize: Sequelize): ReceiptModel {
  const model = {
    signer: {
      type: DataTypes.STRING(42),
      allowNull: false,
      primaryKey: true,
    },
    id: {
      type: DataTypes.INTEGER({ unsigned: true }),
      allowNull: false,
      primaryKey: true,
    },
    signature: {
      type: DataTypes.STRING(132),
      allowNull: false,
    },
    paymentAmount: {
      type: DataTypes.STRING(66),
      allowNull: false,
    },
  }

  return sequelize.define('receipts', model)
}
