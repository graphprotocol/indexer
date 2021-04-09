/*
    Verifies messages are signed by the same address.
    This API may seem strange compared to the relatively straightforward alternative:
       verify(address, message, signature): Promise<boolean>.
    
    But, making the API this way allows for some optimizations:
       * The address is not repeatedly marshalled across the Rust/JS boundary
       * The PublicKey to Address conversion is cached, saving a keccak hash
*/
export class NativeSignatureVerifier {
  constructor(address: string);
  /*
        Verifies that the message was signed by the address this verifier
        was constructed with.
    */
  async verify(message: string, signature: string): Promise<boolean>;
}

export type Attestation = {
  requestCID: string;
  responseCID: string;
  subgraphDeploymentID: string;
  v: number;
  r: string;
  s: string;
};

/*
    Signs attestations using the given signing data
*/
export class NativeAttestationSigner {
  constructor(
    chainId: string | number,
    disputeManagerAddress: string,
    privateKey: string,
    /// Bytes32
    subgraphDeploymentId: string
  );
  /*
        Signs an attestation using the data given in the constructor
    */
  async createAttestation(
    request: string,
    response: string
  ): Promise<Attestation>;
}
