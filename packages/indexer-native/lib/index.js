var addon = require("../binary/index.node");

class NativeSignatureVerifier {
  constructor(address) {
    this.address = address;
    this._native = addon.signature_verifier_new(address);
  }

  verify(message, signature) {
    return addon.signature_verifier_verify(this._native, message, signature);
  }
}

class NativeAttestationSigner {
  constructor(
    chainId,
    disputeManagerAddress,
    privateKey,
    subgraphDeploymentId,
  ) {
    this._native = addon.attestation_signer_new(
      chainId,
      disputeManagerAddress,
      privateKey,
      subgraphDeploymentId,
    );
  }

  createAttestation(request, response) {
    return addon.attestation_signer_create_attestation(
      this._native,
      request,
      response,
    );
  }
}

module.exports = {
  NativeSignatureVerifier,
  NativeAttestationSigner,
};
