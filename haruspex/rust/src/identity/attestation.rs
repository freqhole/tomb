//! device attestation: the signature chain that lets an already-member
//! device vouch for a new one - "node id B belongs to identity X, signed by
//! member node A" (see tomb's xl-refactor open questions, Q4). shapes and
//! verification only in this module; the full cross-peer passkey add-device
//! ceremony is deferred to a later phase.
//!
//! an iroh node id IS an ed25519 public key, hex-encoded - so verifying a
//! signature chain link needs nothing beyond the node id strings themselves:
//! no keypair file access, no dependency on reliquary. haruspex only ever
//! verifies signatures here; producing them is the signing device's own job.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// one link in a device attestation chain: `signing_node_id` (an existing
/// member device of `identity_id`) vouches that `new_node_id` also belongs
/// to `identity_id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceAttestation {
    pub identity_id: Uuid,
    pub new_node_id: String,
    pub signing_node_id: String,
    /// hex-encoded ed25519 signature over `attestation_message`, produced by
    /// the signing device's private key.
    pub signature: String,
    pub signed_at: i64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AttestationError {
    #[error("signing node id is not a valid ed25519 public key: {0}")]
    InvalidSigningNodeId(String),
    #[error("signature is not valid hex or the wrong length: {0}")]
    InvalidSignature(String),
    #[error("signature does not verify against the signing node id")]
    VerificationFailed,
}

/// the canonical bytes an attestation's signature is computed over.
/// versioned so the message shape can change later without ambiguity.
pub fn attestation_message(identity_id: Uuid, new_node_id: &str) -> Vec<u8> {
    format!("haruspex-device-attestation:v1:{identity_id}:{new_node_id}").into_bytes()
}

/// verify a device attestation's signature against its claimed signing node
/// id. this only proves the signature is valid for that node id - it does
/// not check that `signing_node_id` is actually a current member of
/// `identity_id`; that is a store-level lookup the caller performs
/// separately (`IdentityStore::devices_for_identity`).
pub fn verify_device_attestation(attestation: &DeviceAttestation) -> Result<(), AttestationError> {
    let key_bytes = hex::decode(&attestation.signing_node_id)
        .map_err(|e| AttestationError::InvalidSigningNodeId(e.to_string()))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| AttestationError::InvalidSigningNodeId("expected 32 bytes".to_string()))?;
    let verifying_key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|e| AttestationError::InvalidSigningNodeId(e.to_string()))?;

    let sig_bytes = hex::decode(&attestation.signature)
        .map_err(|e| AttestationError::InvalidSignature(e.to_string()))?;
    let sig_bytes: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| AttestationError::InvalidSignature("expected 64 bytes".to_string()))?;
    let signature = Signature::from_bytes(&sig_bytes);

    let message = attestation_message(attestation.identity_id, &attestation.new_node_id);
    verifying_key
        .verify(&message, &signature)
        .map_err(|_| AttestationError::VerificationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed_attestation(identity_id: Uuid, new_node_id: &str) -> (DeviceAttestation, [u8; 32]) {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let signing_node_id = hex::encode(signing_key.verifying_key().to_bytes());
        let message = attestation_message(identity_id, new_node_id);
        let signature = signing_key.sign(&message);
        (
            DeviceAttestation {
                identity_id,
                new_node_id: new_node_id.to_string(),
                signing_node_id,
                signature: hex::encode(signature.to_bytes()),
                signed_at: 1_700_000_000,
            },
            signing_key.verifying_key().to_bytes(),
        )
    }

    #[test]
    fn verifies_a_valid_attestation() {
        let identity_id = Uuid::new_v4();
        let (attestation, _) = signed_attestation(identity_id, "aa".repeat(32).as_str());
        verify_device_attestation(&attestation).expect("valid signature should verify");
    }

    #[test]
    fn rejects_a_tampered_message() {
        let identity_id = Uuid::new_v4();
        let (mut attestation, _) = signed_attestation(identity_id, "aa".repeat(32).as_str());
        attestation.new_node_id = "bb".repeat(32);
        assert_eq!(
            verify_device_attestation(&attestation),
            Err(AttestationError::VerificationFailed)
        );
    }

    #[test]
    fn rejects_a_signature_from_a_different_key() {
        let identity_id = Uuid::new_v4();
        let (mut attestation, _) = signed_attestation(identity_id, "aa".repeat(32).as_str());
        let other_key = SigningKey::from_bytes(&[9u8; 32]);
        attestation.signing_node_id = hex::encode(other_key.verifying_key().to_bytes());
        assert_eq!(
            verify_device_attestation(&attestation),
            Err(AttestationError::VerificationFailed)
        );
    }

    #[test]
    fn rejects_a_malformed_signing_node_id() {
        let identity_id = Uuid::new_v4();
        let (mut attestation, _) = signed_attestation(identity_id, "aa".repeat(32).as_str());
        attestation.signing_node_id = "not-hex".to_string();
        assert!(matches!(
            verify_device_attestation(&attestation),
            Err(AttestationError::InvalidSigningNodeId(_))
        ));
    }

    #[test]
    fn rejects_a_malformed_signature() {
        let identity_id = Uuid::new_v4();
        let (mut attestation, _) = signed_attestation(identity_id, "aa".repeat(32).as_str());
        attestation.signature = "not-hex".to_string();
        assert!(matches!(
            verify_device_attestation(&attestation),
            Err(AttestationError::InvalidSignature(_))
        ));
    }
}
