import {GluegunToolbox} from 'gluegun'
import chalk from 'chalk'

import {loadValidatedConfig} from '../../../config'
import {createIndexerManagementClient} from '../../../client'
import {fixParameters} from '../../../command-helpers'
import gql from 'graphql-tag'
import {printIndexerAllocations} from '../../../allocations'
import {SubgraphDeploymentID, toAddress} from '@graphprotocol/common-ts'
import {processIdentifier, SubgraphIdentifierType} from "@graphprotocol/indexer-common";

const HELP = `
${chalk.bold('graph indexer allocations get')} [options] all
${chalk.bold('graph indexer allocations get')} [options] <allocation-id>

${chalk.dim('Options:')}

  -h, --help                                Show usage information
      --active                              Shows only allocations that are active
      --claimable                           Shows only allocations that can be claimed
      --deployment <id>                     Shows only allocations for a specific subgraph deployment
      --indexers <address> <address> ...    Shows only allocations from a list of indexer/s
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'get',
  alias: [],
  description: 'List one or more allocations',
    run: async (toolbox: GluegunToolbox) => {
      const { print, parameters } = toolbox

      const {
        active,
        claimable,
        deployment,
        indexers,
        h,
        help,
        o,
        output,
      } = parameters.options

      const [id] = fixParameters(parameters, { h, help, active, claimable, deployment, indexers }) || []
      const outputFormat = o || output || 'table'

      if (help || h) {
        print.info(HELP)
        return
      }

      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        print.error(`Invalid output format "${outputFormat}"`)
        process.exitCode = 1
        return
      }

      let deploymentString: string | null = null
      let type: SubgraphIdentifierType

      try {
        if (deployment) {
            [deploymentString, type] = await processIdentifier(deployment, { all: true, global: false })
            if(type == SubgraphIdentifierType.GROUP) {
              throw Error(`Invalid '--deployment' must be a deployment ID (bytes32 or base58 formatted)`)
            }
        }

        const config = loadValidatedConfig()
        const client = await createIndexerManagementClient({ url: config.api })

        const result = await client
          .query(
            gql`
              query allocations($filter: AllocationFilter!) {
                allocations(filter: $filter) {
                  id
                  subgraphDeployment {
                    id
                  }
                  allocatedTokens
                  stakedTokens
                  createdAtEpoch
                  closedAtEpoch
                  indexingRewards
                  queryFees
                  status
                  deniedAt
                }
              }
            `,
            {
              filter: {
                active: active,
                claimable: claimable ,
                allocations: id === 'all' || !id ? null : [toAddress(id)],
                subgraphDeployment: deploymentString
              },
            },
          )
          .toPromise()

        if (result.error) {
          throw result.error
        }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allocations = result.data.allocations.filter((allocation: any) => deployment === 'all' || new SubgraphDeploymentID(allocation.deployment) === new SubgraphDeploymentID(deployment))
        printIndexerAllocations(print, outputFormat, allocations, [
          'id',
          'subgraphDeployment',
          'allocatedTokens',
          'createdAtEpoch',
          'signalAmount',
          'stakedTokens',
        ])
      } catch (error) {
        print.error(error.toString())
        process.exitCode = 1
        return
      }
    },
}
