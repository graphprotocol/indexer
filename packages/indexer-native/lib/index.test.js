const { NativeSignatureVerifier, NativeAttestationSigner } = require(".");
const { utils, Wallet } = require("ethers");
const bs58 = require("bs58");

describe("Native Functions", () => {
  test("Signatures", () => {
    let address = "0xc61127cdfb5380df4214b0200b9a07c7c49d34f9";
    let native = new NativeSignatureVerifier(address);

    // Taken from the indexer-service code matching
    // the Scalar format.
    let verifyReceipt = (receipt) => {
      const message = receipt.slice(64, 136);
      const signature = receipt.slice(136, 266);
      return native.verify(message, signature);
    };

    // Testing multiple true/false values in this order on the same NativeSignatureVerifier
    // instance is important because it verifies different paths for the cached/uncached internals.
    // These resolve in this order:
    //    False on uncached
    //    True on uncached
    //    True on cached
    //    False on cached
    // Values generated by Scalar test code
    let receipt0________ =
      "6400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000001c7cb128b1f0c35ebcfda82da63fb149773d26a5665ae70db6c0c0f61e362d5320f18c77a0907fd6b1565e8734bd4f893d2a0c5dfd34878ee4bd634c99297db091c";
    let receipt0Tampered =
      "6400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000001c7cb128b1f0c35ebcfda82da63fb149773d26a5665ae70db6c0c0f61e362d5320f18c77a0907fd6b1565e8734bd4f893d2a0c5dfd34878ee4bd634c99297db091c";
    let receipt1________ =
      "640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000259d1189ce128a2a3b4786035aed37cca0968c638c67e73ed1496a50fbda043d5553a7702bb8b0f71409dd0199533161e322b17826a91236cfb22504a093d0a451c";
    let receipt1Tampered =
      "640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000090000000259d1189ce128a2a3b4786035aed37cca0968c638c67e73ed1496a50fbda043d5553a7702bb8b0f71409dd0199533161e322b17826a91236cfb22504a093d0a451c";
    // The awaits give time for each previous task to resolve, ensuring that the
    // fast path is taken for subsequent runs.
    expect(verifyReceipt(receipt0Tampered)).toEqual(false);
    expect(verifyReceipt(receipt0________)).toEqual(true);
    expect(verifyReceipt(receipt1________)).toEqual(true);
    expect(verifyReceipt(receipt1Tampered)).toEqual(false);
    // When running the tests locally with some debug information, to ensure
    // that the fast path was transitioned to it only printed 3/4 messages.
    // Adding this redundant test printed 4/5 messages. Assuming the problem
    // is just flushing output.
    expect(verifyReceipt(receipt1Tampered)).toEqual(false);
  });

  test("Create attestation", async () => {
    // Taken from the attestation test in common-ts
    const mnemonic =
      "coyote tattoo slush ball cluster culture bleak news when action cover effort";

    const subgraphDeploymentID = utils.hexlify(
      bs58.decode("QmTXzATwNfgGVukV1fX2T6xw9f6LAYRVWpsdXyRWzUR2H9").slice(2),
    );
    const privateKey = Wallet.fromMnemonic(mnemonic).privateKey;

    const chainId = 1;
    const disputeManagerAddress = "0x0000000000000000000000000000000000000000";

    const signer = new NativeAttestationSigner(
      chainId,
      disputeManagerAddress,
      privateKey,
      subgraphDeploymentID,
    );

    const expected = {
      requestCID:
        "0x72859a6ae50aa97f593f23df1c78bb1fd78cfc493fcef64159d6486223196833",
      responseCID:
        "0x448b8ad3a330cf8f269f487881b59efff721b3dfa8e61f7c8fd2480389459ed3",
      subgraphDeploymentID:
        "0x4d31d21d389263c98d1e83a031e8fed17cdcef15bd62ee8153f34188a83c7b1c",
      v: 27,
      r: "0x702af3e8dec0aab1b29e5663b7ba6843689a55c2c178a26dcce3bc1eeb3a1de9",
      s: "0x7b24b529fcf92c9426179146bb7bfed6540043e2c30132e59d994a3cc718f2be",
    };
    await expect(signer.createAttestation("request", "response")).toEqual(
      expected,
    );
  });

  test("Fail to initialize signer", async () => {
    // Taken from the attestation test in common-ts
    const mnemonic =
      "coyote tattoo slush ball cluster culture bleak news when action cover effort";

    const subgraphDeploymentID = utils.hexlify(
      bs58.decode("QmTXzATwNfgGVukV1fX2T6xw9f6LAYRVWpsdXyRWzUR2H9").slice(2),
    );
    const privateKey = Wallet.fromMnemonic(mnemonic).privateKey;

    const chainId = 1;

    // Ensure throwing errors works at least in one case when a parameter cannot be deserialized
    expect(
      () =>
        new NativeAttestationSigner(
          chainId,
          "0xbad",
          privateKey,
          subgraphDeploymentID,
        ),
    ).toThrow();
  });
});
