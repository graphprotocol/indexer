use alloy_primitives::{Address, Bytes, FixedBytes, B256, U256};
use neon::prelude::*;
use secp256k1::{
    ecdsa::{RecoverableSignature, RecoveryId},
    SecretKey,
};

mod attestation;
mod signature_verification;

use attestation::{Attestation, AttestationSigner};
use signature_verification::SignatureVerifier;

pub struct SignatureVerifierProxy;

fn signature_verifier_new(mut cx: FunctionContext) -> JsResult<JsBox<SignatureVerifier>> {
    let address: Address = cx.argument::<JsString>(0)?.value(&mut cx).parse().unwrap();
    Ok(cx.boxed(SignatureVerifier::new(address)))
}

fn signature_verifier_verify(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let this = cx.argument::<JsBox<SignatureVerifier>>(0)?;
    let message: Bytes = cx.argument::<JsString>(1)?.value(&mut cx).parse().unwrap();
    let signature: FixedBytes<65> = cx.argument::<JsString>(2)?.value(&mut cx).parse().unwrap();
    let recovery_id = signature[64] as i32;
    let recovery_id = match recovery_id {
        0 | 1 => RecoveryId::from_i32(recovery_id).unwrap(),
        27 | 28 => RecoveryId::from_i32(recovery_id - 27).unwrap(),
        _ => panic!("Invalid recovery id"),
    };
    let signature = RecoverableSignature::from_compact(&signature[..64], recovery_id).unwrap();
    Ok(cx.boolean(this.verify(&message, &signature).unwrap()))
}

fn attestation_signer_new(mut cx: FunctionContext) -> JsResult<JsBox<AttestationSigner>> {
    let chain_id = cx.argument::<JsNumber>(0)?.value(&mut cx) as u64;
    let dispute_manager: Address = cx.argument::<JsString>(1)?.value(&mut cx).parse().unwrap();
    let signer: B256 = cx.argument::<JsString>(2)?.value(&mut cx).parse().unwrap();
    let subgraph_deployment_id: B256 = cx.argument::<JsString>(3)?.value(&mut cx).parse().unwrap();
    Ok(cx.boxed(AttestationSigner::new(
        U256::from(chain_id),
        dispute_manager,
        SecretKey::from_slice(signer.as_slice()).unwrap(),
        subgraph_deployment_id,
    )))
}

fn attestation_signer_create_attestation(mut cx: FunctionContext) -> JsResult<JsObject> {
    let this = cx.argument::<JsBox<AttestationSigner>>(0)?;
    let request: String = cx.argument::<JsString>(1)?.value(&mut cx);
    let response: String = cx.argument::<JsString>(2)?.value(&mut cx);
    let Attestation {
        request_cid,
        response_cid,
        subgraph_deployment_id,
        v,
        r,
        s,
    } = this.create_attestation(&request, &response);

    let result = cx.empty_object();
    let request_cid = cx.string(request_cid.to_string());
    result.set(&mut cx, "requestCID", request_cid)?;
    let response_cid = cx.string(response_cid.to_string());
    result.set(&mut cx, "responseCID", response_cid)?;
    let subgraph_deployment_id = cx.string(subgraph_deployment_id.to_string());
    result.set(&mut cx, "subgraphDeploymentID", subgraph_deployment_id)?;
    let v = cx.number(v);
    result.set(&mut cx, "v", v)?;
    let r = cx.string(r.to_string());
    result.set(&mut cx, "r", r)?;
    let s = cx.string(s.to_string());
    result.set(&mut cx, "s", s)?;
    Ok(result)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("signature_verifier_new", signature_verifier_new)?;
    cx.export_function("signature_verifier_verify", signature_verifier_verify)?;
    cx.export_function("attestation_signer_new", attestation_signer_new)?;
    cx.export_function(
        "attestation_signer_create_attestation",
        attestation_signer_create_attestation,
    )?;
    Ok(())
}
