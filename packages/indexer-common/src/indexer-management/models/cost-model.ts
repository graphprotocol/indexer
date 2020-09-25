/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'

export interface CostModelAttributes {
  id: number
  deployment: string
  model: string | null
  variables: string | null
}

export interface CostModelCreationAttributes
  extends Optional<CostModelAttributes, 'id' | 'deployment'> {}

export class CostModel
  extends Model<CostModelAttributes, CostModelCreationAttributes>
  implements CostModelAttributes {
  public id!: number
  public deployment!: string
  public model!: string | null
  public variables!: string | null

  public createdAt!: Date
  public updatedAt!: Date

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return { ...this.toJSON(), __typename: 'CostModel' }
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
        type: DataTypes.STRING,
        allowNull: true,
      },
      variables: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      modelName: 'CostModel',
      sequelize,
    },
  )

  return { ['CostModel']: CostModel }
}
