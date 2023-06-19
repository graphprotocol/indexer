/* eslint-disable @typescript-eslint/explicit-module-boundary-types */

import { SubgraphDeploymentID } from '@tokene-q/common-ts'

export interface Signature {
  v: number
  r: string
  s: string
}

export interface QueryResult {
  graphQLResponse: string
  attestation: Signature | null
}

export interface UnattestedQueryResult {
  graphQLResponse: string
  attestable: boolean
}

export type Response<T> = {
  result: T
  status: number
}

export interface FreeQuery {
  subgraphDeploymentID: SubgraphDeploymentID
  query: string
}

export type PaidQuery = FreeQuery & {
  receipt: string
}

export interface QueryProcessor {
  executeFreeQuery(query: FreeQuery): Promise<Response<UnattestedQueryResult>>
  executePaidQuery(query: PaidQuery): Promise<Response<QueryResult>>
}

export class QueryError extends Error {
  status: number

  constructor(message: string, status?: number) {
    super(message)

    this.status = status || 500

    // Manually set the prototype, following the recommendation on
    // https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, QueryError.prototype)
  }
}
