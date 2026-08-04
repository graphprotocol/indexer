import { DataTypes, Sequelize, Model, InferAttributes } from 'sequelize'

export class PendingRcaProposal extends Model<InferAttributes<PendingRcaProposal>> {
  declare id: string
  declare signed_payload: Buffer
  declare version: number
  declare status: string
  declare created_at: Date
  declare updated_at: Date
}

export const definePendingRcaProposalModel = (
  sequelize: Sequelize,
): typeof PendingRcaProposal => {
  PendingRcaProposal.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
      },
      signed_payload: {
        type: DataTypes.BLOB,
        allowNull: false,
      },
      version: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        defaultValue: 2,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      modelName: 'PendingRcaProposal',
      sequelize,
      tableName: 'pending_rca_proposals',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  )

  return PendingRcaProposal
}
