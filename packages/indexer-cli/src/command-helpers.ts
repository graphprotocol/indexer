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
      `Unexpected value provided for one or more of ${optionNames}. See --help for more information.`,
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

export function printObjectData(
  print: GluegunPrint,
  outputFormat: 'table' | 'json' | 'yaml',
  data: object,
  keys: string[],
): void {
  print.info(displayObjectData(outputFormat, pickFields(data, keys)))
}
