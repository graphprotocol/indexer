import { Address, toAddress } from '@graphprotocol/common-ts'
import { EscrowAccountResponse, EscrowAccounts } from '../escrow-accounts'

const timeout = 30000

const SENDER_ADDRESS_1 = toAddress('ffcf8fdee72ac11b5c542428b35eef5769c409f0')
const SENDER_ADDRESS_2 = toAddress('dead47df40c29949a75a6693c77834c00b8ad624')
const SENDER_ADDRESS_3 = toAddress('6aea8894b5ab5a36cdc2d8be9290046801dd5fed')

describe('EscrowAccounts', () => {
  test(
    'fromResponse should create correctly EscrowAccount',
    () => {
      const response: EscrowAccountResponse = {
        escrowAccounts: [
          {
            sender: {
              id: SENDER_ADDRESS_1,
            },
            balance: '1000',
          },
          {
            sender: {
              id: SENDER_ADDRESS_2,
            },
            balance: '2000',
          },
        ],
      }

      const escrowAccounts = EscrowAccounts.fromResponse(response)

      expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(1000n)
      expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_2)).toEqual(2000n)
      expect(() => escrowAccounts.getBalanceForSender(SENDER_ADDRESS_3)).toThrowError()
    },
    timeout,
  )
  test('test subtractSenderBalance', () => {
    const balances = new Map<Address, bigint>()
    balances.set(SENDER_ADDRESS_1, 1000n)
    balances.set(SENDER_ADDRESS_2, 1000n)
    balances.set(SENDER_ADDRESS_3, 1000n)
    const escrowAccounts = new EscrowAccounts(balances)

    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(1000n)

    escrowAccounts.subtractSenderBalance(SENDER_ADDRESS_1, 100n)
    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(900n)

    escrowAccounts.subtractSenderBalance(SENDER_ADDRESS_1, 100n)
    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(800n)

    escrowAccounts.subtractSenderBalance(SENDER_ADDRESS_1, 600n)
    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(200n)

    expect(() =>
      escrowAccounts.subtractSenderBalance(SENDER_ADDRESS_1, 400n),
    ).toThrowError()

    escrowAccounts.subtractSenderBalance(SENDER_ADDRESS_1, 200n)

    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_1)).toEqual(0n)
    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_2)).toEqual(1000n)
    expect(escrowAccounts.getBalanceForSender(SENDER_ADDRESS_3)).toEqual(1000n)
  })
})
