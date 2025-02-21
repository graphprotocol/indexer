import { toAddress, Address } from '@graphprotocol/common-ts'
import { DataTypes, Sequelize, Model, CreationOptional } from 'sequelize'

// Indexing Fees AKA "DIPs"
export interface IndexingAgreementAttributes {
  id: string
  signature: Buffer
  signed_payload: Buffer
  protocol_network: string
  chain_id: string
  base_price_per_epoch: string
  price_per_entity: string
  subgraph_deployment_id: string
  service: string
  payee: string
  payer: string
  deadline: Date
  duration_epochs: bigint
  max_initial_amount: string
  max_ongoing_amount_per_epoch: string
  min_epochs_per_collection: bigint
  max_epochs_per_collection: bigint
  created_at: Date
  updated_at: Date
  cancelled_at: Date | null
  signed_cancellation_payload: Buffer | null
  current_allocation_id: string | null
  last_allocation_id: string | null
  last_payment_collected_at: Date | null
}

export class IndexingAgreement
  extends Model<IndexingAgreementAttributes>
  implements IndexingAgreementAttributes
{
  declare id: CreationOptional<string>
  declare signature: Buffer
  declare signed_payload: Buffer
  declare protocol_network: string
  declare chain_id: string
  declare base_price_per_epoch: string
  declare price_per_entity: string
  declare subgraph_deployment_id: string
  declare service: Address
  declare payee: Address
  declare payer: Address
  declare deadline: Date
  declare duration_epochs: bigint
  declare max_initial_amount: string
  declare max_ongoing_amount_per_epoch: string
  declare min_epochs_per_collection: bigint
  declare max_epochs_per_collection: bigint
  declare created_at: Date
  declare updated_at: Date
  declare cancelled_at: Date | null
  declare signed_cancellation_payload: Buffer | null
  declare current_allocation_id: Address | null
  declare last_allocation_id: Address | null
  declare last_payment_collected_at: Date | null
}

export interface IndexingFeesModels {
  IndexingAgreement: typeof IndexingAgreement
}

export const defineIndexingFeesModels = (sequelize: Sequelize): IndexingFeesModels => {
  IndexingAgreement.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
      },
      signature: {
        type: DataTypes.BLOB,
        allowNull: false,
        unique: true,
      },
      signed_payload: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      protocol_network: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      chain_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      base_price_per_epoch: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      price_per_entity: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      subgraph_deployment_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      service: {
        type: DataTypes.CHAR(40),
        allowNull: false,
        get() {
          const rawValue = this.getDataValue('service')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('service', addressWithoutPrefix)
        },
      },
      payee: {
        type: DataTypes.CHAR(40),
        allowNull: false,
        get() {
          const rawValue = this.getDataValue('payee')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('payee', addressWithoutPrefix)
        },
      },
      payer: {
        type: DataTypes.CHAR(40),
        allowNull: false,
        get() {
          const rawValue = this.getDataValue('payer')
          return toAddress(rawValue)
        },
        set(value: Address) {
          const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
          this.setDataValue('payer', addressWithoutPrefix)
        },
      },
      deadline: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      duration_epochs: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      max_initial_amount: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      max_ongoing_amount_per_epoch: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      min_epochs_per_collection: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      max_epochs_per_collection: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      signed_cancellation_payload: {
        type: DataTypes.BLOB,
        allowNull: true,
      },
      current_allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: true,
        get() {
          const rawValue = this.getDataValue('current_allocation_id')
          if (!rawValue) {
            return null
          }
          return toAddress(rawValue)
        },
        set(value: Address | null) {
          if (!value) {
            this.setDataValue('current_allocation_id', null)
          } else {
            const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
            this.setDataValue('current_allocation_id', addressWithoutPrefix)
          }
        },
      },
      last_allocation_id: {
        type: DataTypes.CHAR(40),
        allowNull: true,
        get() {
          const rawValue = this.getDataValue('last_allocation_id')
          if (!rawValue) {
            return null
          }
          return toAddress(rawValue)
        },
        set(value: Address | null) {
          if (!value) {
            this.setDataValue('last_allocation_id', null)
          } else {
            const addressWithoutPrefix = value.toLowerCase().replace('0x', '')
            this.setDataValue('last_allocation_id', addressWithoutPrefix)
          }
        },
      },
      last_payment_collected_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      modelName: 'IndexingAgreement',
      sequelize,
    },
  )

  return {
    ['IndexingAgreement']: IndexingAgreement,
  }
}
