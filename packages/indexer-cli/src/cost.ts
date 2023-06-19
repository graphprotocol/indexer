import { SubgraphDeploymentID } from '@tokene-q/common-ts'
import {
  CostModelAttributes,
  GraphQLCostModel,
  IndexerManagementClient,
} from '@graphprotocol/indexer-common'
import gql from 'graphql-tag'
import yaml from 'yaml'
import { GluegunPrint } from 'gluegun'
import { table, getBorderCharacters } from 'table'
import { OutputFormat, pickFields } from './command-helpers'

export type SubgraphDeploymentIDIsh = SubgraphDeploymentID | 'all' | 'global'

export const parseDeploymentID = (s: string): SubgraphDeploymentIDIsh => {
  if (s === 'all' || s === 'global') {
    return s
  } else {
    return new SubgraphDeploymentID(s)
  }
}

function nullPassThrough<T, U>(fn: (x: T) => U): (x: T | null) => U | null {
  return (x: T | null) => (x === null ? null : fn(x))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COST_MODEL_PARSERS: Record<keyof CostModelAttributes, (x: never) => any> = {
  id: x => x,
  deployment: parseDeploymentID,
  model: x => x,
  variables: nullPassThrough(JSON.parse),
}

const COST_MODEL_FORMATTERS: Record<
  keyof CostModelAttributes,
  (x: never) => string | null
> = {
  id: x => x,
  deployment: (d: SubgraphDeploymentIDIsh) => (typeof d === 'string' ? d : d.ipfsHash),
  model: x => x,
  variables: nullPassThrough(s => JSON.stringify(s, null, 2)),
}

const COST_MODEL_CONVERTERS_FROM_GRAPHQL: Record<
  keyof CostModelAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  deployment: parseDeploymentID,
  model: x => x,
  variables: nullPassThrough(JSON.parse),
}

const COST_MODEL_CONVERTERS_TO_GRAPHQL: Record<
  keyof CostModelAttributes,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (x: never) => any
> = {
  id: x => x,
  deployment: (x: SubgraphDeploymentIDIsh) => x.toString(),
  model: x => x,
  variables: nullPassThrough(JSON.stringify),
}

/**
 * Parses a user-provided cost model into a normalized form.
 */
export const parseCostModel = (
  cost: Partial<GraphQLCostModel>,
): Partial<CostModelAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(cost)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (COST_MODEL_PARSERS as any)[key](value)
  }
  return obj as Partial<CostModelAttributes>
}

/**
 * Formats a cost model for display in the console.
 */
export const formatCostModel = (
  cost: Partial<CostModelAttributes>,
  { variablesAsString }: { variablesAsString: boolean },
): Partial<CostModelAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(cost)) {
    if (key === 'variables' && !variablesAsString) {
      obj[key] = value
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obj[key] = (COST_MODEL_FORMATTERS as any)[key](value)
    }
  }
  return obj as Partial<CostModelAttributes>
}

/**
 * Parses a cost model returned from the indexer management GraphQL
 * API into normalized form.
 */
export const costModelFromGraphQL = (
  cost: Partial<CostModelAttributes>,
): Partial<CostModelAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(cost)) {
    if (key === '__typename') {
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (COST_MODEL_CONVERTERS_FROM_GRAPHQL as any)[key](value)
  }
  return obj as Partial<CostModelAttributes>
}

/**
 * Converts a normalized cost model to a representation
 * compatible with the indexer management GraphQL API.
 */
export const costModelToGraphQL = (
  cost: Partial<CostModelAttributes>,
): Partial<CostModelAttributes> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = {} as any
  for (const [key, value] of Object.entries(cost)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj[key] = (COST_MODEL_CONVERTERS_TO_GRAPHQL as any)[key](value)
  }
  return obj as Partial<CostModelAttributes>
}

export const displayCostModels = (
  outputFormat: OutputFormat,
  costModels: Partial<CostModelAttributes>[],
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(costModels, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(costModels).trim()
    : costModels.length === 0
    ? 'No data'
    : table(
        [Object.keys(costModels[0]), ...costModels.map(cost => Object.values(cost))],
        {
          border: getBorderCharacters('norc'),
        },
      ).trim()

export const displayCostModel = (
  outputFormat: OutputFormat,
  cost: Partial<CostModelAttributes>,
): string =>
  outputFormat === OutputFormat.Json
    ? JSON.stringify(cost, null, 2)
    : outputFormat === OutputFormat.Yaml
    ? yaml.stringify(cost).trim()
    : table([Object.keys(cost), Object.values(cost)], {
        border: getBorderCharacters('norc'),
      }).trim()

export const printCostModels = (
  print: GluegunPrint,
  outputFormat: OutputFormat,
  deployment: SubgraphDeploymentIDIsh | null,
  costModelOrModels: Partial<CostModelAttributes> | Partial<CostModelAttributes>[] | null,
  fields: string[],
): void => {
  if (Array.isArray(costModelOrModels)) {
    const costModels = costModelOrModels.map(cost =>
      formatCostModel(pickFields(cost, fields), {
        variablesAsString: outputFormat === 'table',
      }),
    )
    print.info(displayCostModels(outputFormat, costModels))
  } else if (costModelOrModels) {
    const cost = formatCostModel(pickFields(costModelOrModels, fields), {
      variablesAsString: outputFormat === 'table',
    })
    print.info(displayCostModel(outputFormat, cost))
  } else if (deployment) {
    print.error(`No cost model/variables found for "${deployment}"`)
  } else {
    print.error(`No cost models/variables found`)
  }
}

export const costModels = async (
  client: IndexerManagementClient,
): Promise<Partial<CostModelAttributes>[]> => {
  const result = await client
    .query(
      gql`
        {
          costModels {
            deployment
            model
            variables
          }
        }
      `,
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return result.data.costModels.map(costModelFromGraphQL)
}

export const costModel = async (
  client: IndexerManagementClient,
  deployment: SubgraphDeploymentIDIsh,
): Promise<Partial<CostModelAttributes> | null> => {
  const result = await client
    .query(
      gql`
        query costModel($deployment: String!) {
          costModel(deployment: $deployment) {
            deployment
            model
            variables
          }
        }
      `,
      { deployment: deployment.toString() },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  if (result.data.costModel) {
    return costModelFromGraphQL(result.data.costModel)
  } else {
    return null
  }
}

export const setCostModel = async (
  client: IndexerManagementClient,
  costModel: Partial<CostModelAttributes>,
): Promise<Partial<CostModelAttributes>> => {
  const result = await client
    .mutation(
      gql`
        mutation setCostModel($costModel: CostModelInput!) {
          setCostModel(costModel: $costModel) {
            deployment
            model
            variables
          }
        }
      `,
      { costModel: costModelToGraphQL(costModel) },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }

  return costModelFromGraphQL(result.data.setCostModel)
}

export const deleteCostModels = async (
  client: IndexerManagementClient,
  deployments: string[],
): Promise<number> => {
  const result = await client
    .mutation(
      gql`
        mutation deleteCostModels($deployments: [String!]!) {
          deleteCostModels(deployments: $deployments) {
            deployment
            model
            variables
          }
        }
      `,
      { deployments },
    )
    .toPromise()

  if (result.error) {
    throw result.error
  }
  return result.data.deleteCostModels
}
