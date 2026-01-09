import { ActionStatus, ActionType } from '@graphprotocol/indexer-common'
import { buildActionInput, validateActionInput } from '../actions'

describe('buildActionInput', () => {
  test('builds COLLECT action input with correct structure', async () => {
    const result = await buildActionInput(
      ActionType.COLLECT,
      {
        targetDeployment: 'QmTest123',
        param1: '0xallocationId',
        param2: '0x' + 'ab'.repeat(32), // poi
        param3: 'false', // force
        param4: '12345', // blockNumber
        param5: '0x' + 'cd'.repeat(32), // publicPOI
        param6: undefined,
      },
      'test',
      'test',
      ActionStatus.QUEUED,
      0,
      'arbitrum-sepolia',
    )
    expect(result.type).toBe(ActionType.COLLECT)
    expect(result.deploymentID).toBe('QmTest123')
    expect(result.allocationID).toBe('0xallocationId')
    expect(result.poiBlockNumber).toBe(12345)
  })

  test('normalizes zero POI values for COLLECT', async () => {
    const result = await buildActionInput(
      ActionType.COLLECT,
      {
        targetDeployment: 'QmTest123',
        param1: '0xallocationId',
        param2: '0', // poi = '0'
        param3: 'false',
        param4: undefined,
        param5: '0x0', // publicPOI = '0x0'
        param6: undefined,
      },
      'test',
      'test',
      ActionStatus.QUEUED,
      0,
      'arbitrum-sepolia',
    )
    const zeroPOI = '0x' + '00'.repeat(32)
    expect(result.poi).toBe(zeroPOI)
    expect(result.publicPOI).toBe(zeroPOI)
    expect(result.force).toBe(false)
    expect(result.allocationID).toBe('0xallocationId')
    expect(result.poiBlockNumber).toBeUndefined()
  })
})

describe('validateActionInput', () => {
  test('validates COLLECT with required fields', async () => {
    await expect(
      validateActionInput(ActionType.COLLECT, {
        targetDeployment: 'QmTest123',
        param1: '0xallocationId',
        param2: undefined,
        param3: undefined,
        param4: undefined,
        param5: undefined,
        param6: undefined,
      }),
    ).resolves.not.toThrow()
  })

  test('rejects COLLECT with invalid block number', async () => {
    await expect(
      buildActionInput(
        ActionType.COLLECT,
        {
          targetDeployment: 'QmTest123',
          param1: '0xallocationId',
          param2: undefined,
          param3: undefined,
          param4: 'not-a-number', // invalid blockNumber
          param5: undefined,
          param6: undefined,
        },
        'test',
        'test',
        ActionStatus.QUEUED,
        0,
        'arbitrum-sepolia',
      ),
    ).rejects.toThrow('Invalid block number: not-a-number')
  })

  test('rejects COLLECT missing allocationID', async () => {
    await expect(
      validateActionInput(ActionType.COLLECT, {
        targetDeployment: 'QmTest123',
        param1: undefined, // missing allocationID
        param2: undefined,
        param3: undefined,
        param4: undefined,
        param5: undefined,
        param6: undefined,
      }),
    ).rejects.toThrow()
  })
})
