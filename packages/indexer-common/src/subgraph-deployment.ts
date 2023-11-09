import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { LoggerInterface, SubgraphDeploymentDecisionKind } from './types'
import { GraphNodeInterface } from './graph-node'
import { Client, gql } from '@urql/core'
import {
  discoverLineage,
  determineSubgraphDeploymentDecisions,
  SubgraphLineage,
  queryGraftBaseStatuses,
  GraftBaseDeploymentDecision,
  formatGraftBases,
  formatGraftBase,
} from './grafting'
import { SubgraphIdentifierType, fetchSubgraphManifest } from './subgraphs'
import {
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  IndexingRuleIdentifier,
} from './indexer-management'
import { IndexerErrorCode, indexerError } from './errors'

const SET_INDEXING_RULE_MUTATION = gql`
  mutation setIndexingRule($rule: IndexingRuleInput!) {
    setIndexingRule(rule: $rule) {
      identifier
      identifierType
      custom
      decisionBasis
      protocolNetwork
    }
  }
`

const GET_INDEXING_RULE_QUERY = gql`
  query indexingRule($identifier: IndexingRuleIdentifier!) {
    indexingRule(identifier: $identifier, merged: false) {
      custom
    }
  }
`
const DELETE_INDEXING_RULE_MUTATION = gql`
  mutation deleteIndexingRule($identifier: IndexingRuleIdentifier!) {
    deleteIndexingRule(identifier: $identifier)
  }
`

// Deploys a specified subgraph and handles grafting scenarios.
export async function deploySubgraph(
  subgraphName: string,
  subgraphDeployment: SubgraphDeploymentID,
  graphNode: GraphNodeInterface,
  ipfsURL: URL,
  indexerManagement: Client,
  protocolNetwork: string,
  parentLogger: LoggerInterface,
): Promise<void> {
  // Inspect target subgraph's grafting lineage.
  const logger = parentLogger.child({
    function: 'deploySubgraph',
    subgraphDeployment: subgraphDeployment.display,
  })
  logger.debug('Resolving graft bases for target subgraph deployment.')
  const subgraphManifestResolver = async (subgraphID: SubgraphDeploymentID) =>
    await fetchSubgraphManifest(ipfsURL, subgraphID, logger)
  const subgraphLineage = await discoverLineage(
    subgraphManifestResolver,
    subgraphDeployment,
  )
  // If there's no graft base, deploy it right away
  if (!subgraphLineage.bases.length) {
    logger.debug('Subgraph has no graft dependencies.')
    return await graphNode.ensure(subgraphName, subgraphDeployment)
  } else {
    return await deployGraftedSubgraph(
      subgraphLineage,
      graphNode,
      indexerManagement,
      protocolNetwork,
      logger,
    )
  }
}
// Attempts to deploy the first viable base for a grafted subgraph.
// Will create a new indexing rule for the next viable graft base and remove old rules
// for sufficiently synced bases.
async function deployGraftedSubgraph(
  subgraphLineage: SubgraphLineage,
  graphNode: GraphNodeInterface,
  indexerManagement: Client,
  protocolNetwork: string,
  parentLogger: LoggerInterface,
): Promise<void> {
  const logger = parentLogger.child({
    function: 'deployGraftedSubgraph',
    targetSubgraph: subgraphLineage.target.display,
    graftBases: formatGraftBases(subgraphLineage.bases),
  })
  logger.debug(
    'Target subgraph deployment has graft bases. ' +
      'Deploying first viable base for grafted subgraph.',
  )

  // Fetch the deployment status for all graft bases.
  const lineageDeploymentStatus = await queryGraftBaseStatuses(
    subgraphLineage,
    graphNode,
    logger,
  )

  // Inspect if we need to deploy or remove a sufficiently synced graft base.
  const deploymentDecisions = determineSubgraphDeploymentDecisions(
    lineageDeploymentStatus,
    logger,
  )
  for (const deploymentDecision of deploymentDecisions) {
    switch (deploymentDecision.kind) {
      case SubgraphDeploymentDecisionKind.DEPLOY: {
        // Create an offchain deployment rule for this subgraph.
        await createIndexingRuleForGraftBase(
          deploymentDecision,
          protocolNetwork,
          indexerManagement,
          logger,
        )
        // Deploy the graft base subgraph.
        const subgraphName = `indexer-agent/${deploymentDecision.deployment.ipfsHash.slice(
          -10,
        )}`
        logger.info(`Graft Base subgraph deployment`, {
          name: subgraphName,
          deployment: deploymentDecision.deployment.display,
        })
        await graphNode.ensure(subgraphName, deploymentDecision.deployment)
        break
      }
      case SubgraphDeploymentDecisionKind.REMOVE:
        await deleteTemporaryIndexingRule(
          deploymentDecision,
          protocolNetwork,
          indexerManagement,
          logger,
        )
        break

      default:
        throw new Error('Unknown deployment decision')
    }
  }
}

async function createIndexingRuleForGraftBase(
  deploymentDecision: GraftBaseDeploymentDecision,
  protocolNetwork: string,
  indexerManagement: Client,
  logger: LoggerInterface,
): Promise<void> {
  const rule: Partial<IndexingRuleAttributes> = {
    identifier: deploymentDecision.deployment.ipfsHash,
    identifierType: SubgraphIdentifierType.DEPLOYMENT,
    decisionBasis: IndexingDecisionBasis.OFFCHAIN,
    custom: JSON.stringify({
      type: 'graftBase',
      targetDeployment: deploymentDecision.deployment.ipfsHash,
      block: deploymentDecision.expectedBlockHeight,
    }),
    protocolNetwork,
  }
  try {
    const result = await indexerManagement
      .mutation(SET_INDEXING_RULE_MUTATION, { rule })
      .toPromise()
    if (result.error) {
      throw result.error
    }
    logger.debug('Created temporary offchain indexing rule for graft base.', {
      deploymentDecision,
    })
  } catch (indexerManagementError) {
    const error = indexerError(IndexerErrorCode.IE075, indexerManagementError)
    logger.warn(
      'Failed to create a temporary offchain indexing rule to support a graft base deployment.',
      { error, deploymentDecision },
    )
    throw error
  }
}

// Delete an IndexingRule from the database by querying its ID and checking the 'custom'
// field to ensure it is a temporary rule.
async function deleteTemporaryIndexingRule(
  deploymentDecision: GraftBaseDeploymentDecision,
  protocolNetwork: string,
  indexerManagement: Client,
  parentLogger: LoggerInterface,
): Promise<void> {
  const identifier: IndexingRuleIdentifier = {
    identifier: deploymentDecision.deployment.ipfsHash,
    protocolNetwork,
  }
  const logger = parentLogger.child({
    identifier,
    deploymentDecision: formatGraftBase(deploymentDecision),
  })

  // Query indexing management client for a indexing rule matching the IPFS hash of this
  // subgraph deployment.
  const indexingRule = await queryIndexingRule(identifier, indexerManagement, logger)

  if (!indexingRule) {
    logger.warn(
      'Failed to find the temporary offchain indexing rule that supported a graft base deployment.',
    )
    return
  }

  // Check if this is a temporary indexing rule. We should not remove it if there's no
  // grafting information stored in its 'custom' field.
  const safeToRemove = checkTemporaryIndexingRule(
    indexingRule,
    deploymentDecision.deployment.ipfsHash,
  )
  if (!safeToRemove) {
    logger.info(
      'Found indexing rule that was used to support a graft base deployment, ' +
        'but it is not safe to remove it as it might still be in use',
    )
    return
  }

  // Remove the indexing rule
  const deleteResult = await indexerManagement
    .mutation(DELETE_INDEXING_RULE_MUTATION, { identifier })
    .toPromise()
  if (deleteResult.error) {
    throw deleteResult.error
  }
}

type TemporaryIndexingRuleTag = Pick<IndexingRuleAttributes, 'custom'>

async function queryIndexingRule(
  identifier: IndexingRuleIdentifier,
  indexerManagement: Client,
  logger: LoggerInterface,
): Promise<TemporaryIndexingRuleTag | null> {
  try {
    const result = await indexerManagement
      .query(GET_INDEXING_RULE_QUERY, {
        identifier,
      })
      .toPromise()
    if (result.error) {
      throw result.error
    }
    return result.data.indexingRule
  } catch (indexerManagementError) {
    const error = indexerError(IndexerErrorCode.IE075, indexerManagementError)
    logger.warn('Failed to query a temporary offchain indexing rule for its removal.', {
      error,
    })
    throw error
  }
}

// Returns true if we can identify a tag in this IndexingRule indicating that it is
// temporary, created for the expected graft base deployment.
function checkTemporaryIndexingRule(
  rule: TemporaryIndexingRuleTag,
  expectedSubgraphDeployment: string,
): boolean {
  // Check if we have a string in the 'custom' field.
  if (!rule.custom || typeof rule.custom !== 'string') {
    return false
  }
  // Check if that string is a JSON.
  let tag
  try {
    tag = JSON.parse(rule.custom)
  } catch (error) {
    return false
  }
  if (!tag || typeof tag !== 'object') {
    return false
  }
  if (tag.type === 'graftBase' && tag.targetDeployment === expectedSubgraphDeployment) {
    return true
  }
  return false
}
