use std::{io, ptr};
use tokio::sync::watch;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::Ioctl::GUID_DEVINTERFACE_VOLUME,
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::*,
};

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let creation = unsafe { &*(lparam as *const CREATESTRUCTW) };
        unsafe {
            SetWindowLongPtrW(window, GWLP_USERDATA, creation.lpCreateParams as isize);
        }
    }
    if message == WM_DEVICECHANGE
        && matches!(
            wparam as u32,
            DBT_DEVICEARRIVAL | DBT_DEVICEREMOVECOMPLETE | DBT_DEVNODES_CHANGED | DBT_CONFIGCHANGED
        )
    {
        let sender =
            unsafe { GetWindowLongPtrW(window, GWLP_USERDATA) } as *const watch::Sender<u64>;
        if !sender.is_null() {
            // borrowed for this thread's entire message loop; DestroyWindow
            // runs before listen returns and the sender can be released.
            super::changed(unsafe { &*sender });
        }
    }
    if message == WM_NCDESTROY {
        unsafe {
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        }
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

pub(super) fn listen(notifications: &watch::Sender<u64>) -> io::Result<()> {
    let name: Vec<u16> = "freqhole-storage-events"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    if instance.is_null() {
        return Err(io::Error::last_os_error());
    }
    let mut class: WNDCLASSW = unsafe { std::mem::zeroed() };
    class.lpfnWndProc = Some(window_proc);
    class.hInstance = instance;
    class.lpszClassName = name.as_ptr();
    if unsafe { RegisterClassW(&class) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // a hidden top-level window receives volume broadcasts; a message-only
    // window does not. no application GUI or periodic inventory is required.
    let window = unsafe {
        CreateWindowExW(
            0,
            name.as_ptr(),
            name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            instance,
            notifications as *const _ as *const _,
        )
    };
    if window.is_null() {
        let error = io::Error::last_os_error();
        unsafe {
            UnregisterClassW(name.as_ptr(), instance);
        }
        return Err(error);
    }
    let mut filter: DEV_BROADCAST_DEVICEINTERFACE_W = unsafe { std::mem::zeroed() };
    filter.dbcc_size = std::mem::size_of_val(&filter) as u32;
    filter.dbcc_devicetype = DBT_DEVTYP_DEVICEINTERFACE;
    filter.dbcc_classguid = GUID_DEVINTERFACE_VOLUME;
    let registration = unsafe {
        RegisterDeviceNotificationW(
            window,
            &filter as *const _ as *const _,
            DEVICE_NOTIFY_WINDOW_HANDLE,
        )
    };
    if registration.is_null() {
        let error = io::Error::last_os_error();
        unsafe {
            DestroyWindow(window);
            UnregisterClassW(name.as_ptr(), instance);
        }
        return Err(error);
    }
    super::changed(notifications);
    let mut message = unsafe { std::mem::zeroed() };
    let error = loop {
        let result = unsafe { GetMessageW(&mut message, ptr::null_mut(), 0, 0) };
        if result == -1 {
            break io::Error::last_os_error();
        }
        if result == 0 {
            break io::Error::other("storage notification message loop stopped");
        }
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    };
    unsafe {
        UnregisterDeviceNotification(registration);
        DestroyWindow(window);
        UnregisterClassW(name.as_ptr(), instance);
    }
    Err(error)
}
