/* eslint-disable @typescript-eslint/no-empty-interface */

import { Optional, Model, DataTypes, Sequelize } from 'sequelize'
import { isHexString } from 'ethers'
import { caip2IdRegex } from '../../parsers'

export interface POIDisputeAttributes {
  allocationID: string
  subgraphDeploymentID: string
  allocationIndexer: string
  allocationAmount: string
  allocationProof: string
  closedEpoch: number
  closedEpochReferenceProof: string | null
  closedEpochStartBlockHash: string
  closedEpochStartBlockNumber: number
  previousEpochReferenceProof: string | null
  previousEpochStartBlockHash: string
  previousEpochStartBlockNumber: number
  status: string
  protocolNetwork: string
}

// Unambiguously identify a POI Dispute in the Database.
// This type should match the POIDispute primary key columns.
export interface POIDisputeIdentifier {
  allocationID: string
  protocolNetwork: string
}

export interface POIDisputeCreationAttributes
  extends Optional<
    POIDisputeAttributes,
    | 'allocationID'
    | 'subgraphDeploymentID'
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
    | 'protocolNetwork'
  > {}

export class POIDispute
  extends Model<POIDisputeAttributes, POIDisputeCreationAttributes>
  implements POIDisputeAttributes
{
  public allocationID!: string
  public subgraphDeploymentID!: string
  public allocationIndexer!: string
  public allocationAmount!: string
  public allocationProof!: string
  public closedEpoch!: number
  public closedEpochReferenceProof!: string | null
  public closedEpochStartBlockHash!: string
  public closedEpochStartBlockNumber!: number
  public previousEpochReferenceProof!: string | null
  public previousEpochStartBlockHash!: string
  public previousEpochStartBlockNumber!: number
  public status!: string
  public protocolNetwork!: string

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
        unique: true,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation ID must be a string')
            }

            // "0x..." is ok
            if (isHexString(value, 20)) {
              return
            }

            throw new Error(`Allocation ID must be a valid hex string`)
          },
        },
      },
      subgraphDeploymentID: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHex: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Subgraph deployment ID must be a string')
            }

            return
          },
        },
      },
      allocationIndexer: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isValid: (value: any) => {
            if (typeof value !== 'string') {
              throw new Error('Allocation Indexer ID must be a string')
            }

            // "0x..." is ok
            if (isHexString(value, 20)) {
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
            if (isHexString(value, 32)) {
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
        allowNull: true,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHexOrNull: (value: any) => {
            if (value && typeof value !== 'string') {
              throw new Error('Allocation POI must be a string or null')
            }

            // null or "0x..." is ok
            if (!value || isHexString(value, 32)) {
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
            if (isHexString(value, 32)) {
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
        allowNull: true,
        validate: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          isHexOrNull: (value: any) => {
            if (value && typeof value !== 'string') {
              throw new Error('Allocation POI must be a string or null')
            }

            // null or "0x..." is ok
            if (!value || isHexString(value, 32)) {
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
            if (isHexString(value, 32)) {
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
      protocolNetwork: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
          is: caip2IdRegex,
        },
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
