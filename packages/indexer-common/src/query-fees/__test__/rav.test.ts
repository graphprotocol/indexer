// test the conversion of a database rav to a RavData

import { connectDatabase, toAddress } from '@graphprotocol/common-ts'
import { defineQueryFeeModels } from '../models'
import { JSONParse, camelize } from '../object-conversion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hexToBytes = (hex: string): Uint8Array => {
  const bytes: number[] = []

  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16))
  }

  return Uint8Array.from(bytes)
}
declare const __DATABASE__: any
const databaseData =
  '{"message":{"allocation_id":"0xabababababababababababababababababababab","timestamp_ns":18446744073709551605,"value_aggregate":340282366920938463463374607431768211455},"signature":{"r":"0x56f8e2b7fecee908ff0d28ed172a61bee8ffe87b498c23da7eaca74cd7c5b5ce","s":"0x4ead667e3eb4f1d8c4a20e6f0e5dbe73f9f63e9d0d23e606b3239332c5f21337","v":27}}'

describe('RavData', () => {
  test('convert to database value to RavData', () => {
    const ravData = JSONParse(databaseData)

    const camelCase = camelize(ravData)
    expect(camelCase).toEqual({
      message: {
        allocationId: '0xabababababababababababababababababababab',
        timestampNs: 18446744073709551605n,
        valueAggregate: 340282366920938463463374607431768211455n,
      },
      signature: {
        r: '0x56f8e2b7fecee908ff0d28ed172a61bee8ffe87b498c23da7eaca74cd7c5b5ce',
        s: '0x4ead667e3eb4f1d8c4a20e6f0e5dbe73f9f63e9d0d23e606b3239332c5f21337',
        v: 27,
      },
    })
  })

  test('load ravData into database', async () => {
    let sequelize = await connectDatabase(__DATABASE__)
    const queryFeeModels = defineQueryFeeModels(sequelize)
    sequelize = await sequelize.sync({ force: true })
    const value = {
      allocation_id: toAddress('0xabababababababababababababababababababab'),
      final: true,
      sender_address: toAddress('0xabababababababababababababababababababab'),
      timestamp_ns: 18446744073709551605n,
      value_aggregate: 340282366920938463463374607431768211455n,
      signature: Buffer.from(
        '0x56f8e2b7fecee908ff0d28ed172a61bee8ffe87b498c23da7eaca74cd7c5b5ce4ead667e3eb4f1d8c4a20e6f0e5dbe73f9f63e9d0d23e606b3239332c5f213371b',
        'hex',
      ),
    }
    await queryFeeModels.receiptAggregateVouchers.create(value)

    const result = await queryFeeModels.receiptAggregateVouchers.findAll()
    // expect([value]).toEqual(result)
    expect(result).toEqual([expect.objectContaining(value)])
  })
})
