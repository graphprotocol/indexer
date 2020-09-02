/* eslint-disable @typescript-eslint/no-empty-interface */

import bs58 from 'bs58'
import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'

export enum IndexingDecisionBasis {
  RULES = 'rules',
  NEVER = 'never',
  ALWAYS = 'always',
}

export const INDEXING_RULE_GLOBAL = 'global'

export interface IndexingRuleAttributes {
  id: number
  deployment: string
  allocationAmount: string | null
  parallelAllocations: number | null
  maxAllocationPercentage: number | null
  minSignal: string | null
  maxSignal: string | null
  minStake: string | null
  minAverageQueryFees: string | null
  custom: string | null
  decisionBasis: IndexingDecisionBasis
}

export interface IndexingRuleCreationAttributes
  extends Optional<
    IndexingRuleAttributes,
    | 'id'
    | 'allocationAmount'
    | 'parallelAllocations'
    | 'maxAllocationPercentage'
    | 'minSignal'
    | 'maxSignal'
    | 'minStake'
    | 'minAverageQueryFees'
    | 'custom'
    | 'decisionBasis'
  > {}

export class IndexingRule
  extends Model<IndexingRuleAttributes, IndexingRuleCreationAttributes>
  implements IndexingRuleAttributes {
  public id!: number
  public deployment!: string
  public allocationAmount!: string | null
  public parallelAllocations!: number | null
  public maxAllocationPercentage!: number | null
  public minSignal!: string | null
  public maxSignal!: string | null
  public minStake!: string | null
  public minAverageQueryFees!: string | null
  public custom!: string | null
  public decisionBasis!: IndexingDecisionBasis

  public createdAt!: Date
  public updatedAt!: Date

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return { ...this.toJSON(), __typename: 'IndexingRule' }
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public mergeToGraphQL(global: IndexingRule | null): object {
    if (global instanceof IndexingRule) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globalRule: { [key: string]: any } | null = global.toJSON()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule: { [key: string]: any } | null = this.toJSON()
      for (const k in globalRule) {
        if (null == rule[k]) {
          rule[k] = globalRule[k]
        }
      }
      for (const k in rule) {
        if (rule[k] == undefined) {
          rule[k] = globalRule[k]
        }
      }
      return { ...rule, __typename: 'IndexingRule' }
    } else {
      return this.toGraphQL()
    }
  }
}

export const models = {
  ['IndexingRule']: IndexingRule,
}

export type IndexerManagementModels = typeof models

export const defineIndexerManagementModels = (
  sequelize: Sequelize,
): IndexerManagementModels => {
  IndexingRule.init(
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
          isDeploymentID: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Deployment ID must be a string')
            }

            // "global" is ok
            if (value === 'global') {
              return
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(
              `Deployment ID must be "global" or a valid subgraph deployment ID`,
            )
          },
        },
      },
      allocationAmount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      parallelAllocations: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
          max: 20,
        },
      },
      maxAllocationPercentage: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: {
          isFloat: true,
          min: 0.0,
          max: 1.0,
        },
      },
      minSignal: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      minStake: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      maxSignal: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      minAverageQueryFees: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      custom: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      decisionBasis: {
        type: DataTypes.ENUM('rules', 'never', 'always'),
        allowNull: false,
        defaultValue: 'rules',
      },
    },
    {
      modelName: 'IndexingRule',
      sequelize,
    },
  )

  return models
}
