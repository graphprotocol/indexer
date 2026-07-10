import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'
import gql from 'graphql-tag'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import { closeAllocation } from '../../../allocations'
import { indexingRule } from '../../../rules'
import {
  isDipsManagedRule,
  closedAllocationAgreementNotice,
  activeAgreementRevertGuidance,
} from '../../../indexing-agreement-notices'
import {
  validatePOI,
  printObjectOrArray,
  extractProtocolNetworkOption,
  getRawPositionalArgs,
} from '../../../command-helpers'
import { resolveChainAlias } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold(
  'graph indexer allocations close',
)} [options] <id> <poi> <blockNumber> <publicPOI>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network <network>       The network to close the allocation on: mainnet, arbitrum-one, sepolia or arbitrum sepolia
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
  -w, --wrap [N]                Wrap the output to a specific width (default: 0, no wrapping)

${chalk.dim('Arguments:')}
  <id>                            The allocation id to close
  <poi>                           (optional) The POI to close the allocation with
  <blockNumber>                   (optional, horizon only) The block number the POI was computed at. Must be set if POI is provided.
  <publicPOI>                     (optional, horizon only) The public POI to close the allocation with. Must be same block height as POI.
`

module.exports = {
  name: 'close',
  alias: [],
  description: 'Close an allocation',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { h, help, f, force, o, output, w, wrap } = parameters.options

    const outputFormat = o || output || 'table'
    const toHelp = help || h || undefined
    const toForce = force || f || false
    const wrapWidth = w || wrap || 0

    if (toHelp) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    if (!['json', 'yaml', 'table'].includes(outputFormat)) {
      spinner.fail(`Invalid output format "${outputFormat}"`)
      process.exitCode = 1
      return
    }

    const [id, unformattedPoi, unformattedBlockNumber, unformattedPublicPOI] =
      getRawPositionalArgs(parameters.array || [])

    if (id === undefined) {
      spinner.fail(`Missing required argument: 'id'`)
      print.info(HELP)
      process.exitCode = 1
      return
    }

    let poi: string | undefined
    let blockNumber: number | undefined
    let publicPOI: string | undefined
    try {
      poi = validatePOI(unformattedPoi)
      publicPOI = validatePOI(unformattedPublicPOI)
      blockNumber =
        unformattedBlockNumber === undefined ? undefined : Number(unformattedBlockNumber)
    } catch (error) {
      spinner.fail(`Invalid value provided: ` + error.message)
      process.exitCode = 1
      return
    }

    spinner.text = `Closing allocation '${id}`
    try {
      const protocolNetwork = extractProtocolNetworkOption(parameters.options, true)

      if (!protocolNetwork) {
        throw new Error(
          'Must provide a network identifier' + `(network: '${protocolNetwork}')`,
        )
      }

      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      // Fetched before the close so the DIPS notice (and the revert guidance
      // below) can name the deployment; the close result does not carry it.
      let deployment: string | undefined
      try {
        const result = await client
          .query(
            gql`
              query allocations($filter: AllocationFilter!) {
                allocations(filter: $filter) {
                  id
                  subgraphDeployment
                }
              }
            `,
            { filter: { allocation: id, protocolNetwork } },
          )
          .toPromise()
        deployment = result.data?.allocations?.[0]?.subgraphDeployment
      } catch (lookupError) {
        print.info(`Could not look up the allocation's deployment: ${lookupError}`)
      }
      const networkAlias = resolveChainAlias(protocolNetwork)

      let closeResult
      try {
        closeResult = await closeAllocation(
          client,
          id,
          poi,
          blockNumber,
          publicPOI,
          toForce,
          protocolNetwork,
        )
      } catch (closeError) {
        const guidance = activeAgreementRevertGuidance(
          closeError.toString(),
          deployment,
          networkAlias,
        )
        if (guidance) {
          spinner.fail('Allocation close blocked by the network')
          print.warning(guidance)
          process.exitCode = 1
          return
        }
        throw closeError
      }

      spinner.succeed('Allocation closed')
      printObjectOrArray(
        print,
        outputFormat,
        closeResult,
        ['allocation', 'allocatedTokens', 'indexingRewards'],
        wrapWidth,
      )

      if (deployment) {
        try {
          const rule = await indexingRule(
            client,
            { identifier: deployment, protocolNetwork },
            false,
          )
          if (isDipsManagedRule(rule)) {
            print.warning(closedAllocationAgreementNotice(deployment, networkAlias))
          }
        } catch (ruleError) {
          print.info(`Could not check for an indexing agreement rule: ${ruleError}`)
        }
      }
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
