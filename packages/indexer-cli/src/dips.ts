import { SubgraphDeploymentID, formatGRT, commify } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { OutputFormat, parseOutputFormat, pickFields, wrapCell } from './command-helpers'
import { resolveChainAlias } from '@graphprotocol/indexer-common'

export interface IndexingAgreement {
  id: string
  payer: string
  indexer: string
  allocationId: string
  subgraphDeploymentId: string
  state: string
  acceptedAt: string
  lastCollectionAt: string
  endsAt: string
  tokensPerSecond: bigint
  tokensCollected: bigint
  canceledAt: string
  canceledBy: string
  protocolNetwork: string
}

const AGREEMENT_FORMATTERS: Record<
  keyof IndexingAgreement,
  (x: never) => string | null
> = {
  id: x => x,
  payer: x => x,
  indexer: x => x,
  allocationId: x => x,
  subgraphDeploymentId: (d: string) => new SubgraphDeploymentID(d).ipfsHash,
  state: x => x,
  acceptedAt: x => x,
  lastCollectionAt: x => x,
  endsAt: x => x,
  tokensPerSecond: x => commify(formatGRT(x)),
  tokensCollected: x => commify(formatGRT(x)),
  canceledAt: x => x,
  canceledBy: x => x,
  protocolNetwork: resolveChainAlias,
}

export const formatIndexingAgreement = (
  agreement: Partial<IndexingAgreement>,
): Partial<IndexingAgreement> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(agreement)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (AGREEMENT_FORMATTERS as any)[key](value)
  }
  return obj as Partial<IndexingAgreement>
}

export const printIndexingAgreements = (
  print: GluegunPrint,
  outputFormat: OutputFormat,
  agreementOrAgreements:
    | Partial<IndexingAgreement>
    | Partial<IndexingAgreement>[]
    | null,
  keys: (keyof IndexingAgreement)[],
  wrapWidth: number = 0,
): void => {
  parseOutputFormat(print, outputFormat)
  if (Array.isArray(agreementOrAgreements)) {
    const agreements = agreementOrAgreements.map(agreement =>
      formatIndexingAgreement(pickFields(agreement, keys)),
    )
    print.info(displayIndexingAgreements(outputFormat, agreements, wrapWidth))
  } else if (agreementOrAgreements) {
    const agreement = formatIndexingAgreement(pickFields(agreementOrAgreements, keys))
    print.info(displayIndexingAgreement(outputFormat, agreement, wrapWidth))
  } else {
    print.error(`No agreements found`)
  }
}

export const displayIndexingAgreements = (
  outputFormat: OutputFormat,
  agreements: Partial<IndexingAgreement>[],
  wrapWidth: number,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(agreements, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(agreements).trim()
    : agreements.length === 0
    ? 'No agreements found'
    : table(
        [
          Object.keys(agreements[0]),
          ...agreements.map(agreement =>
            Object.values(agreement).map(value => wrapCell(value, wrapWidth)),
          ),
        ],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()

export const displayIndexingAgreement = (
  outputFormat: OutputFormat,
  agreement: Partial<IndexingAgreement>,
  wrapWidth: number,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(agreement, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(agreement).trim()
    : table(
        [
          Object.keys(agreement),
          Object.values(agreement).map(value => wrapCell(value, wrapWidth)),
        ],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()
