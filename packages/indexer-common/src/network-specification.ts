import { toAddress, parseGRT } from '@graphprotocol/common-ts'
import { BigNumber } from 'ethers'
import { validateNetworkIdentifier, validateIpfsHash } from './parsers'
import { AllocationManagementMode } from './types'
import { z } from 'zod'
import { utils } from 'ethers'

// TODO: make sure those values are always in sync with the AllocationManagementMode enum. Can we do this in compile time?
const ALLOCATION_MANAGEMENT_MODE = ['auto', 'manual', 'oversight'] as const

function positiveNumber(): z.ZodNumber {
  return z.number().positive().finite()
}

function GRT(): z.ZodEffects<z.ZodNumber, BigNumber, number> {
  return z
    .number()
    .nonnegative()
    .finite()
    .transform((x) => parseGRT(x.toString()))
}

// Gateway endpoints
export const Gateway = z
  .object({
    url: z.string().url(),
  })
  .strict()
export type Gateway = z.infer<typeof Gateway>

// Indexer identification and network behavior options
export const IndexerOptions = z
  .object({
    address: z
      .string()
      .refine((val) => utils.isAddress(val), {
        message: 'Invalid contract address',
      })
      .transform(toAddress),
    mnemonic: z.string(),
    url: z.string().url(),
    geoCoordinates: z.number().array().length(2).default([31.780715, -41.179504]),
    restakeRewards: z.boolean().default(true),
    rebateClaimThreshold: GRT().default(1),
    rebateClaimBatchThreshold: GRT().default(5),
    rebateClaimMaxBatchSize: positiveNumber().default(100),
    poiDisputeMonitoring: z.boolean().default(false),
    poiDisputableEpochs: positiveNumber().default(1),
    defaultAllocationAmount: GRT().default(0.1),
    voucherRedemptionThreshold: GRT().default(1),
    voucherRedemptionBatchThreshold: GRT().default(5),
    voucherRedemptionMaxBatchSize: positiveNumber().default(100),
    allocationManagementMode: z
      .enum(ALLOCATION_MANAGEMENT_MODE)
      .default('auto')
      .transform((x) => x as AllocationManagementMode),
    autoAllocationMinBatchSize: positiveNumber().default(1),
    allocateOnNetworkSubgraph: z.boolean().default(false),
    register: z.boolean().default(true),
    finalityTime: positiveNumber().default(3600),
  })
  .strict()
export type IndexerOptions = z.infer<typeof IndexerOptions>

// Transaction handling options
export const TransactionMonitoring = z
  .object({
    gasIncreaseTimeout: positiveNumber()
      .default(240)
      .transform((x) => x * 10 ** 3),
    gasIncreaseFactor: positiveNumber().default(1.2),
    gasPriceMax: positiveNumber()
      .default(100)
      .transform((x) => x * 10 ** 9),
    baseFeePerGasMax: positiveNumber()
      .default(100)
      .transform((x) => x * 10 ** 9)
      .optional(),
    maxTransactionAttempts: z.number().nonnegative().finite().default(0),
  })
  .strict()
  .default({}) // defaults will be used for instantiation when the TransactionMonitoring group is absent.

export type TransactionMonitoring = z.infer<typeof TransactionMonitoring>

const UnvalidatedSubgraph = z.object({
  url: z.string().url().optional(),
  deployment: z.string().transform(transformIpfsHash).optional(),
})

// Generic subgraph specification
export const Subgraph = UnvalidatedSubgraph.refine(
  (obj) => !(!obj.url && !obj.deployment),
  {
    message: 'At least one of `url` or `deployment` must be set',
  },
)

// Optional subgraph specification
export const OptionalSubgraph = UnvalidatedSubgraph.optional().superRefine((obj, ctx) => {
  // Nested optionals with zod *actually* result in an instance of any parent objects.
  // This collides with the validation we have where we manually refine the object to have at least one of the properties.

  // zod provides obj: { url: undefined } when the optional subgraph is not defined.
  if (
    obj &&
    ((Object.prototype.hasOwnProperty.call(obj, 'url') && obj['url'] === undefined) ||
      (Object.prototype.hasOwnProperty.call(obj, 'deployment') &&
        obj['deployment'] === undefined))
  ) {
    return
  }

  if (obj && !(obj.url || obj.deployment)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'At least one of `url` or `deployment` must be set (IF the optional subgraph is defined)',
    })
  }
})

export type OptionalSubgraph = z.infer<typeof OptionalSubgraph>
export type Subgraph = z.infer<typeof Subgraph>

// All pertinent subgraphs in the protocol
export const ProtocolSubgraphs = z
  .object({
    maxBlockDistance: z.number().nonnegative().finite().default(0),
    freshnessSleepMilliseconds: positiveNumber().default(5_000),
    networkSubgraph: Subgraph,
    epochSubgraph: Subgraph,
    tapSubgraph: OptionalSubgraph,
  })
  .strict()
  // TODO: Ensure the `url` property is always defined until Epoch Subgraph
  // indexing is supported.
  .refine((subgraphs) => subgraphs.epochSubgraph.url, {
    message: 'Epoch Subgraph endpoint must be defined',
    path: ['epochSubgraph', 'url'],
  })
export type ProtocolSubgraphs = z.infer<typeof ProtocolSubgraphs>

export const TapContracts = z
  .record(
    z.string(),
    z.object({
      TAPVerifier: z.string().refine((val) => utils.isAddress(val), {
        message: 'Invalid contract address',
      }),
      AllocationIDTracker: z.string().refine((val) => utils.isAddress(val), {
        message: 'Invalid contract address',
      }),
      Escrow: z.string().refine((val) => utils.isAddress(val), {
        message: 'Invalid contract address',
      }),
    }),
  )
  .optional()
export type TapContracts = z.infer<typeof TapContracts>

export const NetworkProvider = z
  .object({
    url: z.string().url(),
    pollingInterval: positiveNumber().default(4 * 10 ** 3),
  })
  .strict()
export type NetworkProvider = z.infer<typeof NetworkProvider>

export const Dai = z
  .object({
    contractAddress: z
      .string()
      .default('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
      .refine((val) => utils.isAddress(val), {
        message: 'Invalid contract address',
      })
      .transform(toAddress),
    inject: z.boolean().default(true),
  })
  .strict()
  .default({}) // defaults will be used for instantiation when the Dai group is absent.
export type Dai = z.infer<typeof Dai>

// All necessary information to describe a Protocol Network
export const NetworkSpecification = z
  .object({
    networkIdentifier: z.string().transform(transformNetworkIdentifier),
    gateway: Gateway,
    indexerOptions: IndexerOptions,
    transactionMonitoring: TransactionMonitoring,
    subgraphs: ProtocolSubgraphs,
    networkProvider: NetworkProvider,
    addressBook: z.string().optional(),
    tapAddressBook: TapContracts.optional(),
    allocationSyncInterval: positiveNumber().default(120000),
    dai: Dai,
  })
  .strict()

export type NetworkSpecification = z.infer<typeof NetworkSpecification>

function transformNetworkIdentifier(input: string, ctx: z.RefinementCtx): string {
  try {
    return validateNetworkIdentifier(input)
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid network identifier',
    })
    return z.NEVER
  }
}

function transformIpfsHash(input: string, ctx: z.RefinementCtx): string {
  try {
    return validateIpfsHash(input)
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid IPFS hash',
    })
    return z.NEVER
  }
}
