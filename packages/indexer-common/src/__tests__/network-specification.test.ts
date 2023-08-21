import * as fs from 'fs'
import * as path from 'path'
import * as YAML from 'yaml'
import {
  NetworkSpecification,
  IndexerOptions,
  TransactionMonitoring,
} from '../network-specification'

function readYamlFile(p: string): string {
  const filePath = path.join(__dirname, 'network-specification-files', p)
  const text = fs.readFileSync(filePath, 'utf8')
  return YAML.parse(text)
}

describe('Network Specification deserialization', () => {
  describe('Successful deserialization', () => {
    test('Valid specification file', () => {
      const validFile = readYamlFile('valid.yml')
      NetworkSpecification.parse(validFile)
    })
  })

  describe('Successful deserialization with missing defaults', () => {
    test('Valid specification file', () => {
      const validFile = readYamlFile('valid-missing.yml')
      const parsed = NetworkSpecification.parse(validFile)
      const expectedDefaults = TransactionMonitoring.parse({})
      expect(expectedDefaults).not.toEqual({}) // Ensures default is not an empty object
      expect(parsed.transactionMonitoring).toStrictEqual(expectedDefaults)
    })
  })
})

interface FailedDeserializationTest {
  file: string
  path: string[]
  message: string
}

describe('Failed deserialization', () => {
  const failedTests: FailedDeserializationTest[] = [
    {
      file: 'invalid-epoch-subgraph.yml',
      path: ['subgraphs', 'epochSubgraph', 'url'],
      message: 'Epoch Subgraph endpoint must be defined',
    },
    {
      file: 'invalid-missing-field.yml',
      path: ['indexerOptions', 'address'],
      message: 'Required',
    },
    {
      file: 'invalid-extra-field.yml',
      path: ['indexerOptions'],
      message: "Unrecognized key(s) in object: 'invalidExtraField'",
    },
    {
      file: 'invalid-network-identifier.yml',
      path: ['networkIdentifier'],
      message: 'Invalid network identifier',
    },
    {
      file: 'invalid-base58.yml',
      path: ['subgraphs', 'networkSubgraph', 'deployment'],
      message: 'Invalid IPFS hash',
    },
    {
      file: 'invalid-address.yml',
      path: ['dai', 'contractAddress'],
      message: 'Invalid contract address',
    },
  ]

  test.each(failedTests)(
    'Validation should fail for $file',
    (t: FailedDeserializationTest) => {
      const invalidFile = readYamlFile(t.file)
      const result = NetworkSpecification.safeParse(invalidFile)
      expect(result.success).toBe(false)
      if (result.success === false) {
        const issue = result.error.issues[0]
        expect(issue.path).toStrictEqual(t.path)
        expect(issue.message).toStrictEqual(t.message)
      } else {
        fail('This deserialization test should have failed')
      }
    },
  )
})

describe('Specificaiton parts parsing', () => {
  test('Valid Indexer Options should parse successfully', () => {
    IndexerOptions.parse({
      address: '0xdf9CAc44924C21a6c874ee3C727b1c9Ccd5b58cc',
      mnemonic: 'any valid string can work',
      url: 'http://example.com',
      geoCoordinates: [60.16952, 24.93545], // Must be numbers
    })
  })
})
