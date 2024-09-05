import type { QueryResolvers } from './../../../types.generated'

export const indexerDeployments: NonNullable<
  QueryResolvers['indexerDeployments']
> = async (_parent, _arg, { graphNode }) => {
  const result = await graphNode.indexingStatus([])
  return result.map((status) => ({
    ...status,
    subgraphDeployment: status.subgraphDeployment.ipfsHash,
  }))
}
