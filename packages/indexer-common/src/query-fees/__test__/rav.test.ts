// test the conversion of a database rav to a RavData

import { connectDatabase, toAddress } from '@graphprotocol/common-ts'
import { defineQueryFeeModels } from '../models'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __DATABASE__: any
describe('RavData', () => {
  test('load ravData into database', async () => {
    let sequelize = await connectDatabase(__DATABASE__)
    const queryFeeModels = defineQueryFeeModels(sequelize)
    sequelize = await sequelize.sync({ force: true })
    const value = {
      allocationId: toAddress('0xabababababababababababababababababababab'),
      final: false,
      last: true,
      senderAddress: toAddress('0xabababababababababababababababababababab'),
      timestampNs: 1709067401177959664n,
      valueAggregate: 20000000000000n,
      signature: Buffer.from(
        '0x56f8e2b7fecee908ff0d28ed172a61bee8ffe87b498c23da7eaca74cd7c5b5ce4ead667e3eb4f1d8c4a20e6f0e5dbe73f9f63e9d0d23e606b3239332c5f213371b',
        'hex',
      ),
      redeemedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await queryFeeModels.receiptAggregateVouchers.create(value)

    const result = await queryFeeModels.receiptAggregateVouchers.findAll()
    // expect([value]).toEqual(result)
    expect(result).toEqual([expect.objectContaining({
      allocationId: value.allocationId,
      final: value.final,
      last: value.last,
      senderAddress: value.senderAddress,
      signature: value.signature,
      timestampNs: BigInt(value.timestampNs).toString(),
      valueAggregate: BigInt(value.valueAggregate).toString(),
    })])
  })
})
