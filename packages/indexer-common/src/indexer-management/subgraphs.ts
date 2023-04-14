import {
  indexerError,
  IndexerErrorCode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  SubgraphIdentifierType,
  upsertIndexingRule,
  fetchIndexingRules,
  INDEXING_RULE_GLOBAL,
  IndexingStatusResolver,
} from '@graphprotocol/indexer-common'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import jayson, { Client as RpcClient } from 'jayson/promise'
import pTimeout from 'p-timeout'
import fetch from 'isomorphic-fetch'
import yaml from 'yaml'

export class SubgraphManager {
  client: RpcClient
  indexNodeIDs: string[]
  statusResolver: IndexingStatusResolver
  autoGraftResolverLimit: number
  ipfsEndpoint?: string

  constructor(
    endpoint: string,
    indexNodeIDs: string[],
    statusResolver: IndexingStatusResolver,
    ipfsUrl?: string,
    autoGraftResolverLimit?: number,
  ) {
    if (endpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = jayson.Client.https(endpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = jayson.Client.http(endpoint as any)
    }
    this.indexNodeIDs = indexNodeIDs
    this.statusResolver = statusResolver
    this.ipfsEndpoint = ipfsUrl + '/api/v0/cat?arg='
    this.autoGraftResolverLimit = autoGraftResolverLimit ?? 0
  }

  async createSubgraph(logger: Logger, name: string): Promise<void> {
    try {
      logger.info(`Create subgraph name`, { name })
      const response = await this.client.request('subgraph_create', { name })
      if (response.error) {
        throw response.error
      }
      logger.info(`Successfully created subgraph name`, { name })
    } catch (error) {
      if (error.message.includes('already exists')) {
        logger.debug(`Subgraph name already exists`, { name })
      }
      throw error
    }
  }

  async deploy(
    logger: Logger,
    models: IndexerManagementModels,
    name: string,
    deployment: SubgraphDeploymentID,
    indexNode: string | undefined,
  ): Promise<void> {
    try {
      let targetNode: string
      if (indexNode) {
        targetNode = indexNode
        if (!this.indexNodeIDs.includes(targetNode)) {
          logger.warn(
            `Specified deployment target node not present in indexNodeIDs supplied at startup, proceeding with deploy to target node anyway.`,
            {
              targetNode: indexNode,
              indexNodeIDs: this.indexNodeIDs,
            },
          )
        }
      } else {
        targetNode =
          this.indexNodeIDs[Math.floor(Math.random() * this.indexNodeIDs.length)]
      }
      logger.info(`Deploy subgraph`, {
        name,
        deployment: deployment.display,
        targetNode,
      })
      const requestPromise = this.client.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
        node_id: targetNode,
      })
      // Timeout deployment after 2 minutes
      const response = await pTimeout(requestPromise, 120000)

      if (response.error) {
        throw indexerError(IndexerErrorCode.IE026, response.error)
      }
      logger.info(`Successfully deployed subgraph`, {
        name,
        deployment: deployment.display,
        endpoints: response.result,
      })

      // Will be useful for supporting deploySubgraph resolver
      const indexingRules = (await fetchIndexingRules(models, false))
        .filter((rule) => rule.identifier != INDEXING_RULE_GLOBAL)
        .map((rule) => new SubgraphDeploymentID(rule.identifier))
      if (!indexingRules.includes(deployment)) {
        const offchainIndexingRule = {
          identifier: deployment.ipfsHash,
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.OFFCHAIN,
        } as Partial<IndexingRuleAttributes>
        await upsertIndexingRule(logger, models, offchainIndexingRule)
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE026, error)
      logger.error(`Failed to deploy subgraph deployment`, {
        name,
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async remove(
    logger: Logger,
    models: IndexerManagementModels,
    deployment: SubgraphDeploymentID,
  ): Promise<void> {
    try {
      logger.info(`Remove subgraph deployment`, {
        deployment: deployment.display,
      })
      const response = await this.client.request('subgraph_reassign', {
        node_id: 'removed',
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
      logger.info(`Successfully removed subgraph deployment`, {
        deployment: deployment.display,
      })

      if (
        await models.IndexingRule.findOne({
          where: { identifier: deployment.ipfsHash },
        })
      ) {
        logger.info(
          `Remove indexing rules, so indexer-agent will not attempt to redeploy`,
        )
        await models.IndexingRule.destroy({
          where: {
            identifier: deployment.ipfsHash,
          },
        })
        logger.info(`Sucessfully removed indexing rule for '${deployment.ipfsHash}'`)
      }
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE027, error)
      logger.error(`Failed to remove subgraph deployment`, {
        deployment: deployment.display,
        err,
      })
    }
  }

  async reassign(
    logger: Logger,
    deployment: SubgraphDeploymentID,
    indexNode: string | undefined,
  ): Promise<void> {
    let targetNode: string
    if (indexNode) {
      targetNode = indexNode
      if (!this.indexNodeIDs.includes(targetNode)) {
        logger.warn(
          `Specified deployment target node not present in indexNodeIDs supplied at startup, proceeding with deploy to target node anyway.`,
          {
            targetNode: indexNode,
            indexNodeIDs: this.indexNodeIDs,
          },
        )
      }
    } else {
      targetNode = this.indexNodeIDs[Math.floor(Math.random() * this.indexNodeIDs.length)]
    }
    try {
      logger.info(`Reassign subgraph deployment`, {
        deployment: deployment.display,
        targetNode,
      })
      const response = await this.client.request('subgraph_reassign', {
        node_id: targetNode,
        ipfs_hash: deployment.ipfsHash,
      })
      if (response.error) {
        throw response.error
      }
    } catch (error) {
      if (error.message.includes('unchanged')) {
        logger.debug(`Subgraph deployment assignment unchanged`, {
          deployment: deployment.display,
          targetNode,
        })
        throw error
      }
      const err = indexerError(IndexerErrorCode.IE028, error)
      logger.error(`Failed to reassign subgraph deployment`, {
        deployment: deployment.display,
        err,
      })
      throw err
    }
  }

  async ensure(
    logger: Logger,
    models: IndexerManagementModels,
    name: string,
    deployment: SubgraphDeploymentID,
    indexNode: string | undefined,
  ): Promise<void> {
    try {
      await this.createSubgraph(logger, name)
      await this.deploy(logger, models, name, deployment, indexNode)
      await this.reassign(logger, deployment, indexNode)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE020, error)
      logger.error(`Failed to ensure subgraph deployment is indexing`, {
        name,
        deployment: deployment.display,
        targetNode: indexNode,
        err,
      })
      throw error
    }
  }

  // Simple fetch for subgraph manifest
  async subgraphManifest(targetDeployment: SubgraphDeploymentID) {
    const ipfsFile = await fetch(this.ipfsEndpoint + targetDeployment.ipfsHash, {
      method: 'POST',
      redirect: 'follow',
    })
    return yaml.parse(await ipfsFile.text())
  }

  // Recursive function for targetDeployment resolve grafting, add depth until reached to resolverDepth
  async resolveGrafting(
    logger: Logger,
    models: IndexerManagementModels,
    targetDeployment: SubgraphDeploymentID,
    indexNode: string | undefined,
    depth: number,
  ): Promise<void> {
    const manifest = await this.subgraphManifest(targetDeployment)
    const name = `indexer-agent/${targetDeployment.ipfsHash.slice(-10)}`

    // No grafting or at root of dependency
    if (!manifest.features || !manifest.features.includes('grafting')) {
      if (depth) {
        await this.ensure(logger, models, name, targetDeployment, indexNode)
      }
      return
    }
    // Default limit set to 0, disable auto-resolve of grafting dependencies
    if (depth >= this.autoGraftResolverLimit) {
      throw indexerError(
        IndexerErrorCode.IE074,
        `Grafting depth reached limit for auto resolve`,
      )
    }

    try {
      const baseDeployment = new SubgraphDeploymentID(manifest.graft.base)
      let baseName = name.replace(this.depthRegex, `/depth-${depth}`)
      if (baseName === name) {
        // add depth suffix if didn't have one from targetDeployment
        baseName += `/depth-${depth}`
      }
      await this.resolveGrafting(logger, models, baseDeployment, indexNode, depth + 1)

      // If base deployment has synced upto the graft block, then ensure the target deployment
      // Otherwise just log to come back later
      const graftStatus = await this.statusResolver.indexingStatus([baseDeployment])
      // If base deployment synced to required block, try to sync the target and
      // turn off syncing for the base deployment
      if (
        graftStatus[0].chains[0].latestBlock &&
        graftStatus[0].chains[0].latestBlock.number >= manifest.graft.block
      ) {
        await this.ensure(logger, models, name, targetDeployment, indexNode)
        // At this point, can safely set NEVER to graft base deployment
        await this.stop_sync(logger, baseDeployment, models)
      } else {
        logger.debug(
          `Graft base deployment has yet to reach the graft block, try again later`,
        )
      }
    } catch {
      throw indexerError(
        IndexerErrorCode.IE074,
        `Base deployment hasn't synced to the graft block, try again later`,
      )
    }
  }

  /**
   * Matches "/depth-" followed by one or more digits
   */
  depthRegex = /\/depth-\d+/

  async stop_sync(
    logger: Logger,
    deployment: SubgraphDeploymentID,
    models: IndexerManagementModels,
  ) {
    const neverIndexingRule = {
      identifier: deployment.ipfsHash,
      identifierType: SubgraphIdentifierType.DEPLOYMENT,
      decisionBasis: IndexingDecisionBasis.NEVER,
    } as Partial<IndexingRuleAttributes>

    await upsertIndexingRule(logger, models, neverIndexingRule)
  }
}
