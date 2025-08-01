import { toAddress, Address } from '@graphprotocol/common-ts'
import {
  DataTypes,
  Sequelize,
  Model,
  CreationOptional,
  InferCreationAttributes,
  InferAttributes,
  ForeignKey,
} from 'sequelize'

// Indexing Fees AKA "DIPs"

export class IndexingAgreement extends Model<
  InferAttributes<IndexingAgreement>,
  InferCreationAttributes<IndexingAgreement>
> {
  declare id: CreationOptional<string>
  declare signature: Buffer
  declare signed_payload: Buffer
  declare protocol_network: string
  declare chain_id: string
  declare base_price_per_epoch: string
  declare price_per_entity: string
  declare subgraph_deployment_id: string
  declare service: string
  declare payee: string
  declare payer: string
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
  declare current_allocation_id: string | null
  declare last_allocation_id: string | null
  declare last_payment_collected_at: Date | null
}

export type DipsReceiptStatus = 'PENDING' | 'SUBMITTED' | 'FAILED'

export class DipsReceipt extends Model<
  InferAttributes<DipsReceipt>,
  InferCreationAttributes<DipsReceipt>
> {
  declare id: string // Primary key - Receipt ID from Dipper
  declare agreement_id: ForeignKey<IndexingAgreement['id']>
  declare amount: string
  declare status: DipsReceiptStatus
  declare transaction_hash: string | null
  declare error_message: string | null
  declare created_at: CreationOptional<Date>
  declare updated_at: CreationOptional<Date>
  declare retry_count: CreationOptional<number>
}

export interface IndexingFeesModels {
  IndexingAgreement: typeof IndexingAgreement
  DipsReceipt: typeof DipsReceipt
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
      tableName: 'indexing_agreements',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  )

  DipsReceipt.init(
    {
      id: {
        type: DataTypes.STRING(255),
        primaryKey: true,
        allowNull: false,
      },
      agreement_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: IndexingAgreement,
          key: 'id',
        },
      },
      amount: {
        type: DataTypes.DECIMAL(39),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('PENDING', 'SUBMITTED', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      transaction_hash: {
        type: DataTypes.CHAR(66),
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      retry_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      modelName: 'DipsReceipt',
      sequelize,
      tableName: 'dips_receipts',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        {
          fields: ['agreement_id'],
        },
        {
          fields: ['status'],
        },
      ],
    },
  )

  // Define associations
  DipsReceipt.belongsTo(IndexingAgreement, {
    foreignKey: 'agreement_id',
    as: 'agreement',
  })

  IndexingAgreement.hasMany(DipsReceipt, {
    foreignKey: 'agreement_id',
    as: 'receipts',
  })

  return {
    ['IndexingAgreement']: IndexingAgreement,
    ['DipsReceipt']: DipsReceipt,
  }
}
