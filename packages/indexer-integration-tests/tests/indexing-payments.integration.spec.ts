import {
  AGREEMENT_QUERY,
  CREATE_AGREEMENT_MUTATION,
  PRICE_QUERY,
} from '@graphprotocol/indexer-common' // Update with actual path
import axios from 'axios'

const GRAPHQL_ENDPOINT = 'http://localhost:7601/indexing-payments'
const HEADERS = { 'Content-Type': 'application/json' }

describe('indexer-payments', () => {
  it('should return an IndexingAgreement for a given signature', async () => {
    const variables = { signature: 'example-signature' }

    const response = await axios.post(
      GRAPHQL_ENDPOINT,
      {
        query: AGREEMENT_QUERY,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    console.log(response.data)
    expect(response.data.agreement).toMatchObject({
      signature: 'example-signature',
      data: 'example-data',
      protocolNetwork: 'example-network',
    })
  })

  it('should return an IndexingPrice for a given subgraphDeploymentID and protocolNetwork', async () => {
    const variables = {
      subgraphDeploymentID: 'example-id',
      protocolNetwork: 'example-network',
    }

    const response = await axios.post(
      GRAPHQL_ENDPOINT,
      {
        query: PRICE_QUERY,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    expect(response.data.price).toMatchObject({
      subgraphDeploymentID: 'example-id',
      price: 123.45,
      protocolNetwork: 'example-network',
    })
  })

  it('should create an IndexingAgreement', async () => {
    const variables = { signature: 'new-signature', data: 'new-data' }

    const response = await axios.post(
      GRAPHQL_ENDPOINT,
      {
        query: CREATE_AGREEMENT_MUTATION,
        variables,
      },
      { headers: HEADERS },
    )

    expect(response.data).toBeDefined()
    expect(response.data.createIndexingAgreement).toMatchObject({
      signature: 'new-signature',
      data: 'new-data',
      protocolNetwork: 'example-network',
    })
  })
})
