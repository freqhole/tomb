use std::{ffi::c_void, io, ptr::NonNull};

use objc2_core_foundation::{kCFRunLoopDefaultMode, CFArray, CFRunLoop};
use objc2_disk_arbitration::{
    kDADiskDescriptionWatchVolumePath, DADisk, DARegisterDiskAppearedCallback,
    DARegisterDiskDescriptionChangedCallback, DARegisterDiskDisappearedCallback, DASession,
};
use tokio::sync::watch;

pub(super) fn listen(notifications: &watch::Sender<u64>) -> io::Result<()> {
    unsafe {
        let session = DASession::new(None)
            .ok_or_else(|| io::Error::other("could not create Disk Arbitration session"))?;
        let run_loop = CFRunLoop::current()
            .ok_or_else(|| io::Error::other("could not get storage CFRunLoop"))?;
        let mode = kCFRunLoopDefaultMode
            .ok_or_else(|| io::Error::other("storage CFRunLoop mode unavailable"))?;
        // borrowed context stays alive until the session is unscheduled/dropped.
        let context = std::ptr::from_ref(notifications).cast_mut().cast();
        DARegisterDiskAppearedCallback(&session, None, Some(disk_changed), context);
        DARegisterDiskDisappearedCallback(&session, None, Some(disk_changed), context);
        DARegisterDiskDescriptionChangedCallback(
            &session,
            None,
            Some(kDADiskDescriptionWatchVolumePath),
            Some(mount_changed),
            context,
        );
        session.schedule_with_run_loop(&run_loop, mode);
        super::changed(notifications);
        CFRunLoop::run();
        session.unschedule_from_run_loop(&run_loop, mode);
    }
    Err(io::Error::other("storage CFRunLoop stopped"))
}

unsafe extern "C-unwind" fn disk_changed(_disk: NonNull<DADisk>, context: *mut c_void) {
    let sender = unsafe { &*context.cast::<watch::Sender<u64>>() };
    super::changed(sender);
}

unsafe extern "C-unwind" fn mount_changed(
    disk: NonNull<DADisk>,
    _keys: NonNull<CFArray>,
    context: *mut c_void,
) {
    unsafe { disk_changed(disk, context) };
}
