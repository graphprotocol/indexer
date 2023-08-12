var addon = require("../binary");

function promisify(f) {
  return new Promise((resolve, reject) =>
    f((err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    })
  );
}

class NativeSignatureVerifier {
  constructor(address) {
    this.address = address;
    this._native = addon.create_signature_verifier(address);
  }

  async verify(message, signature) {
    return await promisify((cb) => addon.verify_signature(this._native, cb, message, signature));
  }
}

class NativeAttestationSigner {
  constructor(
    chainId,
    disputeManagerAddress,
    privateKey,
    subgraphDeploymentId
  ) {
    this._native = new addon.create_attestation_signer(
      chainId,
      disputeManagerAddress,
      privateKey,
      subgraphDeploymentId
    );
  }
  async createAttestation(request, response) {
    return await promisify((cb) =>
      addon.create_attestation(this._native, cb, request, response)
    );
  }
}

module.exports = {
  NativeSignatureVerifier,
  NativeAttestationSigner,
};
