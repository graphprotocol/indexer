import { FeeData, parseUnits } from 'ethers'
import { capPriorityFee } from '../transactions'
import { TransactionMonitoring } from '../network-specification'

const gwei = (x: string) => parseUnits(x, 'gwei')

describe('capPriorityFee', () => {
  test('lowers the tip and maxFeePerGas by the same amount', () => {
    // ethers' fallback: 1 gwei tip on a 0.02 gwei base fee
    const fee = new FeeData(gwei('0.02'), gwei('1.04'), gwei('1'))
    const capped = capPriorityFee(fee, 0n)
    expect(capped.maxPriorityFeePerGas).toEqual(0n)
    expect(capped.maxFeePerGas).toEqual(gwei('0.04'))
    expect(capped.gasPrice).toEqual(gwei('0.02'))
  })

  test('leaves a tip under the cap alone', () => {
    const fee = new FeeData(gwei('0.02'), gwei('0.041'), gwei('0.001'))
    expect(capPriorityFee(fee, gwei('0.01'))).toBe(fee)
  })

  test('leaves legacy fee data alone', () => {
    const fee = new FeeData(gwei('5'), null, null)
    expect(capPriorityFee(fee, 0n)).toBe(fee)
  })
})

describe('TransactionMonitoring.maxPriorityFeePerGas', () => {
  test('accepts zero and converts gwei to wei', () => {
    expect(
      TransactionMonitoring.parse({ maxPriorityFeePerGas: 0 }).maxPriorityFeePerGas,
    ).toEqual(0n)
    expect(
      TransactionMonitoring.parse({ maxPriorityFeePerGas: 0.001 }).maxPriorityFeePerGas,
    ).toEqual(gwei('0.001'))
  })

  test('is unset by default', () => {
    expect(TransactionMonitoring.parse({}).maxPriorityFeePerGas).toBeUndefined()
  })
})
