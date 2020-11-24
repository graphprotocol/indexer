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
}

export class IndexerError extends CustomError {
  public code: IndexerErrorCode
  public explanation: string
  public cause?: Error

  constructor(code: IndexerErrorCode, cause?: Error) {
    super(INDEXER_ERROR_MESSAGES[code])
    this.code = code
    this.explanation = `${ERROR_BASE_URL}#${code.toLowerCase()}`
    this.cause = cause

    if (indexerErrorMetrics) {
      indexerErrorMetrics.error.inc({ code: this.code })
    }
  }
}

export function indexerError(code: IndexerErrorCode, cause?: Error): IndexerError {
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
