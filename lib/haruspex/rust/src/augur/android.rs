//! android backend: a real jni + ndk-context bridge to `NsdManager`, via a
//! small companion kotlin class - see `android/NsdBridge.kt` next to this
//! file (also documents how a consuming android gradle project picks it
//! up). `NsdManager`'s registration/discovery apis are callback-interface
//! based, which needs a real jvm class backing the callbacks - not
//! reachable from pure jni alone, same as every rust-on-android crate
//! that touches a callback-based platform api (this isn't unique to
//! augur). [`ndk_context::android_context`] supplies the ambient
//! `JavaVM`/`Context` handle (already initialized by whatever runtime
//! hosts this process - tauri's android runtime already does this for
//! charnel today, see this crate's `Cargo.toml` for why that's known to
//! work here already).
//!
//! wire-compatible with the macos/linux/windows backend - see `wire.rs`'s
//! own doc comment for the exact shared service type/instance-name/txt
//! attribute format both sides use, so a desktop and an android device on
//! the same lan discover each other with no special-casing on either
//! side. `wire.rs` also holds the `resolve(endpoint_id)`/`subscribe()`
//! subscriber registries (shared with the ios backend) and the shared
//! discovery-session ref-counting - this file only has the actual jni
//! calls.
//!
//! known limitation, left for later: only the first address `publish()`
//! is given is advertised (plain `NsdManager.registerService` pre-api-34
//! has no multi-address concept; the os fills in the host ip itself from
//! whichever interface it picks).

use iroh::address_lookup::{
    AddressLookup, AddressLookupBuilder, AddressLookupBuilderError, EndpointData,
    Error as LookupError, Item as LookupItem,
};
use iroh::{Endpoint, EndpointId};
use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
use jni::sys::jint;
use jni::{JNIEnv, JavaVM};
use std::sync::OnceLock;
use n0_future::boxed::BoxStream;
use n0_future::StreamExt;
use tokio_stream::wrappers::ReceiverStream;

use super::wire::{self, DiscoveryGuard, SERVICE_TYPE};
use super::DiscoveredPeer;

/// identifies this backend's items in [`LookupItem::provenance`].
const PROVENANCE: &str = "augur-android";

const BRIDGE_CLASS: &str = "net/freqhole/augur/NsdBridge";

/// builder for the android backend - see this module's own doc comment.
/// the real address-lookup work happens in [`NsdAddressLookup`], built
/// once [`into_address_lookup`](AddressLookupBuilder::into_address_lookup)
/// runs and the endpoint's own node id is known.
#[derive(Debug, Clone, Copy, Default)]
pub struct NsdAddressLookupBuilder;

/// returns a ready-to-use address-lookup builder for this platform - plug
/// directly into
/// `iroh::Endpoint::builder(preset).address_lookup(haruspex::augur::builder())`.
pub fn builder() -> NsdAddressLookupBuilder {
    NsdAddressLookupBuilder
}

impl AddressLookupBuilder for NsdAddressLookupBuilder {
    fn into_address_lookup(
        self,
        endpoint: &Endpoint,
    ) -> Result<impl AddressLookup, AddressLookupBuilderError> {
        Ok(NsdAddressLookup {
            node_id: endpoint.id(),
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct NsdAddressLookup {
    node_id: EndpointId,
}

impl AddressLookup for NsdAddressLookup {
    fn publish(&self, data: &EndpointData) {
        let Some(addr) = data.ip_addrs().next() else {
            return;
        };
        let instance_name = wire::encode_instance_name(self.node_id);
        let user_data = data
            .user_data()
            .map(ToString::to_string)
            .unwrap_or_default();
        let relay_url = data
            .relay_urls()
            .next()
            .map(ToString::to_string)
            .unwrap_or_default();
        start_advertising(&instance_name, addr.port(), &user_data, &relay_url);
    }

    fn resolve(
        &self,
        endpoint_id: EndpointId,
    ) -> Option<BoxStream<Result<LookupItem, LookupError>>> {
        start_discovery();
        let rx = ReceiverStream::new(wire::register_resolver(endpoint_id));
        Some(Box::pin(DiscoveryGuard::new(rx, stop_discovery)))
    }
}

/// browses for every nearby augur peer, not just one already-known node
/// id - see [`super::DiscoveredPeer`]'s own doc comment. starts
/// `NsdManager` discovery on first use and stops it again once the
/// returned stream (and every other live `resolve()`/`subscribe()`
/// stream) is dropped - this is the one apps should use for an
/// add-remote "nearby peerz" ui, rather than leaving discovery running
/// in the background indefinitely.
///
/// `async fn` purely for signature parity with the desktop backend
/// (which genuinely needs to await something first) - nothing here
/// actually awaits.
pub async fn subscribe(local_node_id: EndpointId) -> BoxStream<DiscoveredPeer> {
    start_discovery();
    let rx = ReceiverStream::new(wire::register_subscriber());
    Box::pin(
        DiscoveryGuard::new(rx, stop_discovery)
            .filter(move |peer| peer.endpoint_id() != local_node_id),
    )
}

// ----------------------------------------------------------------------
// jni plumbing: rust calling into `NsdBridge`
// ----------------------------------------------------------------------

/// attaches the current thread to the jvm (if not already attached) and
/// runs `f` with the live `JNIEnv` + this process's `Context` jobject.
/// `None` if no android context has been initialized yet (shouldn't
/// normally happen once the app is actually running, but this is called
/// from arbitrary iroh-internal tasks, not just app startup code).
fn with_jni<R>(f: impl FnOnce(&mut JNIEnv, &JObject) -> jni::errors::Result<R>) -> Option<R> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let context = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };
    match f(&mut env, &context) {
        Ok(value) => Some(value),
        Err(err) => {
            tracing::warn!("augur: android jni call failed: {err}");
            None
        }
    }
}

/// the app's real `ClassLoader` (not the bootstrap one) - resolved once,
/// lazily, and cached as a `GlobalRef` since it's a plain java object
/// reference, safe to reuse from any later-attached thread regardless of
/// which thread first resolved it.
static CLASS_LOADER: OnceLock<GlobalRef> = OnceLock::new();

/// resolves [`BRIDGE_CLASS`] correctly from ANY thread - not just one the
/// app's own classloader is already associated with (the main/activity
/// thread). plain `JNIEnv::find_class` only works reliably there: a
/// background thread freshly attached via `attach_current_thread()`
/// (exactly what [`with_jni`] does, since every caller in this file runs
/// on a tokio worker thread, not the activity thread) has no app
/// classloader context of its own, so `find_class` silently falls back
/// to the system/bootstrap classloader - which can never see an
/// app-defined class like this one. confirmed via a real device crash,
/// not guessed: `ClassNotFoundException` with `DexPathList[[directory
/// "."]]` in the trace - that's the bootstrap classloader's own telltale
/// signature, not a real app dex path (the class was independently
/// confirmed present in the built apk's dex at the time).
///
/// the fix: resolve the app's REAL `ClassLoader` once, from the ambient
/// `Context` (itself always tied to the real classloader regardless of
/// which thread asks for it), cache it, and call its own `loadClass()`
/// method explicitly instead of `find_class()`.
fn bridge_class<'local>(
    env: &mut JNIEnv<'local>,
    context: &JObject,
) -> jni::errors::Result<JClass<'local>> {
    let class_loader = if let Some(cached) = CLASS_LOADER.get() {
        cached.clone()
    } else {
        let class_obj = env
            .call_method(context, "getClass", "()Ljava/lang/Class;", &[])?
            .l()?;
        let loader_obj = env
            .call_method(&class_obj, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
            .l()?;
        let global = env.new_global_ref(loader_obj)?;
        // another thread may have raced us here and already set it -
        // either value is the same real app classloader, so whichever
        // one "wins" doesn't matter.
        let _ = CLASS_LOADER.set(global.clone());
        global
    };
    let name = env.new_string(BRIDGE_CLASS.replace('/', "."))?;
    let class_obj = env
        .call_method(
            &class_loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name)],
        )?
        .l()?;
    Ok(JClass::from(class_obj))
}

fn start_advertising(instance_name: &str, port: u16, user_data: &str, relay_url: &str) {
    tracing::info!(
        instance_name,
        service_type = SERVICE_TYPE,
        port,
        "augur: android starting mdns advertise"
    );
    let result = with_jni(|env, context| {
        let class = bridge_class(env, context)?;
        let instance_name = env.new_string(instance_name)?;
        let service_type = env.new_string(SERVICE_TYPE)?;
        let user_data = env.new_string(user_data)?;
        let relay_url = env.new_string(relay_url)?;
        env.call_static_method(
            class,
            "startAdvertising",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/lang/String;)V",
            &[
                JValue::Object(context),
                JValue::Object(&instance_name),
                JValue::Object(&service_type),
                JValue::Int(jint::from(port)),
                JValue::Object(&user_data),
                JValue::Object(&relay_url),
            ],
        )?;
        Ok(())
    });
    if result.is_none() {
        tracing::warn!("augur: android mdns advertise jni call did not complete - see above");
    }
}

fn start_discovery() {
    tracing::info!(service_type = SERVICE_TYPE, "augur: android starting mdns discovery");
    let result = with_jni(|env, context| {
        let class = bridge_class(env, context)?;
        let service_type = env.new_string(SERVICE_TYPE)?;
        env.call_static_method(
            class,
            "startDiscovery",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(context), JValue::Object(&service_type)],
        )?;
        Ok(())
    });
    if result.is_none() {
        tracing::warn!("augur: android mdns discovery jni call did not complete - see above");
    }
}

/// stops `NsdManager` discovery - called once augur's shared discovery
/// ref-count (see `wire::DiscoveryGuard`) drops to zero, i.e. no more
/// live `resolve()`/`subscribe()` consumers want it running.
fn stop_discovery() {
    tracing::info!("augur: android stopping mdns discovery");
    with_jni(|env, context| {
        let class = bridge_class(env, context)?;
        env.call_static_method(class, "stopDiscovery", "()V", &[])?;
        Ok(())
    });
}

// ----------------------------------------------------------------------
// jni plumbing: `NsdBridge` calling into rust
// ----------------------------------------------------------------------

/// called by `NsdBridge.resolveNext`'s `onServiceResolved` once a nearby
/// instance's host/port/txt data is available. `host`/`port` are the
/// resolved socket address; `userData`/`relayUrl` are `""` (not null) for
/// "absent", matching how `NsdBridge.startAdvertising` encodes the same
/// on the way out.
///
/// # safety
/// called by the jvm with whatever arguments `NsdBridge` passes - safe as
/// long as that's the only caller (true for a `private` native method).
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_net_freqhole_augur_NsdBridge_nativeOnResolved(
    mut env: JNIEnv,
    _class: JClass,
    instance_name: JString,
    host: JString,
    port: jint,
    user_data: JString,
    relay_url: JString,
) {
    let decoded = (|| -> jni::errors::Result<(String, String, String, String)> {
        Ok((
            env.get_string(&instance_name)?.into(),
            env.get_string(&host)?.into(),
            env.get_string(&user_data)?.into(),
            env.get_string(&relay_url)?.into(),
        ))
    })();
    match decoded {
        Ok((instance_name, host, user_data, relay_url)) => {
            // ports are always in `0..=65535`; `NsdServiceInfo.port` is a
            // plain non-negative java int in that same range in practice.
            wire::deliver_resolved(
                PROVENANCE,
                &instance_name,
                &host,
                port as u16,
                &user_data,
                &relay_url,
            );
        }
        Err(err) => tracing::warn!("augur: failed to decode resolved android mdns peer: {err}"),
    }
}

/// called by `NsdBridge` once a previously-resolved instance disappears,
/// fanned out to `subscribe()`'s subscribers only (not `resolve()`'s -
/// its `Result<Item, Error>` stream has no "removed" signal to represent
/// this with, matching upstream `iroh-mdns-address-lookup`'s own
/// behavior).
///
/// # safety
/// same as [`Java_net_freqhole_augur_NsdBridge_nativeOnResolved`].
#[allow(non_snake_case)]
#[no_mangle]
pub extern "system" fn Java_net_freqhole_augur_NsdBridge_nativeOnLost(
    mut env: JNIEnv,
    _class: JClass,
    instance_name: JString,
) {
    if let Ok(instance_name) = env.get_string(&instance_name) {
        let instance_name: String = instance_name.into();
        tracing::debug!(instance_name, "augur: android mdns peer lost");
        wire::deliver_lost(&instance_name);
    }
}
