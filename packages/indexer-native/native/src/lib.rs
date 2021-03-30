use arc_swap::ArcSwap;
use keccak_hash::keccak;
use lazy_static::lazy_static;
use native_utils::{marshalling::Arg, task::run_async};
use neon::{prelude::*, result::Throw};
use secp256k1::{recovery::RecoverableSignature, Message, PublicKey, Secp256k1, VerifyOnly};
use std::sync::Arc;
mod signature_verification;

use signature_verification::SignatureVerifier;
type Address = [u8; 20];

pub struct SignatureVerifierProxy(Arc<SignatureVerifier>);

// The actual implementation of the JS proxy class. This serves to deserialize arguments
// and forward the work to the SignatureVerifier
impl SignatureVerifierProxy {
    fn _init(mut cx: CallContext<JsUndefined>) -> Result<Self, Throw> {
        let address: Address = cx.arg(0)?;
        let inner = Arc::new(SignatureVerifier::new(address));
        Ok(Self(inner))
    }

    fn _verify(mut cx: MethodContext<NativeSignatureVerifier>) -> Result<Handle<JsValue>, Throw> {
        let this = Self::_this(&mut cx);
        let callback = cx.argument::<JsFunction>(0)?;
        // TODO: Performance
        // The Arg Trait encourages doing more work than is necessary in the main thread.
        // For example, this message comes in as a JsString. The JsString -> String must
        // happen in the main thread, but the decoding of hex to Vec<u8> can be deferred.
        let message: Vec<u8> = cx.arg(1)?;
        let signature: RecoverableSignature = cx.arg(2)?;

        run_async(callback, move || this.verify(&message, &signature));

        Ok(cx.undefined().upcast())
    }

    fn _this(
        cx: &mut MethodContext<NativeSignatureVerifier>,
    ) -> Arc<signature_verification::SignatureVerifier> {
        let this = cx.this();
        let guard = cx.lock();
        let borrow = this.borrow(&guard);
        borrow.0.clone()
    }
}

// This macro is annoying in that it leaves out type declarations.
// So it's just being used as a thin wrapper to the actual code.
declare_types! {
    pub class NativeSignatureVerifier for SignatureVerifierProxy {
        init(cx) { SignatureVerifierProxy::_init(cx) }
        method verify(cx) { SignatureVerifierProxy::_verify(cx) }
    }
}

register_module!(mut cx, {
    cx.export_class::<NativeSignatureVerifier>("NativeSignatureVerifier")
});
