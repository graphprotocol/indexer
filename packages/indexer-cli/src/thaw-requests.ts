import { formatGRT, commify } from '@graphprotocol/common-ts'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { OutputFormat, parseOutputFormat, pickFields } from './command-helpers'
import { resolveChainAlias } from '@graphprotocol/indexer-common'

export interface IndexerThawRequest {
  id: string
  fulfilled: string
  dataService: string
  indexer: string
  shares: string
  thawingUntil: string
  protocolNetwork: string
}

const THAW_REQUEST_FORMATTERS: Record<
  keyof IndexerThawRequest,
  (x: never) => string | null
> = {
  id: nullPassThrough(x => x),
  fulfilled: nullPassThrough(x => x),
  dataService: nullPassThrough(x => x),
  indexer: nullPassThrough(x => x),
  shares: x => commify(formatGRT(x)),
  thawingUntil: x => new Date(Number(x) * 1000).toLocaleString(),
  protocolNetwork: resolveChainAlias,
}

/**
 * Formats an indexer thaw request for display in the console.
 */
export const formatIndexerThawRequest = (
  thawRequest: Partial<IndexerThawRequest>,
): Partial<IndexerThawRequest> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(thawRequest)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (THAW_REQUEST_FORMATTERS as any)[key](value)
  }

  return obj as Partial<IndexerThawRequest>
}

export const printIndexerThawRequests = (
  print: GluegunPrint,
  outputFormat: OutputFormat,
  thawRequestOrThawRequests:
    | Partial<IndexerThawRequest>
    | Partial<IndexerThawRequest>[]
    | null,
  keys: (keyof IndexerThawRequest)[],
): void => {
  parseOutputFormat(print, outputFormat)
  if (Array.isArray(thawRequestOrThawRequests)) {
    const thawRequests = thawRequestOrThawRequests.map(thawRequest =>
      formatIndexerThawRequest(pickFields(thawRequest, keys)),
    )
    print.info(displayIndexerThawRequests(outputFormat, thawRequests))
  } else if (thawRequestOrThawRequests) {
    const thawRequest = formatIndexerThawRequest(
      pickFields(thawRequestOrThawRequests, keys),
    )
    print.info(displayIndexerThawRequest(outputFormat, thawRequest))
  } else {
    print.error(`No thaw requests found`)
  }
}

export const displayIndexerThawRequests = (
  outputFormat: OutputFormat,
  thawRequests: Partial<IndexerThawRequest>[],
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(thawRequests, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(thawRequests).trim()
    : thawRequests.length === 0
    ? 'No thaw requests found'
    : table(
        [
          Object.keys(thawRequests[0]),
          ...thawRequests.map(thawRequest => Object.values(thawRequest)),
        ],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()

export const displayIndexerThawRequest = (
  outputFormat: OutputFormat,
  thawRequest: Partial<IndexerThawRequest>,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(thawRequest, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(thawRequest).trim()
    : table([Object.keys(thawRequest), Object.values(thawRequest)], {
        border: getBorderCharacters('norc'),
      }).trim()

function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}
