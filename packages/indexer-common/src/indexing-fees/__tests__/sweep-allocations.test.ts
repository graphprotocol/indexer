import { createLogger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { DipsManager } from '../dips'
import {
  IndexerManagementModels,
  Network,
  AllocationManager,
} from '@graphprotocol/indexer-common'

const logger = createLogger({
  name: 'DipsManager.sweep.test',
  async: false,
  level: 'error',
})

// SubgraphDeploymentID maps an IPFS hash to a known bytes32; we capture
// that mapping for the subgraph fixture and use the same hash on the rule.
const TEST_DEPLOYMENT_IPFS = 'QmPdbQaRCMhgouSZSW3sHZxU3M8KwcngWASvreAexzmmrh'
const RESOLVED_BYTES32 = new SubgraphDeploymentID(TEST_DEPLOYMENT_IPFS).bytes32
const OTHER_DEPLOYMENT_IPFS = 'QmTzQ1JRkWErjk39mryYw2WVaphAZNAREyMchXzYQ7c15W'

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function createMockModels(rules: Array<{ id: number; identifier: string }>) {
  const destroy = jest.fn().mockResolvedValue(1)
  return {
    models: {
      IndexingRule: {
        findAll: jest.fn().mockResolvedValue(rules),
        destroy,
      },
    } as unknown as IndexerManagementModels,
    destroy,
  }
}

function createMockNetwork(
  subgraphResult: unknown,
  indexerAddress = '0x5555555555555555555555555555555555555555',
) {
  const query = jest.fn().mockResolvedValue(subgraphResult)
  return {
    network: {
      specification: {
        indexerOptions: {
          address: indexerAddress,
          dipsCollectionTarget: 1,
        },
        networkIdentifier: 'eip155:1337',
      },
      indexingPaymentsSubgraph: { query },
    } as unknown as Network,
    query,
  }
}

function createDipsManager(
  network: Network,
  models: IndexerManagementModels,
): DipsManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DipsManager(logger, models, network, {} as any, {} as AllocationManager)
}

describe('DipsManager.sweepDipsAllocations', () => {
  test('removes a dips rule that has no matching Accepted agreement', async () => {
    const { models, destroy } = createMockModels([
      { id: 42, identifier: TEST_DEPLOYMENT_IPFS },
    ])
    const { network } = createMockNetwork({
      data: {
        _meta: { block: { timestamp: nowSeconds() } },
        // Indexer has no accepted agreements at all
        indexingAgreements: [],
      },
    })

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledWith({ where: { id: 42 } })
  })

  test('keeps a dips rule whose deployment has an Accepted agreement', async () => {
    const { models, destroy } = createMockModels([
      { id: 7, identifier: TEST_DEPLOYMENT_IPFS },
    ])
    const { network } = createMockNetwork({
      data: {
        _meta: { block: { timestamp: nowSeconds() } },
        indexingAgreements: [
          {
            id: '0xagreement1',
            subgraphDeploymentId: RESOLVED_BYTES32,
          },
        ],
      },
    })

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    expect(destroy).not.toHaveBeenCalled()
  })

  test('disables only the unbacked rule, leaves backed rules intact', async () => {
    const { models, destroy } = createMockModels([
      { id: 1, identifier: TEST_DEPLOYMENT_IPFS },
      { id: 2, identifier: OTHER_DEPLOYMENT_IPFS },
    ])
    const { network } = createMockNetwork({
      data: {
        _meta: { block: { timestamp: nowSeconds() } },
        indexingAgreements: [
          {
            id: '0xagreement1',
            // Only backs the first rule
            subgraphDeploymentId: RESOLVED_BYTES32,
          },
        ],
      },
    })

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledWith({ where: { id: 2 } })
  })

  test('skips the sweep when subgraph block timestamp is stale', async () => {
    const { models, destroy } = createMockModels([
      { id: 99, identifier: TEST_DEPLOYMENT_IPFS },
    ])
    // Timestamp 10 minutes behind wall clock — beyond the 300s threshold
    const stale = nowSeconds() - 600
    const { network } = createMockNetwork({
      data: {
        _meta: { block: { timestamp: stale } },
        indexingAgreements: [],
      },
    })

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    // Stale subgraph: do not act on its data
    expect(destroy).not.toHaveBeenCalled()
  })

  test('skips the sweep when subgraph query fails', async () => {
    const { models, destroy } = createMockModels([
      { id: 5, identifier: TEST_DEPLOYMENT_IPFS },
    ])
    const { network } = createMockNetwork({
      error: new Error('connection refused'),
    })

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    expect(destroy).not.toHaveBeenCalled()
  })

  test('is a no-op when indexingPaymentsSubgraph is not configured', async () => {
    const { models, destroy } = createMockModels([
      { id: 1, identifier: TEST_DEPLOYMENT_IPFS },
    ])
    const network = {
      specification: {
        indexerOptions: {
          address: '0x5555555555555555555555555555555555555555',
          dipsCollectionTarget: 1,
        },
        networkIdentifier: 'eip155:1337',
      },
      indexingPaymentsSubgraph: null,
    } as unknown as Network

    const dm = createDipsManager(network, models)
    await dm.sweepDipsAllocations()

    expect(destroy).not.toHaveBeenCalled()
  })
})
