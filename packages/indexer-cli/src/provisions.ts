import { formatGRT, commify } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { OutputFormat, parseOutputFormat, pickFields } from './command-helpers'
import { resolveChainAlias } from '@graphprotocol/indexer-common'
import { BigNumberish } from 'ethers'

function formatPPM(x: BigNumberish): string {
  return ((Number(x) / 1_000_000) * 100).toString()
}

export interface IndexerProvision {
  id: string
  dataService: string
  indexer: string
  tokensProvisioned: bigint
  tokensAllocated: bigint
  tokensThawing: bigint
  maxVerifierCut: bigint
  thawingPeriod: bigint

  protocolNetwork: string
}

const PROVISION_CONVERTERS_FROM_GRAPHQL: Record<
  keyof IndexerProvision,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  dataService: x => x,
  indexer: x => x,
  tokensProvisioned: nullPassThrough((x: string) => BigInt(x)),
  tokensAllocated: nullPassThrough((x: string) => BigInt(x)),
  tokensThawing: nullPassThrough((x: string) => BigInt(x)),
  maxVerifierCut: nullPassThrough((x: string) => BigInt(x)),
  thawingPeriod: nullPassThrough((x: string) => BigInt(x)),
  protocolNetwork: x => x,
}

const PROVISION_FORMATTERS: Record<keyof IndexerProvision, (x: never) => string | null> =
  {
    id: nullPassThrough(x => x),
    dataService: nullPassThrough(x => x),
    indexer: nullPassThrough(x => x),
    tokensProvisioned: x => commify(formatGRT(x)),
    tokensAllocated: x => commify(formatGRT(x)),
    tokensThawing: x => commify(formatGRT(x)),
    maxVerifierCut: x => commify(formatPPM(x)),
    thawingPeriod: x => x,
    protocolNetwork: resolveChainAlias,
  }

/**
 * Formats an indexer provision for display in the console.
 */
export const formatIndexerProvision = (
  provision: Partial<IndexerProvision>,
): Partial<IndexerProvision> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(provision)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (PROVISION_FORMATTERS as any)[key](value)
  }

  return obj as Partial<IndexerProvision>
}

/**
 * Parses an indexer provision returned from the indexer management GraphQL
 * API into normalized form.
 */
export const indexerProvisionFromGraphQL = (
  provision: Partial<IndexerProvision>,
): Partial<IndexerProvision> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(pickFields(provision, []))) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (PROVISION_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as Partial<IndexerProvision>
}

export const printIndexerProvisions = (
  print: GluegunPrint,
  outputFormat: OutputFormat,
  provisionOrProvisions: Partial<IndexerProvision> | Partial<IndexerProvision>[] | null,
  keys: (keyof IndexerProvision)[],
): void => {
  parseOutputFormat(print, outputFormat)
  if (Array.isArray(provisionOrProvisions)) {
    const provisions = provisionOrProvisions.map(provision =>
      formatIndexerProvision(pickFields(provision, keys)),
    )
    print.info(displayIndexerProvisions(outputFormat, provisions))
  } else if (provisionOrProvisions) {
    const provision = formatIndexerProvision(pickFields(provisionOrProvisions, keys))
    print.info(displayIndexerProvision(outputFormat, provision))
  } else {
    print.error(`No provisions found`)
  }
}

export const displayIndexerProvisions = (
  outputFormat: OutputFormat,
  provisions: Partial<IndexerProvision>[],
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(provisions, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(provisions).trim()
    : provisions.length === 0
    ? 'No provisions found'
    : table(
        [
          Object.keys(provisions[0]),
          ...provisions.map(provision => Object.values(provision)),
        ],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()

export const displayIndexerProvision = (
  outputFormat: OutputFormat,
  provision: Partial<IndexerProvision>,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(provision, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(provision).trim()
    : table([Object.keys(provision), Object.values(provision)], {
        border: getBorderCharacters('norc'),
      }).trim()

function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}
