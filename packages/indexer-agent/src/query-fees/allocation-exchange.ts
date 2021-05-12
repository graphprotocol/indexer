import { Address } from '@graphprotocol/common-ts'
import { Contract, providers, Signer } from 'ethers'

const ABI = [
  {
    inputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    name: 'allocationsRedeemed',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'allocationID',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
          {
            internalType: 'bytes',
            name: 'signature',
            type: 'bytes',
          },
        ],
        internalType: 'struct AllocationExchange.AllocationVoucher',
        name: '_voucher',
        type: 'tuple',
      },
    ],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

export const bindAllocationExchangeContract = (
  provider: providers.Provider,
  signer: Signer,
  address: Address,
): Contract => {
  return new Contract(address, ABI, provider)
}
