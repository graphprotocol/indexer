import { solidityKeccak256, defaultAbiCoder, keccak256, toUtf8Bytes } from 'ethers/utils'

export const EIP712_DOMAIN_TYPE_HASH = keccak256(
  toUtf8Bytes(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)',
  ),
)

interface EIP712Domain {
  name: string
  version: string
  chainId: number
  verifyingContract: string
  salt: string
}

const encodeData = (types: string[], data: any[]): string =>
  defaultAbiCoder.encode(types, data)

export const domainSeparator = (domain: EIP712Domain): string =>
  hashStruct(
    EIP712_DOMAIN_TYPE_HASH,
    ['string', 'string', 'uint256', 'address', 'bytes32'],
    [domain.name, domain.version, domain.chainId, domain.verifyingContract, domain.salt],
  )

export const hashStruct = (typeHash: string, types: string[], data: any[]): string =>
  solidityKeccak256(['bytes32', 'bytes'], [typeHash, encodeData(types, data)])

export const encode = (domainSeparator: string, message: string): string =>
  '0x1901' + domainSeparator.substring(2) + message.substring(2)
