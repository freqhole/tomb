use std::{
    fs::File,
    io::{self, Seek},
    os::fd::AsRawFd,
};
use tokio::sync::watch;

pub(super) fn listen(notifications: &watch::Sender<u64>) -> io::Result<()> {
    let socket = udev::MonitorBuilder::new()?
        .match_subsystem("block")?
        .listen()?;
    let mut mounts = File::open("/proc/self/mounts")?;
    read_mounts(&mut mounts)?;
    // catches changes between subscribing and the first inventory, including a
    // listener restart after an error.
    super::changed(notifications);
    loop {
        let mut descriptors = [
            libc::pollfd {
                fd: socket.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: mounts.as_raw_fd(),
                events: libc::POLLPRI,
                revents: 0,
            },
        ];
        // proc mount-table changes report POLLPRI|POLLERR; ordinary POLLIN is
        // always ready for this file and must not be requested.
        let result = unsafe { libc::poll(descriptors.as_mut_ptr(), descriptors.len() as _, -1) };
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        if descriptors
            .iter()
            .any(|fd| fd.revents & (libc::POLLHUP | libc::POLLNVAL) != 0)
            || descriptors[0].revents & libc::POLLERR != 0
        {
            return Err(io::Error::other("storage notification descriptor failed"));
        }
        let mut changed = false;
        if descriptors[0].revents & libc::POLLIN != 0 {
            changed |= socket.iter().count() > 0;
        }
        if descriptors[1].revents & (libc::POLLPRI | libc::POLLERR) != 0 {
            read_mounts(&mut mounts)?;
            changed = true;
        }
        if changed {
            super::changed(notifications);
        }
    }
}

fn read_mounts(file: &mut File) -> io::Result<()> {
    file.rewind()?;
    io::copy(file, &mut io::sink())?;
    Ok(())
}
