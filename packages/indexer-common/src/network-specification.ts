import { toAddress } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'
import { validateNetworkIdentifier, validateIpfsHash } from './parsers'
import { z } from 'zod'

// TODO: make sure those values are always in sync with the AllocationManagementMode enum. Can we do this in compile time?
const ALLOCATION_MANAGEMENT_MODE = ['auto', 'manual', 'oversight'] as const

// Gateway endpoints
export const Gateway = z
  .object({
    baseUrl: z.string().url(),
  })
  .strict()
export type Gateway = z.infer<typeof Gateway>

// Indexer identification and network behavior options
export const IndexerOptions = z
  .object({
    address: z.string().transform(toAddress),
    mnemonic: z.string(),
    url: z.string().url(),
    geoCoordinates: z.string().array().length(2),
    restakeRewards: z.boolean(),
    rebateClaimThreshold: z.string().transform(BigNumber.from),
    rebateClaimBatchThreshold: z.string().transform(BigNumber.from),
    rebateClaimMaxBatchSize: z.number(),
    poiDisputeMonitoring: z.boolean(),
    poiDisputableEpochs: z.number(),
    defaultAllocationAmount: z.string().transform(BigNumber.from),
    voucherRedemptionThreshold: z.string().transform(BigNumber.from),
    voucherRedemptionBatchThreshold: z.string().transform(BigNumber.from),
    voucherRedemptionMaxBatchSize: z.number(),
    allocationManagementMode: z.enum(ALLOCATION_MANAGEMENT_MODE),
    autoAllocationMinBatchSize: z.number(),
  })
  .strict()
export type IndexerOptions = z.infer<typeof IndexerOptions>

// Transaction handling options
export const TransactionMonitoring = z
  .object({
    gasIncreaseTimeout: z.number(),
    gasIncreaseFactor: z.number(),
    baseFeePerGasMax: z.number(),
    maxTransactionAttempts: z.number(),
  })
  .strict()
export type TransactionMonitoring = z.infer<typeof TransactionMonitoring>

// Generic subgraph specification
export const Subgraph = z
  .object({
    url: z.string().url().optional(),
    deployment: z.string().refine(validateIpfsHash).optional(),
  })
  .strict()
  .refine((obj) => !(!obj.url && !obj.deployment), {
    message: 'At least one of `url` or `deployment` must be set',
  })

export type Subgraph = z.infer<typeof Subgraph>

// All pertinent subgraphs in the protocol
export const ProtocolSubgraphs = z
  .object({
    networkSubgraph: Subgraph,
    epochSubgraph: Subgraph,
  })
  .strict()
export type ProtocolSubgraphs = z.infer<typeof ProtocolSubgraphs>

export const NetworkProvider = z
  .object({
    url: z.string().url(),
  })
  .strict()
export type NetworkProvider = z.infer<typeof NetworkProvider>

export const Dai = z
  .object({
    contractAddress: z.string().transform(toAddress),
  })
  .strict()
export type Dai = z.infer<typeof Dai>

// All necessary information to describe a Protocol Network
export const NetworkSpecification = z
  .object({
    networkIdentifier: z.string().refine(validateNetworkIdentifier),
    gateway: Gateway,
    indexerOptions: IndexerOptions,
    transactionMonitoring: TransactionMonitoring,
    subgraphs: ProtocolSubgraphs,
    networkProvider: NetworkProvider,
    dai: Dai.optional(),
  })
  .strict()
export type NetworkSpecification = z.infer<typeof NetworkSpecification>
