import fetch from 'cross-fetch'
import { Router } from 'express'

export interface DeploymentHealthServerOptions {
  graphNodeStatusEndpoint: string
}

export const createDeploymentHealthServer = ({
  graphNodeStatusEndpoint,
}: DeploymentHealthServerOptions): Router => {
  const router = Router()

  // This route returns an HTTP 200 response if the deployment in question
  // has not failed and is caught up with the chain head; otherwise an
  // HTTP 500 is returned
  router.get('/:deployment', async (req, res) => {
    // Query indexing status for this particular deployment
    const response = await fetch(graphNodeStatusEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: `query indexingStatus($subgraphs: [String!]!) {
{
  indexingStatuses(subgraphs: $subgraphs) {
    health
    chains {
      network
      ... on EthereumIndexingStatus {
        latestBlock { number hash }
        chainHeadBlock { number hash }
      }
    }
  }
}`,
        variables: {
          subgraphs: [req.params.deployment],
        },
      }),
    })

    // We couldn't get a good HTTP response from Graph Node
    if (!response.ok) {
      return res.status(500).send('Unknown error')
    }

    // Assert that we got JSON back
    let data
    try {
      data = await response.json()
    } catch (err) {
      return res.status(500).send('Malformatted indexing status')
    }

    // Assert that we got a valid indexing status back
    if (
      !data.data ||
      data.errors ||
      !data.data.indexingStatuses ||
      !Array.isArray(data.data.indexingStatuses) ||
      data.data.indexingStatuses.length < 1
    ) {
      return res.status(500).send('Invalid indexing status')
    }

    // We can safely access this, thanks to the previous check
    const status = data.data.indexingStatuses[0]

    if (status.health === 'failed') {
      return res.status(500).send('Subgraph deployment has failed')
    }

    const latestBlock = status.chains[0]?.latestBlock
    const headBlock = status.chains[0]?.chainHeadBlock

    // Check whether the subgraph is caught up with the chain head
    if (latestBlock?.number > headBlock?.number - 5) {
      return res.status(200).send('Subgraph deployment is up to date')
    } else {
      return res.status(500).send('Subgraph deployment is lagging behind')
    }
  })

  return router
}
