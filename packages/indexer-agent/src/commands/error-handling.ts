import { ZodError } from 'zod'
import {
  fromZodError,
  FromZodErrorOptions,
  ValidationError,
} from 'zod-validation-error'

type ErrorFormatOptions = Pick<
  Required<FromZodErrorOptions>,
  'issueSeparator' | 'prefix' | 'prefixSeparator'
>

const errorFormatOptions: ErrorFormatOptions = {
  // Arbitrary character sequence that is unlikely to appear as part of a validation
  // message. It is used for splitting the concateneted error message into individual
  // issues.
  issueSeparator: '@#validation-error#@',
  prefixSeparator: ':',
  prefix: 'Indexer Agent Configuration Error(s)',
}

// Converts a ValidationError into human-friendly error messages. It utilizes
// 'zod-validation-error' to produce these messages from Zod errors, then re-formats the
// concatenated messages into a list with one issue per line, optionally including the
// original file path in the error message.
function formatError(
  error: ValidationError,
  errorFormatOptions: ErrorFormatOptions,
  filePath?: string,
) {
  const prefix = errorFormatOptions.prefix + errorFormatOptions.prefixSeparator
  const issues = error
    .toString()
    .substring(prefix.length)
    .split(errorFormatOptions.issueSeparator)
    .map(issue => issue.trim())
    .map(issue => `- ${issue}`)
    .join('\n')
  const file = filePath ? `  [ file: ${filePath} ]` : ''
  return `${prefix}${file}\n${issues}`
}

// Helper funciton that processeses a ZodError and displays validation issues in the
// terminal using a human-friendly format
export function displayZodParsingError(error: ZodError, filePath?: string) {
  const validationError = fromZodError(error, errorFormatOptions)
  const formattedError = formatError(
    validationError,
    errorFormatOptions,
    filePath,
  )
  console.error(formattedError)
}
