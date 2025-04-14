// Final parsers (validators) that use parser combinators defined in the 'parsers' module but don't
// expose their internal parsing interface.

import P from 'parsimmon'

import { base58, networkIdentifier, supportedNetworkIdentifier } from './basic-types'
export { caip2IdRegex } from './basic-types'

// Generic function that takes a parser of type T and attempts to parse it from a string. If it
// fails, then it will throw an error with an explanation of what was expected, as well as the
// portion of the input that was parsed and what's remaining to parse.
function parse<T>(parser: P.Parser<T>, input: string): T {
  const parseResult = parser.parse(input)
  if (parseResult.status) {
    return parseResult.value
  }
  const expected = parseResult.expected[0]
  const parsed = input.slice(0, parseResult.index.offset)
  const remaining = input.slice(parseResult.index.offset)
  throw new Error(
    `Failed to parse "${input}". Expected: ${expected}. Parsed up to: "${parsed}". Remaining: "${remaining}"`,
  )
}

export function validateNetworkIdentifier(input: string): string {
  return parse(networkIdentifier, input)
}

export function validateSupportedNetworkIdentifier(input: string): string {
  return parse(supportedNetworkIdentifier, input)
}

export function validateIpfsHash(input: string): string {
  return parse(base58, input)
}
