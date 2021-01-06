/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { BigNumber, utils } from 'ethers'

export interface POIDisputeAttributes {
  allocationID: string
  allocationIndexer: string
  allocationAmount: BigNumber
  allocationProof: string
  allocationClosedBlockHash: string
  indexerProof: string
  status: string
}

export interface POIDisputeCreationAttributes
  extends Optional<
    POIDisputeAttributes,
    | 'allocationID'
    | 'allocationIndexer'
    | 'allocationAmount'
    | 'allocationProof'
    | 'allocationClosedBlockHash'
    | 'indexerProof'
    | 'status'
  > {}

export class POIDispute
  extends Model<POIDisputeAttributes, POIDisputeCreationAttributes>
  implements POIDisputeAttributes {
  public allocationID!: string
  public allocationIndexer!: string
  public allocationAmount!: BigNumber
  public allocationProof!: string
  public allocationClosedBlockHash!: string
  public indexerProof!: string
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
            if (utils.isHexString(value, 32)) {
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
            if (utils.isHexString(value, 32)) {
              return
            }

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
      allocationClosedBlockHash: {
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
      indexerProof: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Indexer reference POI must be a string')
            }

            // "0x..." is ok
            if (utils.isHexString(value, 32)) {
              return
            }

            throw new Error(`Indexer reference POI must be a valid hex string`)
          },
        },
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
