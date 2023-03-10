import { formatDeploymentName, cleanDeploymentName } from '../types'
import { BigNumber } from 'ethers'
import { SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'

describe('formatDeploymentName function tests', () => {
  const creatorAddress = toAddress('0x6d2e03b7EfFEae98BD302A9F836D0d6Ab0002766')
  const name = 'testSubgraphName'
  const ipfsHash = 'Qmadj8x9km1YEyKmRnJ6EkC2zpJZFCfTyTZpuqC3j6e1QH'
  const base = {
    id: new SubgraphDeploymentID(ipfsHash),
    deniedAt: 0,
    stakedTokenns: BigNumber.from(0),
    signalledTokens: BigNumber.from(0),
    queryFeesAmount: BigNumber.from(0),
    stakedTokens: BigNumber.from(0),
    activeAllocations: 0,
  }

  test('formatDeploymentName can handle existing subgraph and owner information', async () => {
    const nameAndOwner = {
      name,
      creatorAddress,
      ...base,
    }
    expect(formatDeploymentName(nameAndOwner)).toBe(
      `${name}/${ipfsHash}/${creatorAddress}`,
    )
  })

  test('formatDeploymentName can handle missing owner name', async () => {
    const noOwner = {
      name,
      ...base,
    }
    expect(formatDeploymentName(noOwner)).toBe(`${name}/${ipfsHash}/unknownCreator`)
  })

  test('formatDeploymentName can handle missing subgraph name', async () => {
    const noName = {
      creatorAddress,
      ...base,
    }
    expect(formatDeploymentName(noName)).toBe(
      `unknownSubgraph/${ipfsHash}/${creatorAddress}`,
    )
  })

  test('formatDeploymentName can handle missing subgraph and owner names', async () => {
    expect(formatDeploymentName(base)).toBe(`unknownSubgraph/${ipfsHash}/unknownCreator`)
  })
})

describe('cleanDeploymentName function tests', () => {
  test('can handle null input', () => {
    expect(cleanDeploymentName(undefined)).toBe('unknownSubgraph')
  })
  test('can remove invalid characters', () => {
    expect(cleanDeploymentName('abc!@"#$%^&*()-def_123')).toBe('abc-def_123')
  })
  test('can strip invalid charecters from start', () => {
    expect(cleanDeploymentName('_abc')).toBe('abc')
    expect(cleanDeploymentName('-abc')).toBe('abc')
  })
  test('can strip invalid charecters from the end', () => {
    expect(cleanDeploymentName('abc_')).toBe('abc')
    expect(cleanDeploymentName('abc-')).toBe('abc')
  })
  test('can strip invalid charecters from both ends', () => {
    expect(cleanDeploymentName('_abc_')).toBe('abc')
    expect(cleanDeploymentName('-abc-')).toBe('abc')
  })
  test('can clean empty strings', () => {
    expect(cleanDeploymentName('')).toBe('unknownSubgraph')
    expect(cleanDeploymentName('--')).toBe('unknownSubgraph')
    expect(cleanDeploymentName('_')).toBe('unknownSubgraph')
  })
  test('can clean the special name "graphql"', () => {
    expect(cleanDeploymentName('graphql')).toBe('graphql-subgraph')
    expect(cleanDeploymentName('-graphql-')).toBe('graphql-subgraph')
    expect(cleanDeploymentName('_graphql')).toBe('graphql-subgraph')
    expect(cleanDeploymentName('graphql_')).toBe('graphql-subgraph')
  })
  test('can chop the subgraph name to the adequate size', () => {
    const reallyLongName = // 200 chars
      'y2feiw6y0eihrau5m5my0g0wvg6e2qbf79k91wzhcoep40hrend3re36jaejomss0goyaxx6yph5rrwieg3gkrvys699riza6kfak1tx9uy46onxt4fs3tp95e05v3xcf0jdldsz5ukqozsefo53wxl2m5rh5cdx8dkxq1fktr'
    expect(cleanDeploymentName(reallyLongName)).toHaveLength(165)
  })
})
