import { formatGRT, Logger, SubgraphDeploymentID } from '@graphprotocol/common-ts'
import {
  AllocationManager,
  GraphNode,
  IndexerManagementModels,
  IndexingDecisionBasis,
  IndexingRuleAttributes,
  Network,
  SubgraphIdentifierType,
  upsertIndexingRule,
} from '@graphprotocol/indexer-common'
import { Op } from 'sequelize'

export class DipsManager {
  constructor(
    private logger: Logger,
    private models: IndexerManagementModels,
    private graphNode: GraphNode,
    private network: Network,
    private parent: AllocationManager | null,
  ) {}
  // Cancel an agreement associated to an allocation if it exists
  async tryCancelAgreement(allocationId: string) {
    const agreement = await this.models.IndexingAgreement.findOne({
      where: {
        current_allocation_id: allocationId,
        cancelled_at: null,
      },
    })
    if (agreement) {
      // TODO use dips-proto to cancel agreement via grpc
      // Mark the agreement as cancelled
    }
  }
  // Update the current and last allocation ids for an agreement if it exists
  async tryUpdateAgreementAllocation(
    oldAllocationId: string,
    newAllocationId: string | null,
  ) {
    const agreement = await this.models.IndexingAgreement.findOne({
      where: {
        current_allocation_id: oldAllocationId,
        cancelled_at: null,
      },
    })
    if (agreement) {
      agreement.current_allocation_id = newAllocationId
      agreement.last_allocation_id = oldAllocationId
      agreement.last_payment_collected_at = null
      await agreement.save()
    }
  }
  // Collect payments for all outstanding agreements
  async collectAllPayments() {
    const outstandingAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        last_payment_collected_at: null,
        last_allocation_id: {
          [Op.ne]: null,
        },
      },
    })
    for (const agreement of outstandingAgreements) {
      if (agreement.last_allocation_id) {
        await this.tryCollectPayment(agreement.last_allocation_id)
      } else {
        // This should never happen as we check for this in the query
        this.logger.error(`Agreement ${agreement.id} has no last allocation id`)
      }
    }
  }
  async tryCollectPayment(lastAllocationId: string) {
    // TODO: use dips-proto to collect payment via grpc

    // TODO: store the receipt in the database
    // (tap-agent will take care of aggregating it into a RAV)

    // Mark the agreement as having had a payment collected
    await this.models.IndexingAgreement.update(
      {
        last_payment_collected_at: new Date(),
      },
      {
        where: {
          last_allocation_id: lastAllocationId,
        },
      },
    )
  }
  async ensureAgreementRules() {
    if (!this.parent) {
      this.logger.error(
        'DipsManager has no parent AllocationManager, cannot ensure agreement rules',
      )
      return
    }
    // Get all the indexing agreements that are not cancelled
    const indexingAgreements = await this.models.IndexingAgreement.findAll({
      where: {
        cancelled_at: null,
      },
    })
    // For each agreement, check that there is an indexing rule to always
    // allocate to the agreement's subgraphDeploymentId, and if not, create one
    for (const agreement of indexingAgreements) {
      const subgraphDeploymentID = new SubgraphDeploymentID(
        agreement.subgraph_deployment_id,
      )
      // If there is not yet an indexingRule that deems this deployment worth allocating to, make one
      if (!(await this.parent.matchingRuleExists(this.logger, subgraphDeploymentID))) {
        this.logger.debug(`Creating indexing rule for agreement ${agreement.id}`)
        const indexingRule = {
          identifier: agreement.subgraph_deployment_id,
          allocationAmount: formatGRT(
            this.network.specification.indexerOptions.dipsAllocationAmount,
          ),
          identifierType: SubgraphIdentifierType.DEPLOYMENT,
          decisionBasis: IndexingDecisionBasis.ALWAYS,
          protocolNetwork: this.network.specification.networkIdentifier,
          autoRenewal: true,
          allocationLifetime: Math.max(
            Number(agreement.min_epochs_per_collection),
            Number(agreement.max_epochs_per_collection) -
              this.network.specification.indexerOptions.dipsEpochsMargin,
          ),
        } as Partial<IndexingRuleAttributes>

        await upsertIndexingRule(this.logger, this.models, indexingRule)
      }
    }
  }
}
