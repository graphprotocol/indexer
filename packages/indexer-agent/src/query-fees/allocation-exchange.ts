import { Address } from '@graphprotocol/common-ts'
import { Contract, providers, Signer } from 'ethers'

const ABI = [
  'function allocationsRedeemed(address allocationID) returns bool',
  'function redeem(address allocationID, uint256 amount, bytes signature)',
]

export const bindAllocationExchangeContract = (
  provider: providers.Provider,
  signer: Signer,
  address: Address,
): Contract => {
  return new Contract(address, ABI, provider)
}
