import { PartialVoucher, encodePartialVouchers } from './query-fees'

const TEST_DATA: Array<PartialVoucher> = [
  {
    allocation: '0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1208491688206053754',
    receipt_id_max: '0x1321676bb44e606cda1779a8d92af9',
    receipt_id_min: '0x01460d518a7b0b278dcd2bf882c11a',
    signature:
      '0x81140e47bc06819e133735bbd622213d50029d958115e4f905f18fcede2dce0f027669b2a5a6b0303d1692d7f2f01db65236f632f4c02450b102275c2cb816e11c',
  },
  {
    allocation: '0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1215330506986176264',
    receipt_id_max: '0x1ea67d3d01eb7d6b25e33332e4f5fd',
    receipt_id_min: '0x13ce97080acc5acf664404fdb9038f',
    signature:
      '0x62374ca18ad2713d149e1e90c3771d7fc4e5c643f7f063bacd497b7be2089c72404026ea675e189017c072850811422514a9781c663414f42689f697dc262ad21c',
  },
  {
    allocation: '0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1215454440881710511',
    receipt_id_max: '0x2e8f582977cbacb24b4fc0d0d52436',
    receipt_id_min: '0x217ae93ba26b959edfa33eeb08c0ba',
    signature:
      '0x657ddb7e0b09c8b0a5938df2d29d5d6d9412c5f153b4a409ca05cb6c62be1cf30016394462eaf2d1b86049f3ad71c0c2162bc97965a98a19a3bbf372106b82c01c',
  },
]

const TEST_DATA_MULTIPLE_ALLOCATIONS_PARTIAL_VOUCHERS: Array<PartialVoucher> = [
  {
    allocation: '0x7bea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1208491688206053754',
    receipt_id_max: '0x1321676bb44e606cda1779a8d92af9',
    receipt_id_min: '0x01460d518a7b0b278dcd2bf882c11a',
    signature:
      '0x81140e47bc06819e133735bbd622213d50029d958115e4f905f18fcede2dce0f027669b2a5a6b0303d1692d7f2f01db65236f632f4c02450b102275c2cb816e11c',
  },
  {
    allocation: '0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1215330506986176264',
    receipt_id_max: '0x1ea67d3d01eb7d6b25e33332e4f5fd',
    receipt_id_min: '0x13ce97080acc5acf664404fdb9038f',
    signature:
      '0x62374ca18ad2713d149e1e90c3771d7fc4e5c643f7f063bacd497b7be2089c72404026ea675e189017c072850811422514a9781c663414f42689f697dc262ad21c',
  },
  {
    allocation: '0x6aea8894b5ab5a36cdc2d8be9290046801dd5fed',
    fees: '1215454440881710511',
    receipt_id_max: '0x2e8f582977cbacb24b4fc0d0d52436',
    receipt_id_min: '0x217ae93ba26b959edfa33eeb08c0ba',
    signature:
      '0x657ddb7e0b09c8b0a5938df2d29d5d6d9412c5f153b4a409ca05cb6c62be1cf30016394462eaf2d1b86049f3ad71c0c2162bc97965a98a19a3bbf372106b82c01c',
  },
]

describe('Encode partial vouchers', () => {
  test('encode a single partial voucher', () => {
    const partialVoucherData = TEST_DATA.slice(0, 1)
    expect(encodePartialVouchers(partialVoucherData)).toEqual({
      allocation: partialVoucherData[0].allocation,
      partialVouchers: partialVoucherData,
    })
  })

  test('encode multiple partial vouchers', () => {
    expect(encodePartialVouchers(TEST_DATA)).toEqual({
      allocation: TEST_DATA[0].allocation,
      partialVouchers: TEST_DATA,
    })
  })

  test('fail to encode vouchers because they are from multiple allocations', () => {
    const partialVoucherData = TEST_DATA_MULTIPLE_ALLOCATIONS_PARTIAL_VOUCHERS
    expect(() => encodePartialVouchers(partialVoucherData)).toThrowError(
      `Partial vouchers set must be for a single allocation, '2' unique allocations represented`,
    )
  })
})
