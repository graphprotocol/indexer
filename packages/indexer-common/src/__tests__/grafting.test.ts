import {
  determineSubgraphDeploymentDecisions,
  discoverLineage,
  SubgraphLineage,
  SubgraphLineageWithStatus,
} from '../grafting'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from '../errors'
import { SubgraphDeploymentDecisionKind } from '../types'

// Create a mock for the fetchSubgraphManifest function
const fakeSubgraphManifestResolver = jest.fn()

// Fake IPFS Hashes:
const target = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrZX'
const base1 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYj'
const base2 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYk'
const base3 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYn'
const base4 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrZj'

describe('discoverLineage function', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const mockManifests = [
      {
        features: ['grafting'],
        graft: { block: 30, base: base1 },
      },
      {
        features: ['grafting'],
        graft: { block: 20, base: base2 },
      },
      {
        features: ['grafting'],
        graft: { block: 10, base: base3 },
      },
      { features: [], graft: null },
    ]
    fakeSubgraphManifestResolver
      .mockImplementationOnce(() => mockManifests[0])
      .mockImplementationOnce(() => mockManifests[1])
      .mockImplementationOnce(() => mockManifests[2])
      .mockImplementationOnce(() => mockManifests[3])
  })

  test('should discover a subgraph grafting lineage', async () => {
    const targetDeployment = new SubgraphDeploymentID(target)

    const result: SubgraphLineage = await discoverLineage(
      fakeSubgraphManifestResolver,
      targetDeployment,
    )

    const expected = {
      target: targetDeployment,
      bases: [
        { deployment: new SubgraphDeploymentID(base1), block: 30 },
        { deployment: new SubgraphDeploymentID(base2), block: 20 },
        { deployment: new SubgraphDeploymentID(base3), block: 10 },
      ],
    }

    expect(result).toStrictEqual(expected)
    expect(fakeSubgraphManifestResolver).toHaveBeenCalledTimes(4)
  })

  test('should throw an error after maximum iteration count is reached', async () => {
    const targetDeployment = new SubgraphDeploymentID(target)
    let threwError = false
    try {
      await discoverLineage(
        fakeSubgraphManifestResolver,
        targetDeployment,
        2, // Set maxIterations to 2
      )
    } catch (err) {
      expect(err.code).toStrictEqual(IndexerErrorCode.IE075)
      expect(err.cause).toStrictEqual(
        `Failed to find the graft root for target subgraph deployment (${target}) after 2 iterations.`,
      )
      threwError = true
    }
    expect(threwError).toBeTruthy()
  })
})

describe('determineSubgraphDeploymentDecisions function', () => {
  test('should throw an error if bases are not provided', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [],
    }

    let threwError = false
    try {
      determineSubgraphDeploymentDecisions(subgraphLineage)
    } catch (err) {
      expect(err.code).toStrictEqual(IndexerErrorCode.IE075)
      expect(err.cause).toStrictEqual(
        'Expected target subgraph to have at least one graft base.',
      )

      threwError = true
    }
    expect(threwError).toBeTruthy()
  })

  test('should return an empty array if a single base is still syncing and healthy', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 10,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: {
            latestBlock: {
              number: 5,
              hash: 'foo',
            },
            health: 'healthy',
          },
        },
      ],
    }
    expect(determineSubgraphDeploymentDecisions(subgraphLineage)).toEqual([])
  })

  test('should throw an error if an unsynced base is unhealthy', () => {
    const graftBase = new SubgraphDeploymentID(base1)
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 10,
          deployment: graftBase,
          indexingStatus: {
            latestBlock: {
              number: 5,
              hash: 'foo',
            },
            health: 'not-healthy',
          },
        },
      ],
    }

    let threwError = false
    try {
      determineSubgraphDeploymentDecisions(subgraphLineage)
    } catch (err) {
      expect(err.code).toStrictEqual(IndexerErrorCode.IE075)
      expect(err.cause).toStrictEqual({
        message: `Cannot deploy subgraph due to unhealthy graft base: ${graftBase.ipfsHash}`,
        graftDependencies: subgraphLineage,
      })
      threwError = true
    }
    expect(threwError).toBeTruthy()
  })

  test('should return DEPLOY subgraph deployment decision if its single base has no indexing status', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 1,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: null,
        },
      ],
    }
    const decisions = determineSubgraphDeploymentDecisions(subgraphLineage)
    const expected = [
      {
        deployment: new SubgraphDeploymentID(base1),
        deploymentDecision: SubgraphDeploymentDecisionKind.DEPLOY,
      },
    ]
    expect(decisions).toEqual(expected)
  })

  test('should return DEPLOY subgraph deployment decision for the latest undeployed base', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 30,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: null,
        },
        {
          block: 20,
          deployment: new SubgraphDeploymentID(base2),
          indexingStatus: null,
        },
      ],
    }
    const decisions = determineSubgraphDeploymentDecisions(subgraphLineage)
    const expected = [
      {
        deployment: new SubgraphDeploymentID(base2),
        deploymentDecision: SubgraphDeploymentDecisionKind.DEPLOY,
      },
    ]
    expect(decisions).toEqual(expected)
  })

  test('should return REMOVE decision for sufficiently synced bases', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 10,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: {
            latestBlock: {
              number: 10,
              hash: 'foo',
            },
            health: 'healthy',
          },
        },
      ],
    }
    const decisions = determineSubgraphDeploymentDecisions(subgraphLineage)
    const expected = [
      {
        deployment: new SubgraphDeploymentID(base1),
        deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
      },
    ]
    expect(decisions).toEqual(expected)
  })

  test('should return DEPLOY for the latest undeployed base and REMOVE for synced bases', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 30,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: null,
        },
        {
          block: 20,
          deployment: new SubgraphDeploymentID(base2),
          indexingStatus: {
            latestBlock: {
              number: 20,
              hash: 'foo',
            },
            health: 'healthy',
          },
        },
        {
          block: 10,
          deployment: new SubgraphDeploymentID(base3),
          indexingStatus: {
            latestBlock: {
              number: 10,
              hash: 'bar',
            },
            health: 'healthy',
          },
        },
      ],
    }
    const decisions = determineSubgraphDeploymentDecisions(subgraphLineage)
    const expected = [
      {
        deployment: new SubgraphDeploymentID(base3),
        deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
      },
      {
        deployment: new SubgraphDeploymentID(base2),
        deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
      },
      {
        deployment: new SubgraphDeploymentID(base1),
        deploymentDecision: SubgraphDeploymentDecisionKind.DEPLOY,
      },
    ]
    expect(decisions).toEqual(expected)
  })

  // This test represents the case when older graft bases are removed after serving as a base.
  test('should return DEPLOY for the latest base after the next sufficiently synced base', () => {
    const subgraphLineage: SubgraphLineageWithStatus = {
      target: new SubgraphDeploymentID(target),
      bases: [
        {
          block: 30,
          deployment: new SubgraphDeploymentID(base1),
          indexingStatus: null,
        },
        {
          block: 20,
          deployment: new SubgraphDeploymentID(base2),
          indexingStatus: {
            latestBlock: {
              number: 20,
              hash: 'foo',
            },
            health: 'healthy',
          },
        },
        // Since an earlier synced/healthy graft base exists, this one is not essential
        // and should be ignored. No deployment decisions should be made about it.
        {
          block: 10,
          deployment: new SubgraphDeploymentID(base3),
          indexingStatus: null,
        },
        // Even though this graft base is not essential for deploying the target subgraph,
        // it should be removed.
        {
          block: 5,
          deployment: new SubgraphDeploymentID(base4),
          indexingStatus: {
            latestBlock: {
              number: 20,
              hash: 'baz',
            },
            health: 'healthy',
          },
        },
      ],
    }
    const decisions = determineSubgraphDeploymentDecisions(subgraphLineage)
    const expected = [
      {
        deployment: new SubgraphDeploymentID(base4),
        deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
      },
      // Base 3 is intentionally left out of the result.
      {
        deployment: new SubgraphDeploymentID(base2),
        deploymentDecision: SubgraphDeploymentDecisionKind.REMOVE,
      },
      {
        deployment: new SubgraphDeploymentID(base1),
        deploymentDecision: SubgraphDeploymentDecisionKind.DEPLOY,
      },
    ]
    expect(decisions).toEqual(expected)
  })
})
