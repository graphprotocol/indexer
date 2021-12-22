import { Wallet, utils, Signer } from 'ethers'
import { Address, SubgraphDeploymentID, toAddress } from '@graphprotocol/common-ts'
import { Allocation } from './types'

const deriveKeyPair = (
  hdNode: utils.HDNode,
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

export const allocationSigner = (wallet: Wallet, allocation: Allocation): string => {
  const hdNode = utils.HDNode.fromMnemonic(wallet.mnemonic.phrase)

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
    const hdNode = utils.HDNode.fromMnemonic(indexerMnemonic)
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

export const allocationIdProof = (
  signer: Signer,
  indexerAddress: string,
  allocationId: string,
): Promise<string> => {
  const messageHash = utils.solidityKeccak256(
    ['address', 'address'],
    [indexerAddress, allocationId],
  )
  const messageHashBytes = utils.arrayify(messageHash)
  return signer.signMessage(messageHashBytes)
}
