//! identity-lifecycle: generate an identity, add a second device node id,
//! resolve both node ids back to the same identity, and verify a device
//! attestation chain - the identity-model seed example named in
//! PHASE_4_HARUSPEX_RUST.md's "examples + testing exports" section.
//!
//! run with: `cargo run --example identity-lifecycle --features test-utils`

use ed25519_dalek::{Signer, SigningKey};
use uuid::Uuid;

use haruspex::identity::attestation::{
    attestation_message, verify_device_attestation, DeviceAttestation,
};
use haruspex::identity::{DeviceNode, Identity};
use haruspex::stores::IdentityStore;
use haruspex::testing::{identity_store, open_in_memory};

#[tokio::main]
async fn main() {
    let pool = open_in_memory().await;
    let identities = identity_store(&pool);

    let identity = identities
        .upsert_identity(Identity {
            id: Uuid::new_v4(),
            username: Some("alice".to_string()),
            created_at: 1_700_000_000,
            metadata: None,
            deleted_at: None,
        })
        .await
        .expect("create identity");
    println!(
        "created identity {} (username: {:?})",
        identity.id, identity.username
    );

    // the first device: a laptop, say. an iroh node id is an ed25519
    // public key, hex-encoded - we generate a real keypair here so the
    // attestation step below has something to verify against.
    let laptop_key = SigningKey::from_bytes(&[1u8; 32]);
    let laptop_node_id = hex::encode(laptop_key.verifying_key().to_bytes());
    identities
        .add_device(DeviceNode {
            identity_id: identity.id,
            node_id: laptop_node_id.clone(),
            instance_name: Some("alice's laptop".to_string()),
            last_seen_at: 1_700_000_000,
            deleted_at: None,
        })
        .await
        .expect("register laptop device");
    println!("registered device: {laptop_node_id} (alice's laptop)");

    // a second device: a phone, attested by the laptop (an existing member
    // device vouching that the new node id belongs to the same identity).
    let phone_key = SigningKey::from_bytes(&[2u8; 32]);
    let phone_node_id = hex::encode(phone_key.verifying_key().to_bytes());

    let message = attestation_message(identity.id, &phone_node_id);
    let signature = hex::encode(laptop_key.sign(&message).to_bytes());
    let attestation = DeviceAttestation {
        identity_id: identity.id,
        new_node_id: phone_node_id.clone(),
        signing_node_id: laptop_node_id.clone(),
        signature,
        signed_at: 1_700_000_100,
    };

    verify_device_attestation(&attestation).expect("attestation signature verifies");
    println!("verified attestation: laptop vouches for phone");

    identities
        .add_device(DeviceNode {
            identity_id: identity.id,
            node_id: phone_node_id.clone(),
            instance_name: Some("alice's phone".to_string()),
            last_seen_at: 1_700_000_100,
            deleted_at: None,
        })
        .await
        .expect("register phone device");
    println!("registered device: {phone_node_id} (alice's phone)");

    // both node ids resolve back to the same identity.
    let resolved = identities
        .identities_for(&[laptop_node_id.clone(), phone_node_id.clone()])
        .await
        .expect("batch resolve");
    assert_eq!(resolved.len(), 2);
    for (node_id, resolved_identity) in &resolved {
        assert_eq!(resolved_identity.id, identity.id);
        println!("  {node_id} -> identity {}", resolved_identity.id);
    }

    let devices = identities
        .devices_for_identity(identity.id)
        .await
        .expect("list devices");
    println!(
        "identity {} now has {} device(s)",
        identity.id,
        devices.len()
    );
    assert_eq!(devices.len(), 2);

    println!("identity lifecycle complete: one identity, two devices, one verified attestation");
}
