use super::*;

lazy_static! {
    static ref SECP256K1: Secp256k1<VerifyOnly> = Secp256k1::verification_only();
}

enum Signer {
    PublicKey(PublicKey),
    Address(Address),
}

impl SignatureVerifier {
    pub fn new(signer: Address) -> Self {
        Self {
            signer: ArcSwap::from_pointee(Signer::Address(signer)),
        }
    }

    pub fn verify(
        &self,
        message: &[u8],
        signature: &RecoverableSignature,
    ) -> Result<bool, &'static str> {
        let message = Message::from_slice(&keccak(&message).to_fixed_bytes()).unwrap();
        let recovered_signer = SECP256K1
            .recover(&message, &signature)
            .map_err(|_| "Failed to recover signature")?;

        match self.signer.load().as_ref() {
            // If we already have the public key we can do the fast path.
            Signer::PublicKey(signer) => Ok(signer == &recovered_signer),
            // If we don't have the public key, but have the address instead
            // we derive the address from the recovered key. If it's a match
            // then we can save the public key for the next time avoiding
            // running keccak on every verification.
            Signer::Address(addr) => {
                let ser = recovered_signer.serialize_uncompressed();
                debug_assert_eq!(ser[0], 0x04);
                let pk_hash = keccak(&ser[1..]);
                let equal = &pk_hash[12..] == addr;

                if equal {
                    self.signer
                        .store(Arc::new(Signer::PublicKey(recovered_signer)))
                }

                Ok(equal)
            }
        }
    }
}

pub struct SignatureVerifier {
    signer: ArcSwap<Signer>,
}
