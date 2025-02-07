import { DataTypes, Sequelize, Model, Association, CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'

// Indexing Fees AKA "DIPs"

export class IndexingAgreement extends Model<
  InferAttributes<IndexingAgreement>,
  InferCreationAttributes<IndexingAgreement>
> {
  declare id: CreationOptional<string>;
  declare signature: Buffer;
  declare signed_payload: Buffer;
  declare protocol_network: string;
  declare chain_id: string;
  declare price_per_block: string;
  declare price_per_entity: string;
  declare subgraph_deployment_id: string;
  declare service: string;
  declare payee: string;
  declare payer: string;
  declare created_at: Date;
  declare updated_at: Date;
  declare cancelled_at: Date | null;
  declare signed_cancellation_payload: Buffer | null;
  declare current_allocation_id: string | null;
  declare last_allocation_id: string | null;
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
        type: DataTypes.BLOB, // == BYTEA in postgres
        allowNull: false,
      },
      signed_payload: {
        type: DataTypes.BLOB, // == BYTEA in postgres
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
      price_per_block: {
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
      },
      payee: {
        type: DataTypes.CHAR(40),
        allowNull: false,
      },
      payer: {
        type: DataTypes.CHAR(40),
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
      },
      last_allocation_id: {
        type: DataTypes.CHAR(40),
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
