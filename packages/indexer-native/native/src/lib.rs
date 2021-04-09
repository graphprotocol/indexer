use arc_swap::ArcSwap;
use keccak_hash::keccak;
use lazy_static::lazy_static;
use native_utils::{
    errors::{SafeResult, Terminal},
    marshalling::Arg,
    proxy::{Proxy, ProxyTerminal},
    task::run_async,
};
use neon::prelude::*;
use never::Never;
use secp256k1::{recovery::RecoverableSignature, Message, PublicKey, Secp256k1, VerifyOnly};
use std::sync::Arc;
mod attestation;
mod signature_verification;

use attestation::AttestationSigner;
use primitive_types::U256;
use signature_verification::SignatureVerifier;
use std::convert::TryInto as _;

type Address = [u8; 20];

pub type SignatureVerifierProxy = Proxy<SignatureVerifier>;
impl SignatureVerifierImpl for SignatureVerifierProxy {}
// The actual implementation of the JS proxy class. This serves to deserialize arguments
// and forward the work to the SignatureVerifier
trait SignatureVerifierImpl: Sized + From<SignatureVerifier> {
    fn _init<'c>(cx: &mut CallContext<'c, JsUndefined>) -> SafeResult<Self> {
        let address: Address = cx.arg(0)?;
        let inner = SignatureVerifier::new(address);
        Ok(inner.into())
    }

    fn _verify<'c, 'b>(cx: &'b mut MethodContext<'c, NativeSignatureVerifier>) -> SafeResult<()> {
        let this = Proxy::this(cx);
        let callback = cx.argument::<JsFunction>(0)?;
        // TODO: Performance
        // The Arg Trait encourages doing more work than is necessary in the main thread.
        // For example, this message comes in as a JsString. The JsString -> String must
        // happen in the main thread, but the decoding of hex to Vec<u8> can be deferred.
        let message: Vec<u8> = cx.arg(1)?;
        let signature: RecoverableSignature = cx.arg(2)?;

        run_async(callback, move || this.verify(&message, &signature));

        Ok(())
    }
}

pub type AttestationSignerProxy = Proxy<AttestationSigner>;
impl AttestationSignerImpl for AttestationSignerProxy {}
pub trait AttestationSignerImpl: Sized + From<AttestationSigner> {
    fn _init<'c>(cx: &mut CallContext<'c, JsUndefined>) -> SafeResult<Self> {
        let chain_id: U256 = cx.arg(0)?;
        let mut chain_id_bytes = [0u8; 32];
        chain_id.to_big_endian(&mut chain_id_bytes);
        let chain_id = eip_712_derive::U256(chain_id_bytes);
        let dispute_manager = cx.arg(1)?;
        let signer = cx.arg(2)?;
        let subgraph_deployment_id = cx.arg(3)?;
        let inner =
            AttestationSigner::new(chain_id, dispute_manager, signer, subgraph_deployment_id);
        Ok(inner.into())
    }

    fn _create_attestation<'c>(
        cx: &mut MethodContext<'c, NativeAttestationSigner>,
    ) -> SafeResult<()> {
        let this = Proxy::this(cx);
        let callback = cx.argument(0)?;
        let request: String = cx.arg(1)?;
        let response: String = cx.arg(2)?;

        run_async::<_, _, Never>(callback, move || {
            Ok(this.create_attestation(&request, &response))
        });

        Ok(())
    }
}

// This macro is annoying in that it leaves out type declarations.
// So it's just being used as a thin wrapper to the actual code.
declare_types! {
    pub class NativeSignatureVerifier for SignatureVerifierProxy {
        init(mut cx) { SignatureVerifierProxy::_init(&mut cx).finish(cx) }
        method verify(mut cx) { SignatureVerifierProxy::_verify(&mut cx).finish(cx).map(|v| v.upcast()) }
    }

    pub class NativeAttestationSigner for AttestationSignerProxy {
        init(mut cx) { AttestationSignerProxy::_init(&mut cx).finish(cx) }
        method createAttestation(mut cx) { AttestationSignerProxy::_create_attestation(&mut cx).finish(cx).map(|v| v.upcast()) }
    }
}

register_module!(mut cx, {
    cx.export_class::<NativeSignatureVerifier>("NativeSignatureVerifier")?;
    cx.export_class::<NativeAttestationSigner>("NativeAttestationSigner")
});
