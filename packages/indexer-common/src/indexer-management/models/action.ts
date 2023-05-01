/* eslint-disable @typescript-eslint/no-empty-interface */

import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
  Sequelize,
} from 'sequelize'
import { ActionStatus, ActionType } from '@graphprotocol/indexer-common'

export class Action extends Model<
  InferAttributes<Action>,
  InferCreationAttributes<Action>
> {
  declare id: CreationOptional<number>
  declare status: ActionStatus
  declare type: ActionType
  declare priority: CreationOptional<number> // default 0

  declare source: string // component name
  declare reason: string // reason for the action

  declare deploymentID: string
  declare allocationID: string | null
  declare amount: string | null
  declare poi: string | null
  declare force: boolean | null

  declare transaction: string | null // Transaction id for completed transactions otherwise null
  declare failureReason: string | null

  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>

  declare protocolNetwork: string | null

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return { ...this.toJSON(), __typename: 'Action' }
  }
}

export interface ActionModels {
  Action: typeof Action
}

export const defineActionModels = (sequelize: Sequelize): ActionModels => {
  Action.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        unique: true,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM(
          ActionType.ALLOCATE,
          ActionType.UNALLOCATE,
          ActionType.REALLOCATE,
        ),
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isValidActionType: async (value: any) => {
            if (Object.values(ActionType).includes(value)) {
              return Promise.resolve('valid')
            } else {
              throw Error(`Invalid Action Type: ${value}`)
            }
          },
        },
      },
      status: {
        type: DataTypes.ENUM(
          ActionStatus.SUCCESS,
          ActionStatus.FAILED,
          ActionStatus.QUEUED,
          ActionStatus.APPROVED,
          ActionStatus.PENDING,
          ActionStatus.CANCELED,
        ),
        allowNull: false,
        defaultValue: 'queued',
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isValidActionStatus: async (value: any) => {
            if (Object.values(ActionStatus).includes(value)) {
              return Promise.resolve('valid')
            } else {
              throw Error(`Invalid Action Status: ${value}`)
            }
          },
        },
      },
      priority: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      deploymentID: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      allocationID: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      amount: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      poi: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      force: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      reason: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
      },
      updatedAt: {
        type: DataTypes.DATE,
      },
      transaction: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      failureReason: {
        type: DataTypes.STRING(1000),
        allowNull: true,
        defaultValue: null,
      },
      protocolNetwork: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      modelName: 'Action',
      sequelize,
      validate: {
        requiredActionParams() {
          switch (this.type) {
            case ActionType.ALLOCATE:
              if (this.deploymentID === null || this.amount === null) {
                throw new Error(
                  `ActionType.ALLOCATE action must have required params: ['deploymentID','amount']`,
                )
              }
              break
            case ActionType.UNALLOCATE:
              if (this.deploymentID === null || this.allocationID === null) {
                throw new Error(
                  `ActionType.UNALLOCATE action must have required params: ['deploymentID','allocationID']`,
                )
              }
              break
            case ActionType.REALLOCATE:
              if (
                this.deploymentID === null ||
                this.allocationID === null ||
                this.amount === null
              ) {
                throw new Error(
                  `ActionType.REALLOCATE action must have required params: ['deploymentID','allocationID', 'amount]`,
                )
              }
          }
        },
      },
    },
  )

  return {
    ['Action']: Action,
  }
}
