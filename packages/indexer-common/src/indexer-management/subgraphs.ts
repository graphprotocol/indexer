import {
  indexerError,
  IndexerErrorCode,
  IndexerManagementModels,
} from '@graphprotocol/indexer-common'
import { Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import jayson, { Client as RpcClient } from 'jayson/promise'
import pTimeout from 'p-timeout'

export class SubgraphManager {
  client: RpcClient

  constructor(endpoint: string) {
    if (endpoint.startsWith('https')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = jayson.Client.https(endpoint as any)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client = jayson.Client.http(endpoint as any)
    }
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
  ): Promise<void> {
    try {
      logger.info(`Deploy subgraph`, {
        name,
        deployment: deployment.display,
      })
      const requestPromise = this.client.request('subgraph_deploy', {
        name,
        ipfs_hash: deployment.ipfsHash,
      })
      // Timeout deployment after 2 minutes
      const response = await pTimeout(requestPromise, 120000)

      if (response.error) {
        throw response.error
      }
      logger.info(`Successfully deployed subgraph`, {
        name,
        deployment: deployment.display,
        endpoints: response.result,
      })

      // TODO: Insert an offchain indexing rule if one matching this deployment doesn't yet exist
      // Will be useful for supporting deploySubgraph resolver
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

  async ensure(
    logger: Logger,
    models: IndexerManagementModels,
    name: string,
    deployment: SubgraphDeploymentID,
  ): Promise<void> {
    try {
      await this.createSubgraph(logger, name)
      await this.deploy(logger, models, name, deployment)
    } catch (error) {
      const err = indexerError(IndexerErrorCode.IE020, error)
      logger.error(`Failed to ensure subgraph deployment is indexing`, {
        name,
        deployment: deployment.display,
        err,
      })
      throw error
    }
  }
}
