use std::convert::TryInto;

use alloy_primitives::{Address, B256, U256};
use eip_712_derive::{sign_typed, DomainSeparator, Eip712Domain, MemberVisitor, StructType};
use keccak_hash::keccak;
use neon::prelude::Finalize;
use secp256k1::SecretKey;

pub struct AttestationSigner {
    subgraph_deployment_id: B256,
    domain_separator: DomainSeparator,
    signer: SecretKey,
}

impl Finalize for AttestationSigner {}

impl AttestationSigner {
    pub fn new(
        chain_id: U256,
        dispute_manager: Address,
        signer: SecretKey,
        subgraph_deployment_id: B256,
    ) -> Self {
        let salt = "0xa070ffb1cd7409649bf77822cce74495468e06dbfaef09556838bf188679b9c2"
            .parse::<B256>()
            .unwrap();
        let domain = Eip712Domain {
            name: "Graph Protocol".to_owned(),
            version: "0".to_owned(),
            chain_id: eip_712_derive::U256(chain_id.to_be_bytes()),
            verifying_contract: eip_712_derive::Address(*dispute_manager.0),
            salt: salt.0,
        };
        Self {
            domain_separator: DomainSeparator::new(&domain),
            signer,
            subgraph_deployment_id,
        }
    }

    pub fn create_attestation(&self, request: &str, response: &str) -> Attestation {
        let request_cid = keccak(request).to_fixed_bytes().into();
        let response_cid = keccak(response).to_fixed_bytes().into();

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
            request_cid,
            response_cid,
            subgraph_deployment_id: self.subgraph_deployment_id,
            v,
            r,
            s,
        }
    }
}

pub struct Receipt {
    request_cid: B256,
    response_cid: B256,
    subgraph_deployment_id: B256,
}

impl StructType for Receipt {
    const TYPE_NAME: &'static str = "Receipt";
    fn visit_members<T: MemberVisitor>(&self, visitor: &mut T) {
        visitor.visit("requestCID", &self.request_cid.0);
        visitor.visit("responseCID", &self.response_cid.0);
        visitor.visit("subgraphDeploymentID", &self.subgraph_deployment_id.0);
    }
}

#[derive(Debug)]
pub struct Attestation {
    pub request_cid: B256,
    pub response_cid: B256,
    pub subgraph_deployment_id: B256,
    pub v: u8,
    pub r: B256,
    pub s: B256,
}
