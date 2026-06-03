import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../../config'
import { createIndexerManagementClient } from '../../../../client'
import {
  extractProtocolNetworkOption,
  fixParameters,
} from '../../../../command-helpers'
import gql from 'graphql-tag'
import { SubgraphDeploymentID } from '@graphprotocol/common-ts'
import { processIdentifier, SubgraphIdentifierType } from '@graphprotocol/indexer-common'
import { IndexingAgreement, printIndexingAgreements } from '../../../../dips'
import { isHexString } from 'ethers'

const HELP = `
${chalk.bold('graph indexer dips agreements get')} [options]
${chalk.bold('graph indexer dips agreements get')} [options] <agreement-id>
${chalk.bold('graph indexer dips agreements get')} [options] all

${chalk.dim('Options:')}

  -h, --help                                                              Show usage information
  -n, --network <network>                                                 Filter agreements by their protocol network (mainnet, arbitrum-one, sepolia, arbitrum-sepolia)
      --status Accepted|CanceledByPayer|CanceledByServiceProvider|NotAccepted  Filter by agreement state
      --deployment <id>                                                   Fetch only agreements for a specific subgraph deployment
  -o, --output table|json|yaml                                            Choose the output format: table (default), JSON, or YAML
  -w, --wrap [N]                                                          Wrap the output to a specific width (default: 0, no wrapping)
`

const AGREEMENT_STATES = [
  'Accepted',
  'CanceledByPayer',
  'CanceledByServiceProvider',
  'NotAccepted',
]

module.exports = {
  name: 'get',
  alias: [],
  description: 'List one or more DIPs indexing agreements',
  run: async (toolbox: GluegunToolbox) => {
    const { print, parameters } = toolbox

    const spinner = toolbox.print.spin('Processing inputs')

    const { status, deployment, h, help, o, output, w, wrap } = parameters.options

    const [agreementId] = fixParameters(parameters, { h, help }) || []
    const outputFormat = o || output || 'table'
    const wrapWidth = w || wrap || 0

    if (help || h) {
      spinner.stopAndPersist({ symbol: '💁', text: HELP })
      return
    }

    try {
      const protocolNetwork = extractProtocolNetworkOption(parameters.options, true)

      if (!['json', 'yaml', 'table'].includes(outputFormat)) {
        throw Error(
          `Invalid output format "${outputFormat}" must be one of 'json', 'yaml' or 'table'`,
        )
      }

      if (status && !AGREEMENT_STATES.includes(status)) {
        throw Error(
          `Invalid '--status' provided, must be one of ${AGREEMENT_STATES.join(', ')}`,
        )
      }

      if (agreementId) {
        if (agreementId !== 'all' && !isHexString(agreementId, 16)) {
          throw Error(
            `Invalid 'agreement-id' provided ('${agreementId}'), must be a bytes16 string or 'all'`,
          )
        }

        if (agreementId == 'all') {
          if (status || deployment) {
            throw Error(
              `Invalid query, cannot specify '--status' or '--deployment' filters in addition to 'agreement-id = all'`,
            )
          }
        }
      }

      let deploymentString: string | undefined = undefined
      let type: SubgraphIdentifierType

      if (deployment) {
        ;[deploymentString, type] = await processIdentifier(deployment, {
          all: true,
          global: false,
        })
        if (type !== SubgraphIdentifierType.DEPLOYMENT) {
          throw Error(
            `Invalid '--deployment' must be a valid deployment ID (bytes32 or base58 formatted)`,
          )
        }
      }

      spinner.text = 'Querying indexer management server'
      const config = loadValidatedConfig()
      const client = await createIndexerManagementClient({ url: config.api })

      const result = await client
        .query(
          gql`
            query indexingAgreements($filter: IndexingAgreementFilter!) {
              indexingAgreements(filter: $filter) {
                id
                payer
                indexer
                allocationId
                subgraphDeploymentId
                state
                acceptedAt
                lastCollectionAt
                endsAt
                tokensPerSecond
                tokensCollected
                canceledAt
                canceledBy
                protocolNetwork
              }
            }
          `,
          {
            filter: {
              status: status ? status : null,
              agreementId:
                agreementId && agreementId !== 'all' ? agreementId : null,
              protocolNetwork,
            },
          },
        )
        .toPromise()

      if (result.error) {
        throw result.error
      }

      const agreements = deploymentString
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.data.indexingAgreements.filter((agreement: any) => {
            return (
              new SubgraphDeploymentID(agreement.subgraphDeploymentId).toString() ===
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              new SubgraphDeploymentID(deploymentString!).toString()
            )
          })
        : result.data.indexingAgreements

      let displayProperties: (keyof IndexingAgreement)[] = [
        'id',
        'subgraphDeploymentId',
        'allocationId',
        'payer',
        'state',
        'acceptedAt',
        'endsAt',
        'tokensCollected',
        'protocolNetwork',
      ]
      if (agreementId && agreementId !== 'all') {
        displayProperties = [
          'id',
          'payer',
          'indexer',
          'allocationId',
          'subgraphDeploymentId',
          'state',
          'acceptedAt',
          'lastCollectionAt',
          'endsAt',
          'tokensPerSecond',
          'tokensCollected',
          'canceledAt',
          'canceledBy',
          'protocolNetwork',
        ]
      }

      spinner.succeed('Agreements')
      printIndexingAgreements(
        print,
        outputFormat,
        agreements,
        displayProperties,
        wrapWidth,
      )
    } catch (error) {
      spinner.fail(error.toString())
      process.exitCode = 1
      return
    }
  },
}
