import {
  Wallet,
  Signer,
  HDNodeWallet,
  solidityPackedKeccak256,
  getBytes,
  Mnemonic,
} from 'ethers'
import { Address, SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'
import { Allocation } from './types'

const deriveKeyPair = (
  hdNode: HDNodeWallet,
  epoch: number,
  deployment: SubgraphDeploymentID,
  index: number,
): { publicKey: string; privateKey: string; address: Address } => {
  const path = 'm/' + [epoch, ...Buffer.from(deployment.ipfsHash), index].join('/')
  const derivedKey = hdNode.derivePath(path)
  return {
    publicKey: derivedKey.publicKey,
    privateKey: derivedKey.privateKey,
    address: toAddress(derivedKey.address),
  }
}

// Returns the private key of allocation signer
export const allocationSignerPrivateKey = (
  wallet: HDNodeWallet,
  allocation: Allocation,
): string => {
  const hdNode = HDNodeWallet.fromMnemonic(wallet.mnemonic!, 'm')

  // The allocation was either created at the epoch it intended to or one
  // epoch later. So try both both.
  for (const epoch of [allocation.createdAtEpoch, allocation.createdAtEpoch - 1]) {
    // Guess the allocation index by enumerating all indexes in the
    // range [0, 100] and checking for a match
    for (let i = 0; i <= 100; i++) {
      const keyPair = deriveKeyPair(hdNode, epoch, allocation.subgraphDeployment.id, i)
      if (keyPair.address === allocation.id) {
        return keyPair.privateKey
      }
    }
  }

  throw new Error(
    `No match found within allowed epochs and parallel allocation limit of 100`,
  )
}

// Returns allocation signer wallet
export const allocationSigner = (
  wallet: HDNodeWallet,
  allocation: Allocation,
): Signer => {
  return new Wallet(allocationSignerPrivateKey(wallet, allocation))
}

/**
 * Derive an allocation ID that is specific to the current epoch,
 * the deployment ID, the indexer's private key AND that doesn't
 * collide with any existing allocations; this is achieved by
 * deriving a key pair from the indexer's private key using the
 * path [currentEpoch, ...<deployment ID as bytes>, <number 0...100>].
 *
 * The unique index (number between 0 and 100) is identified by
 * enumerating all numbers and using the first where the derivation
 * does not collidate with any of the current allocations; this is
 * the smallest unique index not currently being used
 */
export const uniqueAllocationID = (
  indexerMnemonic: string,
  epoch: number,
  deployment: SubgraphDeploymentID,
  existingIDs: Address[],
): { allocationSigner: Signer; allocationId: Address } => {
  for (let i = 0; i < 100; i++) {
    const mnemonicObj = Mnemonic.fromPhrase(indexerMnemonic)
    const hdNode = HDNodeWallet.fromMnemonic(mnemonicObj, 'm')
    const keyPair = deriveKeyPair(hdNode, epoch, deployment, i)
    if (!existingIDs.includes(keyPair.address)) {
      return {
        allocationSigner: new Wallet(keyPair.privateKey),
        allocationId: keyPair.address,
      }
    }
  }

  throw new Error(`Exhausted limit of 100 parallel allocations`)
}

export const EIP712_ALLOCATION_ID_PROOF_TYPES = {
  AllocationIdProof: [
    { name: 'indexer', type: 'address' },
    { name: 'allocationId', type: 'address' },
  ],
}

// For new allocations in the subgraph service
export const horizonAllocationIdProof = (
  signer: Signer,
  chainId: number,
  indexerAddress: Address,
  allocationId: Address,
  subgraphServiceAddress: string,
): Promise<string> => {
  const domain = {
    name: 'SubgraphService',
    version: '1.0',
    chainId: chainId,
    verifyingContract: subgraphServiceAddress,
  }

  return signer.signTypedData(domain, EIP712_ALLOCATION_ID_PROOF_TYPES, {
    indexer: indexerAddress,
    allocationId: allocationId,
  })
}

export const tapAllocationIdProof = (
  signer: Signer,
  chainId: number,
  sender: Address,
  allocationId: Address,
  escrowContract: Address,
): Promise<string> => {
  const messageHash = solidityPackedKeccak256(
    ['uint256', 'address', 'address', 'address'],
    [chainId, sender, allocationId, escrowContract],
  )
  const messageHashBytes = getBytes(messageHash)
  return signer.signMessage(messageHashBytes)
}
