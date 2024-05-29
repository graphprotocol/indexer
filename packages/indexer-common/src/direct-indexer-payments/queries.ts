export const CREATE_AGREEMENT_MUTATION = `
  mutation CreateAgreement($signature: String!, $data: String!) {
    createIndexingAgreement(signature: $signature, data: $data) {
      signature
      data
      protocolNetwork
    }
  }
`

export const AGREEMENT_QUERY = `
  query GetAgreement($signature: String!) {
    agreement(signature: $signature) {
      signature
      data
      protocolNetwork
    }
  }
`

export const CANCEL_AGREEMENT_MUTATION = `
  mutation CancelAgreement($signature: String!) {
    cancelIndexingAgreement(signature: $signature) {
        signature
    }
  }
`

export const PRICE_QUERY = `
  query GetPrice($subgraphDeploymentID: String!, $protocolNetwork: String!) {
    price(
      subgraphDeploymentID: $subgraphDeploymentID
      protocolNetwork: $protocolNetwork
    ) {
      subgraphDeploymentID
      price
      protocolNetwork
    }
  }
`

