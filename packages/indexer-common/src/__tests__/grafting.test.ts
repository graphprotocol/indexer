import { discoverLineage, SubgraphLineage } from '../grafting'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { indexerError, IndexerErrorCode } from '../errors'

// Create a mock for the fetchSubgraphManifest function
const fakeSubgraphManifestResolver = jest.fn()

// Fake IPFS Hashes:
const target = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrZX'
const base1 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYj'
const base2 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYk'
const base3 = 'QmWaVSK24D1m53Ej2PaddWcb1HZKAV4bjiKkrUwtP3HrYn'

describe('discoverLineage', () => {
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

  test('should resolve grafting with multiple iterations', async () => {
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

  test('should resolve grafting when max iterations are reached', async () => {
    const targetDeployment = new SubgraphDeploymentID(target)
    expect(() =>
      discoverLineage(
        fakeSubgraphManifestResolver,
        targetDeployment,
        2, // Set maxIterations to 2
      ),
    ).rejects.toThrow(
      indexerError(
        IndexerErrorCode.IE075,
        `Failed to find the graft root for target subgraph deployment (${target}) after 2 iterations.`,
      ),
    )
  })
})
