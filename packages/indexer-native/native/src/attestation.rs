use super::*;
use eip_712_derive::{
    sign_typed, Bytes32, DomainSeparator, Eip712Domain, MemberVisitor, StructType, U256,
};
use native_utils::{
    errors::SafeJsResult,
    js_object,
    marshalling::{codecs::decode, IntoHandle},
};
use secp256k1::SecretKey;

pub struct AttestationSigner {
    subgraph_deployment_id: Bytes32,
    domain_separator: DomainSeparator,
    signer: SecretKey,
}

impl AttestationSigner {
    pub fn new(
        chain_id: U256,
        dispute_manager: Address,
        signer: SecretKey,
        subgraph_deployment_id: Bytes32,
    ) -> Self {
        let domain = Eip712Domain {
            name: "Graph Protocol".to_owned(),
            version: "0".to_owned(),
            chain_id,
            verifying_contract: eip_712_derive::Address(dispute_manager),
            salt: decode("a070ffb1cd7409649bf77822cce74495468e06dbfaef09556838bf188679b9c2")
                .unwrap(),
        };
        let domain_separator = DomainSeparator::new(&domain);

        Self {
            domain_separator,
            signer,
            subgraph_deployment_id,
        }
    }

    pub fn create_attestation(&self, request: &str, response: &str) -> Attestation {
        let request_cid = keccak(request).to_fixed_bytes();
        let response_cid = keccak(response).to_fixed_bytes();

        let receipt = Receipt {
            request_cid,
            response_cid,
            subgraph_deployment_id: self.subgraph_deployment_id,
        };

        // Unwrap: This can only fail if the SecretKey is invalid.
        // Since it is of type SecretKey it has already been validated.
        let (rs, v) = sign_typed(&self.domain_separator, &receipt, self.signer.as_ref()).unwrap();

        let r = rs[0..32].try_into().unwrap();
        let s = rs[32..64].try_into().unwrap();

        Attestation {
            v,
            r,
            s,
            subgraph_deployment_id: self.subgraph_deployment_id,
            request_cid,
            response_cid,
        }
    }
}

pub struct Receipt {
    request_cid: Bytes32,
    response_cid: Bytes32,
    subgraph_deployment_id: Bytes32,
}

impl StructType for Receipt {
    const TYPE_NAME: &'static str = "Receipt";
    fn visit_members<T: MemberVisitor>(&self, visitor: &mut T) {
        visitor.visit("requestCID", &self.request_cid);
        visitor.visit("responseCID", &self.response_cid);
        visitor.visit("subgraphDeploymentID", &self.subgraph_deployment_id);
    }
}

#[derive(Debug)]
pub struct Attestation {
    pub request_cid: Bytes32,
    pub response_cid: Bytes32,
    pub subgraph_deployment_id: Bytes32,
    pub v: u8,
    pub r: Bytes32,
    pub s: Bytes32,
}

impl IntoHandle for Attestation {
    type Handle = JsObject;
    fn into_handle<'c>(&self, cx: &mut impl Context<'c>) -> SafeJsResult<'c, Self::Handle> {
        js_object!(cx => {
            requestCID: &self.request_cid,
            responseCID: &self.response_cid,
            subgraphDeploymentID: &self.subgraph_deployment_id,
            v: self.v as u32,
            r: &self.r,
            s: &self.s,
        })
    }
}
