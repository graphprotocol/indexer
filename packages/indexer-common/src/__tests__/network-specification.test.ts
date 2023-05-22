import * as fs from 'fs'
import * as path from 'path'
import * as YAML from 'yaml'
import { NetworkSpecification } from '../network-specification'

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
  describe('Failed deserialization', () => {
    test('missing field', () => {
      const invalidFile = readYamlFile('invalid-missing-field.yml')
      expect(() => NetworkSpecification.parse(invalidFile)).toThrow()
    })

    test('extra field', () => {
      const invalidFile = readYamlFile('invalid-extra-field.yml')
      expect(() => NetworkSpecification.parse(invalidFile)).toThrow()
    })

    test('invalid network identifier field', () => {
      const invalidFile = readYamlFile('invalid-network-identifier.yml')
      expect(() => NetworkSpecification.parse(invalidFile)).toThrow()
    })

    test('invalid base58 field', () => {
      const invalidFile = readYamlFile('invalid-base58.yml')
      expect(() => NetworkSpecification.parse(invalidFile)).toThrow()
    })
  })
})
