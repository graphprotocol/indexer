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
import wrapAnsi from 'wrap-ansi'

export enum OutputFormat {
  Table = 'table',
  Json = 'json',
  Yaml = 'yaml',
}
import yaml from 'yaml'
import { GluegunParameters, GluegunPrint } from 'gluegun'
import { validateNetworkIdentifier } from '@graphprotocol/indexer-common'
import { hexlify, isHexString } from 'ethers'

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
  format: OutputFormat,
): string =>
  format === OutputFormat.Json
    ? JSON.stringify(data, null, 2)
    : format === OutputFormat.Yaml
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

export function displayObjectData(outputFormat: OutputFormat, data: object, wrapWidth: number): string {
  if (outputFormat === OutputFormat.Json) {
    return JSON.stringify(data, null, 2)
  } else if (outputFormat === OutputFormat.Yaml) {
    return yaml.stringify(data).trim()
  } else {
    const keys = Object.keys(data)
    const values = Object.values(data).map(value => wrapCell(value, wrapWidth))

    return table([keys, values], {
      border: getBorderCharacters('norc'),
    }).trim()
  }
}

export function displayObjectArrayData(
  outputFormat: OutputFormat,
  data: object[],
  wrapWidth: number,
): string {
  if (outputFormat === OutputFormat.Json) {
    return JSON.stringify(data, null, 2)
  } else if (outputFormat === OutputFormat.Yaml) {
    return yaml.stringify(data).trim()
  } else if (data.length === 0) {
    return 'No items found'
  } else {
    const keys = Object.keys(data[0])

    const tableData = [
      keys,
      ...data.map(item => keys.map(key => wrapCell((item as any)[key], wrapWidth))),
    ]

    return table(tableData, {
      border: getBorderCharacters('norc'),
    }).trim()
  }
}

export function printObjectOrArray(
  print: GluegunPrint,
  outputFormat: OutputFormat,
  data: object | object[],
  keys: string[],
  wrapWidth: number = 0,
): void {
  if (Array.isArray(data)) {
    const formatted = data.map(item => pickFields(item, keys))
    print.info(displayObjectArrayData(outputFormat, formatted, wrapWidth))
  } else if (data) {
    print.info(displayObjectData(outputFormat, pickFields(data, keys), wrapWidth))
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

export function validatePOI(poi: string | undefined): string | undefined {
  if (poi !== undefined) {
    if (typeof poi == 'number' && poi == 0) {
      poi = hexlify(new Uint8Array(32).fill(0))
    }
    if (typeof poi == 'string' && poi == '0') {
      poi = hexlify(new Uint8Array(32).fill(0))
    }
    // Ensure user provided POI is formatted properly - '0x...' (32 bytes)
    const isHex = isHexString(poi, 32)
    if (!isHex) {
      throw new Error(
        `Invalid POI provided ('${poi}'): Must be a 32 byte length hex string`,
      )
    }
  }
  return poi
}

export function parseOutputFormat(
  print: GluegunPrint,
  outputFormat: string,
): OutputFormat | undefined {
  switch (outputFormat) {
    case OutputFormat.Table:
      print.colors.enable()
      return OutputFormat.Table
    case OutputFormat.Json:
      print.colors.disable()
      return OutputFormat.Json
    case OutputFormat.Yaml:
      print.colors.disable()
      return OutputFormat.Yaml
    default:
      print.error(`Invalid output format "${outputFormat}"`)
      return
  }
}

// Simple spell checker:
// Suggest commands by shared letters (80% input match valid command letter sets)
export function suggestCommands(
  command: string,
  supported_commands: string[],
): Array<string> {
  const letters = command.split('')
  const suggestions = supported_commands.filter(
    cmd => letters.filter(l => cmd.indexOf(l) == -1).length < command.length / 5,
  )
  return suggestions.length > 0 ? suggestions : supported_commands
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractProtocolNetworkOption(
  options: {
    [key: string]: any
  },
  required = false,
): string | undefined {
  const { n, network } = options

  // Tries to extract the --network option from Gluegun options.
  // Throws if required is set to true and the option is not found.
  if (!n && !network) {
    if (required) {
      throw new Error("The option '--network' is required")
    } else {
      return undefined
    }
  }

  // Check for invalid usage
  const allowedUsages =
    (n === undefined && typeof network === 'string') ||
    (network === undefined && typeof n === 'string')
  if (!allowedUsages) {
    throw new Error("Invalid usage of the option '--network'")
  }
  const input = (network ?? n) as string

  try {
    return validateNetworkIdentifier(input)
  } catch (parseError) {
    throw new Error(`Invalid value for the option '--network'. ${parseError}`)
  }
}

// Same as `extractProtocolNetworkOption`, but always require the --network option to be set
export function requireProtocolNetworkOption(options: { [key: string]: any }): string {
  const protocolNetwork = extractProtocolNetworkOption(options, true)
  if (!protocolNetwork) {
    throw new Error("The option '--network' is required")
  }
  return protocolNetwork
}


export function wrapCell(value: unknown, wrapWidth: number): string {
  return wrapWidth > 0
    ? wrapAnsi(String(value), wrapWidth, { hard: true })
    : String(value)
}