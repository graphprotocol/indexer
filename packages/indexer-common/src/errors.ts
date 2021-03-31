import { CustomError } from 'ts-custom-error'
import { Counter } from 'prom-client'
import { Metrics } from '@graphprotocol/common-ts'

interface IndexerErrorMetrics {
  error: Counter<string>
}

let indexerErrorMetrics: IndexerErrorMetrics | undefined

const ERROR_BASE_URL = `https://github.com/graphprotocol/indexer/blob/master/docs/errors.md`

export enum IndexerErrorCode {
  IE001 = 'IE001',
  IE002 = 'IE002',
  IE003 = 'IE003',
  IE004 = 'IE004',
  IE005 = 'IE005',
  IE006 = 'IE006',
  IE007 = 'IE007',
  IE008 = 'IE008',
  IE009 = 'IE009',
  IE010 = 'IE010',
  IE011 = 'IE011',
  IE012 = 'IE012',
  IE013 = 'IE013',
  IE014 = 'IE014',
  IE015 = 'IE015',
  IE016 = 'IE016',
  IE017 = 'IE017',
  IE018 = 'IE018',
  IE019 = 'IE019',
  IE020 = 'IE020',
  IE021 = 'IE021',
  IE022 = 'IE022',
  IE023 = 'IE023',
  IE024 = 'IE024',
  IE025 = 'IE025',
  IE026 = 'IE026',
  IE027 = 'IE027',
  IE028 = 'IE028',
  IE029 = 'IE029',
  IE030 = 'IE030',
  IE031 = 'IE031',
  IE032 = 'IE032',
  IE033 = 'IE033',
  IE034 = 'IE034',
  IE035 = 'IE035',
  IE036 = 'IE036',
  IE037 = 'IE037',
  IE038 = 'IE038',
  IE039 = 'IE039',
  IE040 = 'IE040',
  IE041 = 'IE041',
  IE042 = 'IE042',
  IE043 = 'IE043',
  IE044 = 'IE044',
  IE045 = 'IE045',
  IE046 = 'IE046',
  IE047 = 'IE047',
  IE048 = 'IE048',
  IE049 = 'IE049',
  IE050 = 'IE050',
  IE051 = 'IE051',
  IE052 = 'IE052',
}

export const INDEXER_ERROR_MESSAGES: Record<IndexerErrorCode, string> = {
  IE001: 'Failed to run database migrations',
  IE002: 'Invalid Ethereum URL',
  IE003: 'Failed to index network subgraph',
  IE004: 'Failed to synchronize with network',
  IE005: 'Failed to reconcile indexer and network',
  IE006: 'Failed to cross-check allocation state with contracts',
  IE007: 'Failed to check for network pause',
  IE008: 'Failed to check operator status for indexer',
  IE009: 'Failed to query subgraph deployments worth indexing',
  IE010: 'Failed to query indexer allocations',
  IE011: 'Failed to query claimable indexer allocations',
  IE012: 'Failed to register indexer',
  IE013: 'Failed to allocate: insufficient free stake',
  IE014: 'Failed to allocate: allocation not created on chain',
  IE015: 'Failed to close allocation',
  IE016: 'Failed to claim allocation',
  IE017: 'Failed to ensure default global indexing rule',
  IE018: 'Failed to query indexing status API',
  IE019: 'Failed to query proof of indexing',
  IE020: 'Failed to ensure subgraph deployment is indexing',
  IE021: 'Failed to migrate cost model',
  IE022: 'Failed to identify attestation signer for allocation',
  IE023: 'Failed to handle state channel message',
  IE024: 'Failed to connect to indexing status API',
  IE025: 'Failed to query indexer management API',
  IE026: 'Failed to deploy subgraph deployment',
  IE027: 'Failed to remove subgraph deployment',
  IE028: 'Failed to reassign subgraph deployment',
  IE029: 'Invalid X-Graph-Payment header provided',
  IE030: 'No X-Graph-Payment header provided',
  IE031: 'Invalid X-Graph-Payment value provided',
  IE032: 'Failed to process paid query',
  IE033: 'Failed to process free query',
  IE034: 'Not authorized as an operator for the indexer',
  IE035: 'Unhandled promise rejection',
  IE036: 'Unhandled exception',
  IE037: 'Failed to query disputable allocations',
  IE038: 'Failed to query epochs',
  IE039: 'Failed to store potential POI disputes',
  IE040: 'Failed to fetch POI disputes',
  IE041: 'Failed to query transfers to resolve',
  IE042: 'Failed to add transfer to the database',
  IE043: 'Failed to mark transfer as resolved',
  IE044: 'Failed to collect query fees on chain',
  IE045: 'Failed to queue transfers for resolving',
  IE046: 'Failed to resolve transfer',
  IE047: 'Failed to mark transfer as failed',
  IE048: 'Failed to withdraw query fees for allocation',
  IE049: 'Failed to clean up transfers for allocation',
  IE050:
    'Transaction reverted: gas limit likely hit (cumulative gas used is near the gas limit)',
  IE051: 'Transaction reverted: reason unknown',
  IE052: 'Transaction aborted: maximum configured gas price reached',
}

export type IndexerErrorCause = unknown

export class IndexerError extends CustomError {
  public code: IndexerErrorCode
  public explanation: string
  public cause?: IndexerErrorCause

  constructor(code: IndexerErrorCode, cause?: IndexerErrorCause) {
    super(INDEXER_ERROR_MESSAGES[code])
    this.code = code
    this.explanation = `${ERROR_BASE_URL}#${code.toLowerCase()}`
    this.cause = cause

    if (indexerErrorMetrics) {
      indexerErrorMetrics.error.inc({ code: this.code })
    }
  }
}

export function indexerError(
  code: IndexerErrorCode,
  cause?: IndexerErrorCause,
): IndexerError {
  return new IndexerError(code, cause)
}

export function registerIndexerErrorMetrics(metrics: Metrics): void {
  indexerErrorMetrics = {
    error: new metrics.client.Counter({
      name: 'indexer_error',
      help: 'Indexer errors observed over time',
      labelNames: ['code'],
      registers: [metrics.registry],
    }),
  }
}
