/* eslint-disable @typescript-eslint/no-explicit-any */

// Workaround for https://github.com/infinitered/gluegun/pull/464.
//
// There is currently no way in Gluegun to define command-line options
// that take no arguments (like `--watch`). As a consequence, boolean
// options like `--watch` will consume the immediately following argument,
// leading to confusing behavior.
//
// E.g. `graph deploy --watch subgraph/name
//
// Will result in
// ```
// toolbox.parameters.options === { watch: 'subgraph/name' }
// toolbox.parameters.first === undefined
// toolbox.parameters.array === []
// ```
// where what we really want is
// ```
// toolbox.parameters.options === { watch: true }
// toolbox.parameters.first = 'subgraph/name'
// toolbox.parameters.array = ['subgraph/name']
// ```
//
// The `fixParameters` function checks if any of the provided boolean
// options has a string value; if so, it pushes it to the front of the
// parameters array and returns the result of that.

import { table, getBorderCharacters } from 'table'
import yaml from 'yaml'
import { GluegunParameters, GluegunPrint } from 'gluegun'
import { utils } from 'ethers'

export const fixParameters = (
  parameters: GluegunParameters,
  booleanOptions: { [key: string]: any },
): string[] | undefined => {
  const unexpectedStringOptions = Object.keys(booleanOptions)
    .filter(key => typeof booleanOptions[key] === 'string')
    .map(key => ({ key, value: booleanOptions[key] }))

  const optionNames = unexpectedStringOptions
    .map(({ key }) => `--` + key.replace(/([A-Z])/, '-$1').toLowerCase())
    .join(', ')

  if (unexpectedStringOptions.length > 1) {
    throw new Error(
      `Unexpected value provided for one or more of ${optionNames}. See --help for more information`,
    )
  } else if (unexpectedStringOptions.length == 1) {
    const params = parameters.array
    params?.unshift(unexpectedStringOptions[0].value)
    return params
  } else {
    return parameters.array
  }
}

export const formatData = (
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  data: any,
  format: 'json' | 'yaml' | 'table',
): string =>
  format === 'json'
    ? JSON.stringify(data, null, 2)
    : format === 'yaml'
    ? yaml.stringify(data).trim()
    : Array.isArray(data)
    ? data.length === 0
      ? 'No data'
      : table([Object.keys(data[0]), ...data.map(row => Object.values(row))], {
          border: getBorderCharacters('norc'),
        }).trim()
    : table([Object.keys(data), Object.values(data)], {
        border: getBorderCharacters('norc'),
      }).trim()

export function pickFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rule: { [key: string]: any },
  keys: string[],
  drop: string[] = ['__typename'],
  // eslint-disable-next-line @typescript-eslint/ban-types
): object {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj = {} as any
  if (keys.length === 0) {
    obj = { ...rule }
  } else {
    for (const key of keys) {
      obj[key] = rule[key]
    }
  }
  for (const key of drop) {
    delete obj[key]
  }
  return obj
}

export function displayObjectData(
  outputFormat: 'table' | 'json' | 'yaml',
  data: object,
): string {
  return outputFormat === 'json'
    ? JSON.stringify(data, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(data).trim()
    : table([Object.keys(data), Object.values(data)], {
        border: getBorderCharacters('norc'),
      }).trim()
}

export function displayObjectArrayData(
  outputFormat: 'table' | 'json' | 'yaml',
  data: object[],
): string {
  return outputFormat === 'json'
    ? JSON.stringify(data, null, 2)
    : outputFormat === 'yaml'
    ? yaml.stringify(data).trim()
    : data.length === 0
    ? 'No items found'
    : table([Object.keys(data[0]), ...data.map(item => Object.values(item))], {
        border: getBorderCharacters('norc'),
      }).trim()
}

export function printObjectOrArray(
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  data: object | object[],
  keys: string[],
): void {
  if (Array.isArray(data)) {
    const formatted = data.map(item => pickFields(item, keys))
    print.info(displayObjectArrayData(outputFormat, formatted))
  } else if (data) {
    print.info(displayObjectData(outputFormat, pickFields(data, keys)))
  } else {
    print.error(`No items returned`)
  }
}

export async function validateRequiredParams(
  paramsObject: Record<string, unknown>,
  requiredParams: string[],
): Promise<void> {
  const missingFields = requiredParams.filter(field => paramsObject[field] === undefined)
  if (missingFields.length >= 1) {
    // TODO: Convert to action type specific types (instead of genericActionInput) so the missingField values are meaningful
    throw Error(`Missing required input parameters: ${missingFields}`)
  }
}

export async function validatePOI(poi: string | undefined): Promise<string | undefined> {
  if (poi !== undefined) {
    if (typeof poi == 'number' && poi == 0) {
      poi = utils.hexlify(Array(32).fill(0))
    }
    // Ensure user provided POI is formatted properly - '0x...' (32 bytes)
    const isHex = utils.isHexString(poi, 32)
    if (!isHex) {
      throw new Error('Must be a 32 byte length hex string')
    }
  }
  return poi
}
