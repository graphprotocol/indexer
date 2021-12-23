import { GluegunToolbox } from 'gluegun'
import chalk from 'chalk'

import { loadValidatedConfig } from '../../../config'
import { createIndexerManagementClient } from '../../../client'
import {BigNumber } from "ethers";
import { createAllocation } from "../../../allocations";
import {processIdentifier, SubgraphIdentifierType} from "@graphprotocol/indexer-common";

const HELP = `
${chalk.bold('graph indexer allocations create')} [options] <deployment-id> <amount>

${chalk.dim('Options:')}

  -h, --help                    Show usage information
  -f, --force                   Bypass POI accuracy checks and submit transaction with provided data 
`

module.exports = {
  name: 'create',
  alias: [],
  description: 'Create an allocation',
    run: async (toolbox: GluegunToolbox) => {
      const { print, parameters } = toolbox

      const {
        h,
        help,
      } = parameters.options

      const toHelp = help || h || undefined

      if (toHelp) {
        print.info(HELP)
        return
      }

      const [deploymentID, amount] = parameters.array || []

      try {
        if (!deploymentID || !amount) {
          throw new Error(`Must provide a deployment ID and allocation amount (deploymentID: '${deploymentID}', allocationAmount: '${amount}'`)
        }
        const [deploymentString, type] = await processIdentifier(deploymentID, { all: false, global: false })
        if(type !== SubgraphIdentifierType.DEPLOYMENT) {
          throw Error(`Invalid 'deploymentID' provided (${deploymentID}), must be bytes32 or base58 formatted)`)
        }
        const allocationAmount = BigNumber.from(amount)

        const config = loadValidatedConfig()
        const client = await createIndexerManagementClient({ url: config.api })

        const allocateResult = await createAllocation(client, deploymentString, allocationAmount)
        print.info(allocateResult)
      } catch (error) {
        print.error(error.toString())
        process.exitCode = 1
        return
      }
    },
}
