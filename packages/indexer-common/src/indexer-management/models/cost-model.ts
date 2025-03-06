/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'

export interface GraphQLCostModel {
  deployment: string
  model: string | null | undefined
}

export const parseGraphQLCostModel = (
  costModel: GraphQLCostModel,
): CostModelCreationAttributes => {
  try {
    return {
      deployment: costModel.deployment,
      model: costModel.model || null,
    }
  } catch (error) {
    throw new Error(`Failed to parse GraphQL cost model: ${error}`)
  }
}

export const COST_MODEL_GLOBAL = 'global'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CostModelVariables = { [key: string]: any }

export interface CostModelAttributes {
  id: number
  deployment: string
  model: string | null
}

export interface CostModelCreationAttributes
  extends Optional<CostModelAttributes, 'id' | 'deployment'> {}

export class CostModel
  extends Model<CostModelAttributes, CostModelCreationAttributes>
  implements CostModelAttributes
{
  public id!: number
  public deployment!: string
  public model!: string | null
  public variables!: CostModelVariables | null

  public createdAt!: Date
  public updatedAt!: Date

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return {
      ...this.toJSON(),
      __typename: 'CostModel',
    }
  }
}

export interface CostModelModels {
  CostModel: typeof CostModel
}

export const defineCostModelModels = (sequelize: Sequelize): CostModelModels => {
  CostModel.init(
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
        unique: true,
      },
      deployment: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isDeploymentID: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Deployment ID must be a string')
            }

            // "0x..." and "global" is ok
            if (utils.isHexString(value, 32) || value === COST_MODEL_GLOBAL) {
              return
            }

            throw new Error(
              `Deployment ID must be a valid subgraph deployment ID or "global"`,
            )
          },
        },
      },
      model: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      modelName: 'CostModelsHistory',
      freezeTableName: true,
      sequelize,
    },
  )

  return { ['CostModel']: CostModel }
}
