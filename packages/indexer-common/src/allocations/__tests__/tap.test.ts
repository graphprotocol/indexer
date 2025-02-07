import {
  defineQueryFeeModels,
  GraphNode,
  Network,
  EscrowAccounts,
  QueryFeeModels,
  TapSubgraphResponse,
  TapCollector,
  Allocation,
  defineIndexerManagementModels,
} from '@graphprotocol/indexer-common'
import {
  Address,
  connectDatabase,
  createLogger,
  createMetrics,
  Logger,
  Metrics,
  toAddress,
} from '@graphprotocol/common-ts'
import { testNetworkSpecification } from '../../indexer-management/__tests__/util'
import { Op, Sequelize } from 'sequelize'
import { utils } from 'ethers'

// Make global Jest variables available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
declare const __LOG_LEVEL__: never
let logger: Logger
let tapCollector: TapCollector
let metrics: Metrics
let queryFeeModels: QueryFeeModels
let sequelize: Sequelize
const timeout = 30000

const startRAVProcessing = jest.spyOn(TapCollector.prototype, 'startRAVProcessing')
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
  const models = defineIndexerManagementModels(sequelize)
  queryFeeModels = defineQueryFeeModels(sequelize)
  sequelize = await sequelize.sync({ force: true })

  const graphNode = new GraphNode(
    logger,
    'https://test-admin-endpoint.xyz',
    'https://test-query-endpoint.xyz',
    'https://test-status-endpoint.xyz',
  )

  const network = await Network.create(
    logger,
    testNetworkSpecification,
    models,
    queryFeeModels,
    graphNode,
    metrics,
  )
  tapCollector = network.tapCollector!
}

const ALLOCATION_ID_1 = toAddress('edde47df40c29949a75a6693c77834c00b8ad626')
const ALLOCATION_ID_2 = toAddress('dead47df40c29949a75a6693c77834c00b8ad624')
const ALLOCATION_ID_3 = toAddress('6aea8894b5ab5a36cdc2d8be9290046801dd5fed')

const SENDER_ADDRESS_1 = toAddress('ffcf8fdee72ac11b5c542428b35eef5769c409f0')
const SENDER_ADDRESS_2 = toAddress('dead47df40c29949a75a6693c77834c00b8ad624')
const SENDER_ADDRESS_3 = toAddress('6aea8894b5ab5a36cdc2d8be9290046801dd5fed')

// last rav not redeemed
const rav = {
  allocationId: ALLOCATION_ID_1,
  last: true,
  final: false,
  timestampNs: 1709067401177959664n,
  valueAggregate: 20000000000000n,
  signature: Buffer.from(
    'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
    'hex',
  ),
  senderAddress: SENDER_ADDRESS_1,
  redeemedAt: null,
}

const SIGNATURE = Buffer.from(
  'ede3f7ca5ace3629009f190bb51271f30c1aeaf565f82c25c447c7c9501f3ff31b628efcaf69138bf12960dd663924a692ee91f401785901848d8d7a639003ad1b',
  'hex',
)

const setupEach = async () => {
  sequelize = await sequelize.sync({ force: true })
  await queryFeeModels.receiptAggregateVouchers.create(rav)

  jest
    .spyOn(tapCollector, 'findTransactionsForRavs')
    .mockImplementation(async (): Promise<TapSubgraphResponse> => {
      return {
        transactions: [],
        _meta: {
          block: {
            timestamp: Date.now(),
            hash: 'str',
          },
        },
      }
    })
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
      const ravs = await tapCollector['pendingRAVs']()

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

  test('`revertRavsRedeemed` should revert RAV redeem status in DB only if older than subgraph last block', async () => {
    // we have a redeemed non-final rav in our database
    const nowSecs = Math.floor(Date.now() / 1000)
    // redeemed rav but non-final
    const ravList = [
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_1,
        new Date((nowSecs - 1) * 1000),
      ),
      createLastNonFinalRav(ALLOCATION_ID_3, SENDER_ADDRESS_2, new Date(nowSecs * 1000)),
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_3,
        new Date((nowSecs + 1) * 1000),
      ),
    ]

    await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravList)

    // it's not showing on the subgraph on a specific point in time
    // the timestamp of the subgraph is greater than the receipt id
    // should revert the rav
    await tapCollector['revertRavsRedeemed'](ravList, nowSecs - 1)

    let lastRedeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    expect(lastRedeemedRavs).toEqual([
      expect.objectContaining(ravList[0]),
      expect.objectContaining(ravList[1]),
      expect.objectContaining(ravList[2]),
    ])

    await tapCollector['revertRavsRedeemed'](ravList, nowSecs)

    lastRedeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    expect(lastRedeemedRavs).toEqual([
      expect.objectContaining(ravList[1]),
      expect.objectContaining(ravList[2]),
    ])

    await tapCollector['revertRavsRedeemed'](ravList, nowSecs + 1)

    lastRedeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    expect(lastRedeemedRavs).toEqual([expect.objectContaining(ravList[2])])

    await tapCollector['revertRavsRedeemed'](ravList, nowSecs + 2)

    lastRedeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    expect(lastRedeemedRavs).toEqual([])
  })

  test('revertRavsRedeemed` should not revert the RAV redeem status in DB if (allocation, sender) not in the revert list', async () => {
    const nowSecs = Math.floor(Date.now() / 1000)
    const ravList = [
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_1,
        new Date((nowSecs - 1) * 1000),
      ),
      createLastNonFinalRav(ALLOCATION_ID_3, SENDER_ADDRESS_2, new Date(nowSecs * 1000)),
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_3,
        new Date((nowSecs + 1) * 1000),
      ),
    ]

    await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravList)

    // it's showing on the subgraph on a specific point in time
    await tapCollector['revertRavsRedeemed'](
      [
        {
          allocationId: ALLOCATION_ID_1,
          senderAddress: SENDER_ADDRESS_1,
        },
      ],
      nowSecs + 2,
    )
    // the timestamp of the subgraph is greater than the receipt id
    // should not revert the rav

    const lastRedeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    expect(lastRedeemedRavs).toEqual([
      expect.objectContaining(ravList[0]),
      expect.objectContaining(ravList[1]),
      expect.objectContaining(ravList[2]),
    ])
  })

  test('should mark ravs as redeemed via `markRavsInTransactionsAsRedeemed`', async () => {
    const nowSecs = Math.floor(Date.now() / 1000)
    const transactions = {
      transactions: [
        {
          id: 'test',
          allocationID: ALLOCATION_ID_2.toString().toLowerCase().replace('0x', ''),
          timestamp: nowSecs,
          sender: {
            id: SENDER_ADDRESS_3.toString().toLowerCase().replace('0x', ''),
          },
        },
      ],
      _meta: {
        block: {
          timestamp: nowSecs,
          hash: 'test',
        },
      },
    }

    const rav2 = {
      allocationId: ALLOCATION_ID_2,
      last: true,
      final: false,
      timestampNs: 1709067401177959664n,
      valueAggregate: 20000000000000n,
      signature: SIGNATURE,
      senderAddress: SENDER_ADDRESS_3,
      redeemedAt: null,
    }
    await queryFeeModels.receiptAggregateVouchers.create(rav2)
    const ravs = await tapCollector['pendingRAVs']()
    await tapCollector['markRavsInTransactionsAsRedeemed'](transactions, ravs)
    const redeemedRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: {
        last: true,
        final: false,
        redeemedAt: {
          [Op.ne]: null,
        },
      },
    })
    // Expect redeemed rav to be returned here
    expect(redeemedRavs).toEqual([
      expect.objectContaining({ ...rav2, redeemedAt: new Date(nowSecs * 1000) }),
    ])
  })

  test('should mark ravs as final via `markRavsAsFinal`', async () => {
    // we have a redeemed non-final rav in our database
    const nowSecs = Math.floor(Date.now() / 1000)
    // redeemed rav but non-final
    const default_finality_time = 3600
    const ravList = [
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_1,
        new Date((nowSecs - default_finality_time - 1) * 1000),
      ),
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_2,
        new Date((nowSecs - default_finality_time) * 1000),
      ),
      createLastNonFinalRav(
        ALLOCATION_ID_3,
        SENDER_ADDRESS_3,
        new Date((nowSecs - default_finality_time + 1) * 1000),
      ),
    ]
    await queryFeeModels.receiptAggregateVouchers.bulkCreate(ravList)

    await tapCollector['markRavsAsFinal'](nowSecs - 1)

    let finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: { last: true, final: true },
    })

    expect(finalRavs).toEqual([])

    await tapCollector['markRavsAsFinal'](nowSecs)
    finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: { last: true, final: true },
    })
    expect(finalRavs).toEqual([expect.objectContaining({ ...ravList[0], final: true })])

    await tapCollector['markRavsAsFinal'](nowSecs + 1)
    finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: { last: true, final: true },
    })
    expect(finalRavs).toEqual([
      expect.objectContaining({ ...ravList[0], final: true }),
      expect.objectContaining({ ...ravList[1], final: true }),
    ])

    await tapCollector['markRavsAsFinal'](nowSecs + 2)
    finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
      where: { last: true, final: true },
    })
    expect(finalRavs).toEqual([
      expect.objectContaining({ ...ravList[0], final: true }),
      expect.objectContaining({ ...ravList[1], final: true }),
      expect.objectContaining({ ...ravList[2], final: true }),
    ])
  })
  test(
    'test ignore final rav',
    async () => {
      const date = new Date()
      const redeemDate = date.setHours(date.getHours() - 2)
      const rav2 = {
        allocationId: ALLOCATION_ID_2,
        last: true,
        final: true,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: SIGNATURE,
        senderAddress: SENDER_ADDRESS_3,
        redeemedAt: new Date(redeemDate),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)
      const ravs = await tapCollector['pendingRAVs']()
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
        allocationId: ALLOCATION_ID_2,
        last: true,
        final: false,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: SIGNATURE,
        senderAddress: SENDER_ADDRESS_3,
        redeemedAt: new Date(redeemDate),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)

      let ravs = await tapCollector['pendingRAVs']()
      ravs = await tapCollector['filterAndUpdateRavs'](ravs)
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
    'test mark final rav via `filterAndUpdateRavs`',
    async () => {
      const date = new Date()
      const redeemDate = date.setHours(date.getHours() - 2)
      const redeemDateSecs = Math.floor(redeemDate / 1000)
      const nowSecs = Math.floor(Date.now() / 1000)
      const anotherFuncSpy = jest
        .spyOn(tapCollector, 'findTransactionsForRavs')
        .mockImplementation(async (): Promise<TapSubgraphResponse> => {
          return {
            transactions: [
              {
                id: 'test',
                allocationID: ALLOCATION_ID_2.toString().toLowerCase().replace('0x', ''),
                timestamp: redeemDateSecs,
                sender: {
                  id: SENDER_ADDRESS_3.toString().toLowerCase().replace('0x', ''),
                },
              },
            ],
            _meta: {
              block: {
                timestamp: nowSecs,
                hash: 'test',
              },
            },
          }
        })

      const rav2 = {
        allocationId: ALLOCATION_ID_2,
        last: true,
        final: false,
        timestampNs: 1709067401177959664n,
        valueAggregate: 20000000000000n,
        signature: SIGNATURE,
        senderAddress: SENDER_ADDRESS_3,
        redeemedAt: new Date(redeemDate),
      }
      await queryFeeModels.receiptAggregateVouchers.create(rav2)
      let ravs = await tapCollector['pendingRAVs']()
      ravs = await tapCollector['filterAndUpdateRavs'](ravs)
      expect(anotherFuncSpy).toBeCalled()
      const finalRavs = await queryFeeModels.receiptAggregateVouchers.findAll({
        where: { last: true, final: true },
      })
      //Final rav wont be returned here
      expect(ravs).toEqual([expect.objectContaining(rav)])
      // Expect final rav to be returned here
      expect(finalRavs).toEqual([expect.objectContaining({ ...rav2, final: true })])
    },
    timeout,
  )

  // Skipped until we can run with local-network in CI
  test.skip('test `submitRAVs` with escrow account lower on balance', async () => {
    // mock redeemRav to not call the blockchain
    const redeemRavFunc = jest
      .spyOn(tapCollector, 'redeemRav')
      .mockImplementation(jest.fn())

    // mock fromResponse to return the correct escrow account
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    jest.spyOn(EscrowAccounts, 'fromResponse').mockImplementation((_) => {
      const balances = new Map<Address, bigint>()
      balances.set(SENDER_ADDRESS_1, 40000000000000n)
      return new EscrowAccounts(balances)
    })

    const [first] = await queryFeeModels.receiptAggregateVouchers.findAll()
    const rav = first.getSignedRAV()

    const ravWithAllocation = {
      rav,
      allocation: {} as Allocation,
      sender: first.senderAddress,
    }
    const ravs = [ravWithAllocation, ravWithAllocation, ravWithAllocation]
    // submit 3 ravs
    await tapCollector['submitRAVs'](ravs)
    // expect to be able to redeem only 2 of them
    // because of the balance
    expect(redeemRavFunc).toBeCalledTimes(2)
  })
})

function createLastNonFinalRav(
  allocationId: Address,
  senderAddress: Address,
  redeemedAt: Date,
) {
  return {
    allocationId,
    last: true,
    final: false,
    timestampNs: 1709067401177959664n,
    valueAggregate: 20000000000000n,
    signature: SIGNATURE,
    senderAddress,
    redeemedAt,
  }
}
