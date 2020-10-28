/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'

export interface GraphQLCostModel {
  deployment: string
  model: string | null | undefined
  variables: string | null | undefined
}

export const parseGraphQLCostModel = (
  costModel: GraphQLCostModel,
): CostModelCreationAttributes => {
  try {
    const variables = !costModel.variables
      ? costModel.variables
      : JSON.parse(costModel.variables)

    return {
      deployment: costModel.deployment,
      model: costModel.model || null,
      variables: variables,
    }
  } catch (error) {
    throw new Error(`Failed to parse GraphQL cost model: ${error}`)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CostModelVariables = { [key: string]: any }

export interface CostModelAttributes {
  id: number
  deployment: string
  model: string | null
  variables: CostModelVariables | null
}

export interface CostModelCreationAttributes
  extends Optional<CostModelAttributes, 'id' | 'deployment'> {}

export class CostModel
  extends Model<CostModelAttributes, CostModelCreationAttributes>
  implements CostModelAttributes {
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
      variables:
        this.variables === null ? this.variables : JSON.stringify(this.variables),
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
        type: DataTypes.INTEGER,
        autoIncrement: true,
        unique: true,
      },
      deployment: {
        type: DataTypes.STRING,
        allowNull: true,
        primaryKey: true,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isDeploymentID: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Deployment ID must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Deployment ID must be a valid subgraph deployment ID`)
          },
        },
      },
      model: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      variables: {
        type: DataTypes.JSONB,
        allowNull: true,
        validate: {
          isObject: (value: unknown | null) => {
            if (value === null || value === undefined) {
              return
            }

            if (value instanceof Object && !(value instanceof Array)) {
              return
            }

            throw new Error(`Variables must be a valid object or null`)
          },
        },
      },
    },
    {
      modelName: 'CostModel',
      sequelize,
    },
  )

  return { ['CostModel']: CostModel }
}
