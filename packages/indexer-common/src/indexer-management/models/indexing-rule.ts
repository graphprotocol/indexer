/* eslint-disable @typescript-eslint/no-empty-interface */

import { DataTypes, Model, Optional, Sequelize } from 'sequelize'
import { processIdentifier, SubgraphIdentifierType } from '../../subgraphs'

export enum IndexingDecisionBasis {
  RULES = 'rules',
  NEVER = 'never',
  ALWAYS = 'always',
  OFFCHAIN = 'offchain',
}

export const INDEXING_RULE_GLOBAL = 'global'

export interface IndexingRuleAttributes {
  id: number
  identifier: string
  identifierType: SubgraphIdentifierType
  allocationAmount: string | null
  allocationLifetime: number | null
  autoRenewal: boolean
  parallelAllocations: number | null
  maxAllocationPercentage: number | null
  minSignal: string | null
  maxSignal: string | null
  minStake: string | null
  minAverageQueryFees: string | null
  custom: string | null
  decisionBasis: IndexingDecisionBasis
  requireSupported: boolean
}

export interface IndexingRuleCreationAttributes
  extends Optional<
    IndexingRuleAttributes,
    | 'id'
    | 'identifier'
    | 'identifierType'
    | 'allocationAmount'
    | 'allocationLifetime'
    | 'autoRenewal'
    | 'parallelAllocations'
    | 'maxAllocationPercentage'
    | 'minSignal'
    | 'maxSignal'
    | 'minStake'
    | 'minAverageQueryFees'
    | 'custom'
    | 'decisionBasis'
    | 'requireSupported'
  > {}

export class IndexingRule
  extends Model<IndexingRuleAttributes, IndexingRuleCreationAttributes>
  implements IndexingRuleAttributes
{
  public id!: number
  public identifier!: string
  public identifierType!: SubgraphIdentifierType
  public allocationAmount!: string | null
  public allocationLifetime!: number | null
  public autoRenewal!: boolean
  public parallelAllocations!: number | null
  public maxAllocationPercentage!: number | null
  public minSignal!: string | null
  public maxSignal!: string | null
  public minStake!: string | null
  public minAverageQueryFees!: string | null
  public custom!: string | null
  public decisionBasis!: IndexingDecisionBasis
  public requireSupported!: boolean

  public createdAt!: Date
  public updatedAt!: Date

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return { ...this.toJSON(), __typename: 'IndexingRule' }
  }

  public mergeGlobal(global: IndexingRule | null): IndexingRule {
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
      return { ...rule } as IndexingRule
    } else {
      return this
    }
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

export interface IndexingRuleModels {
  IndexingRule: typeof IndexingRule
}

export const defineIndexingRuleModels = (sequelize: Sequelize): IndexingRuleModels => {
  IndexingRule.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        unique: true,
      },
      identifier: {
        type: DataTypes.STRING,
        primaryKey: true,
        unique: true,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isSubgraphIdentifier: async (value: any) => {
            await processIdentifier(value, { all: false, global: true })
          },
        },
      },
      identifierType: {
        type: DataTypes.ENUM('deployment', 'subgraph', 'group'),
        defaultValue: 'group',
      },
      allocationAmount: {
        type: DataTypes.DECIMAL,
        allowNull: true,
        validate: {
          min: 0.0,
        },
      },
      allocationLifetime: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: {
          min: 1,
        },
      },
      autoRenewal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      parallelAllocations: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
          max: 20,
          emitDeprecationWarning: (value: number) => {
            if (value > 1) {
              throw new Error(
                'Parallel allocations are soon to be fully deprecated. Please set parallel allocations to 1 for all your indexing rules',
              )
            }
          },
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
        type: DataTypes.ENUM('rules', 'never', 'always', 'offchain'),
        allowNull: false,
        defaultValue: 'rules',
      },
      requireSupported: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      modelName: 'IndexingRule',
      sequelize,
    },
  )

  return {
    ['IndexingRule']: IndexingRule,
  }
}
