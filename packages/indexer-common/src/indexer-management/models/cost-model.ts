/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'
import { validateNetworkIdentifier } from '../../parsers/validators'

export interface GraphQLCostModel {
  deployment: string
  model: string | null | undefined
  variables: string | null | undefined
  protocolNetwork: string
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
      protocolNetwork: costModel.protocolNetwork,
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
  variables: CostModelVariables | null
  protocolNetwork: string
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
  public protocolNetwork!: string

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
        allowNull: false,
        primaryKey: true,
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
      protocolNetwork: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isProtocolNetwork: (value: string) => {
            if (typeof value !== 'string') {
              throw new Error('Protocol network must be a string')
            }

            // must be `eip155:`
            if (validateNetworkIdentifier(value)) {
              return
            }

            throw new Error(`Protocol network must be a valid 'eip155' network`)
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
