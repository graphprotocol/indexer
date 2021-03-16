import {
  IndexerManagementClient, POIDisputeAttributes, indexerError, IndexerErrorCode,
} from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'

const DISPUTE_FORMATTERS: Record<
  keyof POIDisputeAttributes,
  (x: never) => string
  > = {
  allocationID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => x,
  allocationProof: x => x,
  closedEpoch: x => x,
  closedEpochReferenceProof: x => x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => x,
  previousEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => x,
  status: x => x,
}

const DISPUTES_CONVERTERS_FROM_GRAPHQL: Record<
  keyof POIDisputeAttributes,
  (x: never) => string | number
  > = {
  allocationID: x => x,
  allocationIndexer: x => x,
  allocationAmount: x => +x,
  allocationProof: x => x,
  closedEpoch: x => +x,
  closedEpochReferenceProof: x => x,
  closedEpochStartBlockHash: x => x,
  closedEpochStartBlockNumber: x => +x,
  previousEpochReferenceProof: x => x,
  previousEpochStartBlockHash: x => x,
  previousEpochStartBlockNumber: x => +x,
  status: x => x,
}


/**
 * Formats a dispute for display in the console.
 */
export const formatDispute = (
  rule: Partial<POIDisputeAttributes>,
): Partial<POIDisputeAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(rule)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (DISPUTE_FORMATTERS as any)[key](value)
  }
  return obj as Partial<POIDisputeAttributes>
}


/**
 * Parses a POI dispute returned from the indexer management GraphQL
 * API into normalized form.
 */
const disputeFromGraphQL = (
  dispute: Partial<POIDisputeAttributes>,
): POIDisputeAttributes => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(dispute)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (DISPUTES_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as POIDisputeAttributes
}


export const displayDisputes = (
  outputFormat: 'table' | 'json' | 'yaml',
  disputes: Partial<POIDisputeAttributes>[],
): string =>
  outputFormat === 'json'
    ? JSON.stringify(disputes, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(disputes).trim()
    : disputes.length === 0
      ? 'No data'
      : table([Object.keys(disputes[0]), ...disputes.map(dispute => Object.values(dispute))], {
        border: getBorderCharacters('norc'),
      }).trim()


export const displayDispute = (
  outputFormat: 'table' | 'json' | 'yaml',
  dispute: Partial<POIDisputeAttributes>,
): string =>
  outputFormat === 'json'
    ? JSON.stringify(dispute, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(dispute).trim()
    : table([Object.keys(dispute), Object.values(dispute)], {
      border: getBorderCharacters('norc'),
    }).trim()

export const printDisputes = (
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  disputes: Partial<POIDisputeAttributes>[] | null,
): void => {
  if (Array.isArray(disputes)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedDisputes = disputes.map(dispute => formatDispute(dispute))
    print.info(displayDisputes(outputFormat, formattedDisputes))
  } else if (disputes) {
    const dispute = formatDispute(disputes)
    print.info(displayDispute(outputFormat, dispute))
  } else {
    print.error(`No disputes found`)
  }
}

export const disputes = async (
  client: IndexerManagementClient
): Promise<Partial<POIDisputeAttributes>[]> => {
    try {
      console.log('tryinnnggg')
        const result = await client
        .query(
          gql`
            query disputes {
              disputes {
                allocationID
                allocationIndexer
                allocationAmount
                allocationProof
                closedEpoch
                closedEpochStartBlockHash
                closedEpochStartBlockNumber
                closedEpochReferenceProof
                previousEpochStartBlockHash
                previousEpochStartBlockNumber
                previousEpochReferenceProof
                status
              }
            }
          `,
          {},
        )
        .toPromise()

      console.log(result)
      if (result.error) {
        throw result.error
      }

      console.log('yeeet')

      return result.data.disputes.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dispute: Record<string, any>) => {
          return disputeFromGraphQL(dispute)
        },
      )
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE040, error)
      throw err
    }
}
