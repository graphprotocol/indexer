/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { utils } from 'ethers'

export interface POIDisputeAttributes {
  allocationID: string
  allocationIndexer: string
  allocationAmount: string
  allocationProof: string
  closedEpoch: number
  closedEpochReferenceProof: string
  closedEpochStartBlockHash: string
  closedEpochStartBlockNumber: number
  previousEpochReferenceProof: string
  previousEpochStartBlockHash: string
  previousEpochStartBlockNumber: number
  status: string
}

export interface POIDisputeCreationAttributes
  extends Optional<
    POIDisputeAttributes,
    | 'allocationID'
    | 'allocationIndexer'
    | 'allocationAmount'
    | 'allocationProof'
    | 'closedEpoch'
    | 'closedEpochReferenceProof'
    | 'closedEpochStartBlockHash'
    | 'closedEpochStartBlockNumber'
    | 'previousEpochReferenceProof'
    | 'previousEpochStartBlockHash'
    | 'previousEpochStartBlockNumber'
    | 'status'
  > {}

export class POIDispute
  extends Model<POIDisputeAttributes, POIDisputeCreationAttributes>
  implements POIDisputeAttributes {
  public allocationID!: string
  public allocationIndexer!: string
  public allocationAmount!: string
  public allocationProof!: string
  public closedEpoch!: number
  public closedEpochReferenceProof!: string
  public closedEpochStartBlockHash!: string
  public closedEpochStartBlockNumber!: number
  public previousEpochReferenceProof!: string
  public previousEpochStartBlockHash!: string
  public previousEpochStartBlockNumber!: number
  public status!: string

  public createdAt!: Date
  public updatedAt!: Date

  // eslint-disable-next-line @typescript-eslint/ban-types
  public toGraphQL(): object {
    return { ...this.toJSON(), __typename: 'POIDispute' }
  }
}

export interface POIDisputeModels {
  POIDispute: typeof POIDispute
}

export const definePOIDisputeModels = (sequelize: Sequelize): POIDisputeModels => {
  POIDispute.init(
    {
      allocationID: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation ID must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 20)) {
              return
            }

            throw new Error(`Allocation ID must be a valid hex string`)
          },
        },
      },
      allocationIndexer: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation Indexer ID must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 20)) {
              return
            }

            //TODO: Ensure this error message gets logged when this throws (repeat for each validation function)
            throw new Error(`Allocation Indexer ID must be a valid hex string`)
          },
        },
      },
      allocationAmount: {
        type: DataTypes.DECIMAL,
        allowNull: false,
        validate: {
          min: 0.0,
        },
      },
      allocationProof: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation POI must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Allocation POI must be a valid hex string`)
          },
        },
      },
      closedEpoch: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      closedEpochReferenceProof: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation POI must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Allocation POI must be a valid hex string`)
          },
        },
      },
      closedEpochStartBlockHash: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation closed block hash must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Allocation closed block hash must be a valid hex string`)
          },
        },
      },
      closedEpochStartBlockNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      previousEpochReferenceProof: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation POI must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Allocation POI must be a valid hex string`)
          },
        },
      },
      previousEpochStartBlockHash: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation closed block hash must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Allocation closed block hash must be a valid hex string`)
          },
        },
      },
      previousEpochStartBlockNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      modelName: 'POIDispute',
      sequelize,
    },
  )

  return {
    ['POIDispute']: POIDispute,
  }
}
