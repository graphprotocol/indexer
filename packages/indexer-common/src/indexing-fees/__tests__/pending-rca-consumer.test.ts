import { ethers } from 'ethers'
import { createLogger, Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { PendingRcaConsumer } from '../pending-rca-consumer'
import { PendingRcaProposal } from '../../indexer-management/models/pending-rca-proposal'

// ABI tuple types matching toolshed's recurring-collector.js
const RCA_TUPLE =
  'tuple(uint64 deadline, uint64 endsAt, address payer, address dataService, address serviceProvider, uint256 maxInitialTokens, uint256 maxOngoingTokensPerSecond, uint32 minSecondsPerCollection, uint32 maxSecondsPerCollection, uint16 conditions, uint256 nonce, bytes metadata)'
const SIGNED_RCA_TUPLE = `tuple(${RCA_TUPLE} rca, bytes signature)`
const ACCEPT_METADATA_TUPLE =
  'tuple(bytes32 subgraphDeploymentId, uint8 version, bytes terms)'
const TERMS_V1_TUPLE = 'tuple(uint256 tokensPerSecond, uint256 tokensPerEntityPerSecond)'

const coder = ethers.AbiCoder.defaultAbiCoder()

// Test data
const TEST_PAYER = '0x1234567890abcdef1234567890abcdef12345678'
const TEST_DATA_SERVICE = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
const TEST_SERVICE_PROVIDER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const TEST_DEPLOYMENT_BYTES32 =
  '0x0100000000000000000000000000000000000000000000000000000000000000'
const TEST_SIGNATURE = '0xaabbccdd'

function encodeTestPayload(overrides?: {
  deadline?: bigint
  endsAt?: bigint
  tokensPerSecond?: bigint
  tokensPerEntityPerSecond?: bigint
  minSecondsPerCollection?: number
  maxSecondsPerCollection?: number
}): Buffer {
  const tokensPerSecond = overrides?.tokensPerSecond ?? 1000n
  const tokensPerEntityPerSecond = overrides?.tokensPerEntityPerSecond ?? 50n

  const termsEncoded = coder.encode(
    [TERMS_V1_TUPLE],
    [{ tokensPerSecond, tokensPerEntityPerSecond }],
  )

  const metadataEncoded = coder.encode(
    [ACCEPT_METADATA_TUPLE],
    [
      {
        subgraphDeploymentId: TEST_DEPLOYMENT_BYTES32,
        version: 0n,
        terms: termsEncoded,
      },
    ],
  )

  const signedRcaEncoded = coder.encode(
    [SIGNED_RCA_TUPLE],
    [
      {
        rca: {
          deadline: overrides?.deadline ?? 1700000000n,
          endsAt: overrides?.endsAt ?? 1800000000n,
          payer: TEST_PAYER,
          dataService: TEST_DATA_SERVICE,
          serviceProvider: TEST_SERVICE_PROVIDER,
          maxInitialTokens: 10000n,
          maxOngoingTokensPerSecond: 100n,
          minSecondsPerCollection: overrides?.minSecondsPerCollection ?? 3600,
          maxSecondsPerCollection: overrides?.maxSecondsPerCollection ?? 86400,
          conditions: 0n,
          nonce: 42n,
          metadata: metadataEncoded,
        },
        signature: TEST_SIGNATURE,
      },
    ],
  )

  return Buffer.from(ethers.getBytes(signedRcaEncoded))
}

let logger: Logger

beforeAll(() => {
  logger = createLogger({
    name: 'PendingRcaConsumer Test',
    async: false,
    level: 'error',
  })
})

function createMockModel(rows: Partial<PendingRcaProposal>[] = []) {
  return {
    findAll: jest.fn().mockResolvedValue(rows),
    update: jest.fn().mockResolvedValue([1]),
  } as unknown as typeof PendingRcaProposal
}

describe('PendingRcaConsumer', () => {
  describe('getPendingProposals', () => {
    test('decodes valid pending proposals', async () => {
      const payload = encodeTestPayload()
      const model = createMockModel([
        {
          id: 'test-uuid-1',
          signed_payload: payload,
          version: 2,
          status: 'pending',
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ])

      const consumer = new PendingRcaConsumer(logger, model)
      const proposals = await consumer.getPendingProposals()

      expect(proposals).toHaveLength(1)
      const p = proposals[0]

      expect(p.id).toBe('test-uuid-1')
      expect(p.status).toBe('pending')
      expect(p.payer.toLowerCase()).toBe(TEST_PAYER.toLowerCase())
      expect(p.serviceProvider.toLowerCase()).toBe(TEST_SERVICE_PROVIDER.toLowerCase())
      expect(p.dataService.toLowerCase()).toBe(TEST_DATA_SERVICE.toLowerCase())
      expect(p.deadline).toBe(1700000000n)
      expect(p.endsAt).toBe(1800000000n)
      expect(p.maxInitialTokens).toBe(10000n)
      expect(p.maxOngoingTokensPerSecond).toBe(100n)
      expect(p.minSecondsPerCollection).toBe(3600n)
      expect(p.maxSecondsPerCollection).toBe(86400n)
      expect(p.nonce).toBe(42n)
      expect(p.tokensPerSecond).toBe(1000n)
      expect(p.tokensPerEntityPerSecond).toBe(50n)

      expect(p.subgraphDeploymentId).toBeInstanceOf(SubgraphDeploymentID)
      expect(p.subgraphDeploymentId.bytes32).toBe(TEST_DEPLOYMENT_BYTES32)

      expect(p.signedRca).toBeDefined()
      expect(p.signedRca.rca.payer.toLowerCase()).toBe(TEST_PAYER.toLowerCase())
      expect(p.signedRca.signature).toBe(TEST_SIGNATURE)

      expect(p.signedPayload).toBeInstanceOf(Uint8Array)
    })

    test('queries only pending rows', async () => {
      const model = createMockModel([])
      const consumer = new PendingRcaConsumer(logger, model)

      await consumer.getPendingProposals()

      expect(model.findAll).toHaveBeenCalledWith({
        where: { status: 'pending' },
      })
    })

    test('skips rows with corrupt payloads and logs warning', async () => {
      const warnSpy = jest.fn()
      const testLogger = {
        ...logger,
        warn: warnSpy,
        child: () => testLogger,
      } as unknown as Logger

      const model = createMockModel([
        {
          id: 'good-uuid',
          signed_payload: encodeTestPayload(),
          version: 2,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'bad-uuid',
          signed_payload: Buffer.from('deadbeef', 'hex'),
          version: 2,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ])

      const consumer = new PendingRcaConsumer(testLogger, model)
      const proposals = await consumer.getPendingProposals()

      expect(proposals).toHaveLength(1)
      expect(proposals[0].id).toBe('good-uuid')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('bad-uuid'),
        expect.any(Object),
      )
    })

    test('decodes multiple proposals', async () => {
      const model = createMockModel([
        {
          id: 'uuid-1',
          signed_payload: encodeTestPayload({ tokensPerSecond: 100n }),
          version: 2,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'uuid-2',
          signed_payload: encodeTestPayload({ tokensPerSecond: 200n }),
          version: 2,
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ])

      const consumer = new PendingRcaConsumer(logger, model)
      const proposals = await consumer.getPendingProposals()

      expect(proposals).toHaveLength(2)
      expect(proposals[0].tokensPerSecond).toBe(100n)
      expect(proposals[1].tokensPerSecond).toBe(200n)
    })
  })

  describe('markAccepted', () => {
    test('updates status to accepted', async () => {
      const model = createMockModel()
      const consumer = new PendingRcaConsumer(logger, model)

      await consumer.markAccepted('test-uuid')

      expect(model.update).toHaveBeenCalledWith(
        { status: 'accepted' },
        { where: { id: 'test-uuid' } },
      )
    })
  })

  describe('markRejected', () => {
    test('updates status to rejected', async () => {
      const model = createMockModel()
      const consumer = new PendingRcaConsumer(logger, model)

      await consumer.markRejected('test-uuid', 'deployment blocklisted')

      expect(model.update).toHaveBeenCalledWith(
        { status: 'rejected' },
        { where: { id: 'test-uuid' } },
      )
    })

    test('updates status without reason', async () => {
      const model = createMockModel()
      const consumer = new PendingRcaConsumer(logger, model)

      await consumer.markRejected('test-uuid')

      expect(model.update).toHaveBeenCalledWith(
        { status: 'rejected' },
        { where: { id: 'test-uuid' } },
      )
    })
  })
})
