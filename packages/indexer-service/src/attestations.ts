import { keccak256, toUtf8Bytes, splitSignature } from 'ethers/utils'
import { QueryResult } from './types'
import * as eip712 from './eip712'
import { Wallet } from 'ethers'

const RECEIPT_TYPE_HASH = keccak256(
  toUtf8Bytes('Receipt(bytes32 requestCID,bytes32 responseCID,bytes32 subgraphID)'),
)

interface Receipt {
  requestCID: string
  responseCID: string
  subgraphID: string
}

const SALT = '0xa070ffb1cd7409649bf77822cce74495468e06dbfaef09556838bf188679b9c2'

const encodeReceipt = (receipt: Receipt): string =>
  eip712.hashStruct(
    RECEIPT_TYPE_HASH,
    ['bytes32', 'bytes32', 'bytes32'],
    [receipt.requestCID, receipt.responseCID, receipt.subgraphID],
  )

interface SignedAttestation {
  requestCID: string
  responseCID: string
  subgraphID: string
  v: number
  r: string
  s: string
}

export const createSignedAttestation = async (
  wallet: Wallet,
  chainId: number,
  disputeManagerAddress: string,
  result: QueryResult,
): Promise<SignedAttestation> => {
  let domainSeparator = eip712.domainSeparator({
    name: 'Graph Protocol',
    version: '0',
    chainId,
    verifyingContract: disputeManagerAddress,
    salt: SALT,
  })

  let receipt = encodeReceipt({
    requestCID: result.requestCID,
    responseCID: result.responseCID,
    subgraphID: result.subgraphId,
  })

  let message = eip712.encode(domainSeparator, receipt)
  let signature = await wallet.signMessage(keccak256(message))
  let { r, s, v } = splitSignature(signature)

  return {
    requestCID: result.requestCID,
    responseCID: result.responseCID,
    subgraphID: result.subgraphId,
    v: v!,
    r,
    s,
  }
}
