import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {
  requireProtocolNetworkOption,
  fixParameters,
  parseOutputFormat,
} from '../../../command-helpers'
import { indexingRules, deleteIndexingRules } from '../../../rules'
import { processIdentifier, resolveChainAlias } from '@graphprotocol/indexer-common'

const HELP = `
${chalk.bold('graph indexer rules delete')} [options] all
${chalk.bold('graph indexer rules delete')} [options] global
${chalk.bold('graph indexer rules delete')} [options] <deployment-id>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -n, --network                 [Required] the rule's protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
  -o, --output table|json|yaml  Choose the output format: table (default), JSON, or YAML
`

module.exports = {
  name: 'delete',
  description: 'Remove one or many indexing rules',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox
    const { h, help, o, output } = parameters.options
    const [id] = fixParameters(parameters, { h, help }) || []
    const outputFormat = parseOutputFormat(print, o || output || 'table')

    if (help || h) {
      print.info(HELP)
      return
    }
    if (!outputFormat) {
      process.exitCode = 1
      return
    }

    const config = loadValidatedConfig()

    try {
      const protocolNetwork = requireProtocolNetworkOption(parameters.options)
      const [identifier, identifierType] = await processIdentifier(id, {
        all: true,
        global: true,
      })

      const client = await createIndexerManagementClient({ url: config.api })

      if (identifier === 'all') {
        const rules = await indexingRules(client, false, protocolNetwork)

        const rulesIdentifiers = await Promise.all(
          rules.map(async function (rule) {
            const identifier = (
              await processIdentifier(
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                rule.identifier!,
                {
                  all: true,
                  global: true,
                },
              )
            )[0]

            // All rules returned from `indexingRules` are have a `protocolNetwork` field, so we
            // don't expect to see this error.
            if (!rule.protocolNetwork) {
              throw Error(
                `Indexing Rule is missing a 'protocolNetwork' attribute: ${JSON.stringify(
                  rule,
                )}`,
              )
            }

            return {
              identifier,
              protocolNetwork: rule.protocolNetwork,
            }
          }),
        )

        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        await deleteIndexingRules(client, rulesIdentifiers)
        /* eslint-enable @typescript-eslint/no-non-null-assertion */
        print.success('Deleted all indexing rules')
        return
      }

      // Since we are not deleting all rules, we must require a protocol network from the user
      if (!protocolNetwork) {
        throw Error(
          'The --network option must be used when deleting a glboal Indexing Rule',
        )
      }
      const chainAlias = resolveChainAlias(protocolNetwork)

      if (identifier === 'global') {
        const globalIdentifier = { identifier, protocolNetwork }
        await deleteIndexingRules(client, [globalIdentifier])
        print.warning(
          `Reset global indexing rules for network '${chainAlias}' (global rules cannot be deleted)`,
        )
      } else {
        const ruleIdentifier = { identifier, protocolNetwork }
        await deleteIndexingRules(client, [ruleIdentifier])
        print.success(
          `Deleted indexing rules for "${identifier}" (${identifierType}) on network: '${chainAlias}'`,
        )
      }
    } catch (error) {
      print.error(error.toString())
      process.exitCode = 1
    }
  },
}
