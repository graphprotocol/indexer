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
    this._native = new addon.NativeSignatureVerifier(address);
  }

  async verify(message, signature) {
    return await promisify((cb) => this._native.verify(cb, message, signature));
  }
}

class NativeAttestationSigner {
  constructor(
    chainId,
    disputeManagerAddress,
    privateKey,
    subgraphDeploymentId
  ) {
    this._native = new addon.NativeAttestationSigner(
      chainId,
      disputeManagerAddress,
      privateKey,
      subgraphDeploymentId
    );
  }
  async createAttestation(request, response) {
    return await promisify((cb) =>
      this._native.createAttestation(cb, request, response)
    );
  }
}

module.exports = {
  NativeSignatureVerifier,
  NativeAttestationSigner,
};
