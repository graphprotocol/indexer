import {
  AllocationReceiptCollector,
  defineQueryFeeModels,
  GraphNode,
  Network,
  QueryFeeModels,
  QueryResult,
} from '@graphprotocol/indexer-common'
import {
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  toAddress,
} from '@graphprotocol/common-ts'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { Sequelize } from 'sequelize'
import { utils } from 'ethers'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never
let logger: Logger
let receiptCollector: AllocationReceiptCollector
let metrics: Metrics
let queryFeeModels: QueryFeeModels
let sequelize: Sequelize
const timeout = 30000

const startRAVProcessing = jest.spyOn(
  AllocationReceiptCollector.prototype,
  'startRAVProcessing',
)
const setup = async () => {
  logger = createLogger({
    name: 'Indexer API Client',
    async: false,
    level: __LOG_LEVEL__ ?? 'error',
  })
  metrics = createMetrics()
  // Clearing the registry prevents duplicate metric registration in the default registry.
  metrics.registry.clear()
  sequelize = await connectDatabase(__DATABASE__)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
    [],
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    queryFeeModels,
    graphNode,
    metrics,
    sequelize.getQueryInterface(),
  )
  receiptCollector = network.receiptCollector
}

const rav = {
  allocationId: toAddress('edde47df40c29949a75a6693c77834c00b8ad626'),
  last: true,
  final: false,
  timestampNs: 1709067401177959664n,
  valueAggregate: 20000000000000n,
  signature: Buffer.from(
    'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
    'hex',
  ),
  senderAddress: toAddress('ffcf8fdee72ac11b5c542428b35eef5769c409f0'),
  redeemedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
  await queryFeeModels.receiptAggregateVouchers.create(rav)
}
const teardownEach = async () => {
  // Clear out query fee model tables
  await queryFeeModels.receiptAggregateVouchers.truncate({ cascade: true })
}

const teardownAll = async () => {
  await sequelize.drop({})
}

describe('TAP', () => {
  beforeAll(setup, timeout)
  beforeEach(setupEach, timeout)
  afterEach(teardownEach, timeout)
  afterAll(teardownAll, timeout)
  test(
    'test if startRAVProcessing is called',
    async () => {
      expect(startRAVProcessing).toHaveBeenCalled()
    },
    timeout,
  )

  test(
    'test getPendingRAVs',
    async () => {
      const ravs = await receiptCollector['pendingRAVs']()

      expect(ravs).toEqual([
        expect.objectContaining({
          allocationId: rav.allocationId,
          final: rav.final,
          last: rav.last,
          senderAddress: rav.senderAddress,
          signature: rav.signature,
          timestampNs: rav.timestampNs,
          valueAggregate: rav.valueAggregate,
        }),
      ])
    },
    timeout,
  )

  test(
    'test ignore final rav',
    async () => {
      const date = new Date()
      const redeemDate = date.setHours(date.getHours() - 2)
      const rav2 = {
        allocationId: toAddress('dead47df40c29949a75a6693c77834c00b8ad624'),
        last: true,
        final: true,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: Buffer.from(
          'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
          'hex',
        ),
        senderAddress: toAddress('deadbeefcafedeadceefcafedeadbeefcafedead'),
        redeemedAt: new Date(redeemDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)
      const ravs = await receiptCollector['pendingRAVs']()
      // The point is it will only return the rav that is not final
      expect(ravs.length).toEqual(1)
      expect(ravs).toEqual([
        expect.objectContaining({
          allocationId: rav.allocationId,
          final: rav.final,
          last: rav.last,
          senderAddress: rav.senderAddress,
          signature: rav.signature,
          timestampNs: rav.timestampNs,
          valueAggregate: rav.valueAggregate,
        }),
      ])
    },
    timeout,
  )

  test(
    'test mark rav as pending after reorg',
    async () => {
      // Re org will be simulated by marking rav as redeemed but not showing in subgraph
      const date = new Date()
      const redeemDate = date.setHours(date.getHours() - 2)
      const rav2 = {
        allocationId: toAddress('dead47df40c29949a75a6693c77834c00b8ad624'),
        last: true,
        final: false,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: Buffer.from(
          'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
          'hex',
        ),
        senderAddress: toAddress('deadbeefcafedeadceefcafedeadbeefcafedead'),
        redeemedAt: new Date(redeemDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)
      const ravs = await receiptCollector['pendingRAVs']()
      // The point is it will only return the rav that is not final
      expect(ravs).toEqual([
        expect.objectContaining({
          allocationId: rav.allocationId,
          final: rav.final,
          last: rav.last,
          senderAddress: rav.senderAddress,
          signature: rav.signature,
          timestampNs: rav.timestampNs,
          valueAggregate: rav.valueAggregate,
        }),
        // Since rav2 is returned it removed the redeemedAt field
        expect.objectContaining({
          allocationId: rav2.allocationId,
          final: rav2.final,
          last: rav2.last,
          senderAddress: rav2.senderAddress,
          signature: rav2.signature,
          timestampNs: rav2.timestampNs,
          valueAggregate: rav2.valueAggregate,
          redeemedAt: null,
        }),
      ])
    },
    timeout,
  )

  test(
    'check signature rav',
    async () => {
      const domain = {
        name: 'TAP',
        version: '1',
        chainId: 1337,
        verifyingContract: toAddress('0x5aeef48fe943f91c39a7609049f8968f5b84414e'),
      }
      const [first] = await queryFeeModels.receiptAggregateVouchers.findAll()
      const signedRav = first.getSignedRAV()

      const signerAddress = utils.verifyTypedData(
        domain,
        {
          ReceiptAggregateVoucher: [
            { name: 'allocationId', type: 'address' },
            { name: 'timestampNs', type: 'uint64' },
            { name: 'valueAggregate', type: 'uint128' },
          ],
        },
        signedRav.rav,
        signedRav.signature,
      )

      expect(signerAddress).toEqual('0x886574712d0ca20C36FD090A594Df7eCa17cd38e')
    },
    timeout,
  )

  test(
    'test mark final rav',
    async () => {
      const anotherFuncSpy = jest
        .spyOn(receiptCollector.tapSubgraph!, 'query')
        .mockImplementation(async (): Promise<QueryResult<unknown>> => {
          return {
            data: {
              transactions: [
                { allocationID: '0xdead47df40c29949a75a6693c77834c00b8ad624' },
              ],
            },
          }
        })

      const date = new Date()
      const redeemDate = date.setHours(date.getHours() - 2)
      const rav2 = {
        allocationId: toAddress('dead47df40c29949a75a6693c77834c00b8ad624'),
        last: true,
        final: false,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: Buffer.from(
          'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
          'hex',
        ),
        senderAddress: toAddress('deadbeefcafedeadceefcafedeadbeefcafedead'),
        redeemedAt: new Date(redeemDate),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)
      const ravs = await receiptCollector['pendingRAVs']()
      expect(anotherFuncSpy).toBeCalled()
      const finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
        where: { last: true, final: true },
      })
      //Final rav wont be returned here
      expect(ravs).toEqual([
        expect.objectContaining({
          allocationId: rav.allocationId,
          final: rav.final,
          last: rav.last,
          senderAddress: rav.senderAddress,
          signature: rav.signature,
          timestampNs: rav.timestampNs,
          valueAggregate: rav.valueAggregate,
        }),
      ])
      // Expect final rav to be returned here
      expect(finalRavs).toEqual([
        expect.objectContaining({
          allocationId: rav2.allocationId,
          final: true,
          last: rav2.last,
          senderAddress: rav2.senderAddress,
          signature: rav2.signature,
          timestampNs: rav2.timestampNs,
          valueAggregate: rav2.valueAggregate,
        }),
      ])
    },
    timeout,
  )
})
