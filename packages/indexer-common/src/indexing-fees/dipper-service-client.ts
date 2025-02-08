import { Client, credentials } from '@grpc/grpc-js'
import { UnaryCallback } from '@grpc/grpc-js/build/src/client'
import { DipperServiceClientImpl } from '@graphprotocol/dips-proto/generated/gateway'
import { Wallet } from 'ethers'
import {
  _TypedDataEncoder,
  arrayify,
  defaultAbiCoder,
  recoverAddress,
} from 'ethers/lib/utils'
import { toAddress } from '@graphprotocol/common-ts'

type RpcImpl = (service: string, method: string, data: Uint8Array) => Promise<Uint8Array>

interface Rpc {
  request: RpcImpl
}

export const domainSalt =
  '0xb4632c657c26dce5d4d7da1d65bda185b14ff8f905ddbb03ea0382ed06c5ef28'
export const chainId = 0xa4b1 // 42161
export const cancelAgreementDomain = {
  name: 'Graph Protocol Indexing Agreement Cancellation',
  version: '0',
  chainId: chainId,
  salt: domainSalt,
}
export const cancelAgreementTypes = {
  CancellationRequest: [{ name: 'agreement_id', type: 'bytes16' }],
}

export const collectPaymentsDomain = {
  name: 'Graph Protocol Indexing Agreement Collection',
  version: '0',
  chainId: chainId,
  salt: domainSalt,
}
export const collectPaymentsTypes = {
  CollectionRequest: [
    { name: 'agreement_id', type: 'bytes16' },
    { name: 'allocation_id', type: 'address' },
    { name: 'entity_count', type: 'uint64' },
  ],
}

export const createSignedCancellationRequest = async (
  agreementId: string,
  wallet: Wallet,
): Promise<Uint8Array> => {
  const signature = await wallet._signTypedData(
    cancelAgreementDomain,
    cancelAgreementTypes,
    { agreement_id: agreementId },
  )
  return arrayify(
    defaultAbiCoder.encode(['tuple(bytes16)', 'bytes'], [[agreementId], signature]),
  )
}

export const createSignedCollectionRequest = async (
  agreementId: string,
  allocationId: string,
  entityCount: number,
  wallet: Wallet,
): Promise<Uint8Array> => {
  const signature = await wallet._signTypedData(
    collectPaymentsDomain,
    collectPaymentsTypes,
    { agreement_id: agreementId, allocation_id: allocationId, entity_count: entityCount },
  )
  return arrayify(
    defaultAbiCoder.encode(
      ['tuple(bytes16, address, uint64)', 'bytes'],
      [[agreementId, allocationId, entityCount], signature],
    ),
  )
}

export const decodeTapReceipt = (receipt: Uint8Array, verifyingContract: string) => {
  const [message, signature] = defaultAbiCoder.decode(
    ['tuple(address,uint64,uint64,uint128)', 'bytes'],
    receipt,
  )

  const [allocationId, timestampNs, nonce, value] = message

  // Recover the signer address from the signature
  // compute the EIP-712 digest of the message
  const domain = {
    name: 'TAP',
    version: '1',
    chainId: chainId,
    verifyingContract,
  }

  const types = {
    Receipt: [
      { name: 'allocation_id', type: 'address' },
      { name: 'timestamp_ns', type: 'uint64' },
      { name: 'nonce', type: 'uint64' },
      { name: 'value', type: 'uint128' },
    ],
  }

  const digest = _TypedDataEncoder.hash(domain, types, {
    allocation_id: allocationId,
    timestamp_ns: timestampNs,
    nonce: nonce,
    value: value,
  })
  const signerAddress = recoverAddress(digest, signature)
  return {
    allocation_id: allocationId,
    signer_address: toAddress(signerAddress),
    signature: signature,
    timestamp_ns: timestampNs,
    nonce: nonce,
    value: value,
  }
}

export const createRpc = (url: string): Rpc => {
  const client = new Client(url, credentials.createInsecure())
  const request: RpcImpl = (service, method, data) => {
    // Conventionally in gRPC, the request path looks like
    //   "package.names.ServiceName/MethodName",
    // we therefore construct such a string
    const path = `/${service}/${method}`

    return new Promise((resolve, reject) => {
      // makeUnaryRequest transmits the result (and error) with a callback
      // transform this into a promise!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultCallback: UnaryCallback<any> = (err, res) => {
        if (err) {
          return reject(err)
        }
        resolve(res)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function passThrough(argument: any) {
        return argument
      }

      // Using passThrough as the deserialize functions
      client.makeUnaryRequest(
        path,
        (d) => Buffer.from(d),
        passThrough,
        data,
        resultCallback,
      )
    })
  }

  return { request }
}

export const createDipperServiceClient = (url: string) => {
  const rpc = createRpc(url)
  return new DipperServiceClientImpl(rpc)
}
