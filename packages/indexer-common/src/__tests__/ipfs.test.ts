import { createLogger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { SubgraphDependencies, SubgraphManifestResolver } from '../graph-node'
import express, { Request, Response } from 'express'
import { AddressInfo } from 'net'
import { utils } from 'ethers'

const EXAMPLE_VALID_IPFS_HASH = 'Qmd9nZKCH8UZU1pBzk7G8ECJr3jX3a2vAf3vowuTwFvrQg'
const EXAMPLE_NON_MANIFEST_VALID_IPFS_HASH =
  'QmddQDkcHHM7mGvYrrnoGnQ1q9GdHQfbTvj2mfbyz2Q49K'

function mockManifestHash(input: string): string {
  const utf8Bytes = utils.toUtf8Bytes(input)
  const hash = utils.keccak256(utf8Bytes) // Generate a keccak256 hash of the input
  return new SubgraphDeploymentID(hash).ipfsHash
}

const DEP_ROOT_HASH = mockManifestHash('root')
const DEP_1 = mockManifestHash('dep1')
const DEP_2 = mockManifestHash('dep2')
const DEP_3 = mockManifestHash('dep3')

describe(SubgraphManifestResolver, () => {
  let ipfs: SubgraphManifestResolver
  const app = express()

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let server: any

  const manifestMap = new Map<string, string>()
  manifestMap.set(
    EXAMPLE_VALID_IPFS_HASH,
    `
        specVersion: "0.0.2"
        name: "test"
        graft:
            base: "test"
            block: 5
    `,
  )

  // this example is a real world contract schema
  manifestMap.set(
    EXAMPLE_NON_MANIFEST_VALID_IPFS_HASH,
    `
        {
            "name": "test"
        }
    `,
  )

  manifestMap.set(
    DEP_ROOT_HASH,
    `
        specVersion: "0.0.2"
        name: "root"
        graft:
            base: ${DEP_1}
            block: 1000
    `,
  )
  manifestMap.set(
    DEP_1,
    `
        specVersion: "0.0.2"
        name: "dep1"
        graft: 
            base: ${DEP_2}
            block: 550
    `,
  )
  manifestMap.set(
    DEP_2,
    `
        specVersion: "0.0.2"
        name: "dep2"
        graft: 
            base: ${DEP_3}
            block: 250
    `,
  )
  manifestMap.set(
    DEP_3,
    `
        specVersion: "0.0.2"
        name: "dep3"
    `,
  )

  beforeAll(async () => {
    // Mock endpoint for IPFS CID requests
    app.post('/api/v0/cat', (req: Request, res: Response) => {
      const cid = req.query.arg as string
      if (!cid) {
        const err = new Error('CID parameter is required')
        res.status(400)
        return res.send(err.message)
      }

      // console.log(`got cid ${cid}`)

      // Example: Respond with different data based on the CID
      if (manifestMap.has(cid)) {
        res.send(manifestMap.get(cid))
      } else {
        // console.log(`CID not found: ${cid}`)
        res.status(404).send('Not Found')
      }
    })

    // Handler for all other routes
    app.use((req: Request, res: Response, next) => {
      // console.log(`404: ${req.url}, ${req.method}`)
      res.status(404).send('Not Found')
      next()
    })

    // Start server and bind to a random port
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, () => {
        const address: AddressInfo = s.address() as AddressInfo
        console.log(`Mock server running on ${address.address}:${address.port}`)
        const serverAddress = `http://localhost:${address.port}`
        ipfs = new SubgraphManifestResolver(serverAddress, createLogger({ name: 'test' }))
        resolve(s)
      })
      s.on('error', reject)
    })
  })

  afterAll(async () => {
    // Shut down the server
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err: Error | undefined) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
      console.log('Mock server shut down')
    }
  })

  it('should fetch and parse a valid manifest', async () => {
    const manifest = await ipfs.resolve(new SubgraphDeploymentID(EXAMPLE_VALID_IPFS_HASH))
    expect(manifest).toEqual({
      specVersion: '0.0.2',
      name: 'test',
      graft: { base: 'test', block: 5 },
    })
  })

  it('should throw an error when fetching an invalid manifest', async () => {
    await expect(
      ipfs.resolve(new SubgraphDeploymentID(EXAMPLE_NON_MANIFEST_VALID_IPFS_HASH)),
    ).rejects.toThrow()
  })

  it('should throw an error when fetching a non-existent manifest', async () => {
    await expect(
      ipfs.resolve(
        new SubgraphDeploymentID('QmeDVcAvgYPKFCw2VCqTK3JRexHT8jkgvQ7AJ9WxhuFNM8'),
      ),
    ).rejects.toThrow()
  })

  it('should resolve dependencies', async () => {
    const manifest: SubgraphDependencies = await ipfs.resolveGraftDependencies(
      new SubgraphDeploymentID(DEP_ROOT_HASH),
    )
    expect(manifest).toEqual({
      root: new SubgraphDeploymentID(DEP_ROOT_HASH),
      dependencies: [
        // dependencies are fetched in oldest to newest order
        { base: new SubgraphDeploymentID(DEP_3), block: 250 },
        { base: new SubgraphDeploymentID(DEP_2), block: 550 },
        { base: new SubgraphDeploymentID(DEP_1), block: 1000 },
      ],
    })
  })
})
