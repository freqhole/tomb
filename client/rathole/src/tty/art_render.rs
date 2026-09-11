//! terminal-mode ("image_mode = terminal") rasterized rendering for
//! the pairing screen's now-playing album/artist art - the qr code
//! itself keeps using `tty::qr`'s precise unicode module renderer;
//! this is only for arbitrary photos, where halfblock downsampling
//! (not exact module mapping) is the right tradeoff.
//!
//! uses `ratatui-image`'s `Picker::halfblocks()` mode, which works in
//! any terminal (no sixel/kitty/iterm2 protocol detection needed) -
//! see docs/rathole-headless-player-plan.md's "image rendering modes"
//! section. the built `Protocol` is cached (keyed by path + render
//! area) since building one re-decodes and re-samples the source
//! image - cheap enough for the low frame rate rathole redraws at,
//! but not worth doing on every single frame regardless.

use std::cell::RefCell;

use ratatui::layout::{Rect, Size};
use ratatui::Frame;
use ratatui_image::picker::Picker;
use ratatui_image::protocol::Protocol;
use ratatui_image::{Image, Resize};

struct Cached {
    path: String,
    width: u16,
    height: u16,
    protocol: Protocol,
}

thread_local! {
    static PICKER: RefCell<Picker> = RefCell::new(Picker::halfblocks());
    static CACHE: RefCell<Option<Cached>> = const { RefCell::new(None) };
}

/// renders the image at `path` into `area`, halfblock-downsampled to
/// fit. returns `false` (renders nothing) if the file can't be read/
/// decoded, so callers can fall back to the qr/text display instead.
pub fn draw_art(frame: &mut Frame, area: Rect, path: &str) -> bool {
    if area.width == 0 || area.height == 0 {
        return false;
    }
    let needs_rebuild = CACHE.with(|c| {
        let cache = c.borrow();
        match cache.as_ref() {
            Some(cached) => {
                cached.path != path || cached.width != area.width || cached.height != area.height
            }
            None => true,
        }
    });
    if needs_rebuild {
        let Some(protocol) = build_protocol(path, area) else {
            return false;
        };
        CACHE.with(|c| {
            *c.borrow_mut() = Some(Cached {
                path: path.to_string(),
                width: area.width,
                height: area.height,
                protocol,
            });
        });
    }
    CACHE.with(|c| {
        if let Some(cached) = c.borrow().as_ref() {
            frame.render_widget(Image::new(&cached.protocol), area);
        }
    });
    true
}

fn build_protocol(path: &str, area: Rect) -> Option<Protocol> {
    let dyn_img = match image::ImageReader::open(path).and_then(|r| {
        r.with_guessed_format()
            .map_err(|e| std::io::Error::other(e.to_string()))
    }) {
        Ok(reader) => match reader.decode() {
            Ok(img) => img,
            Err(e) => {
                tracing::warn!(target: "rathole::tty::art", path, error = %e, "failed to decode art image");
                return None;
            }
        },
        Err(e) => {
            tracing::warn!(target: "rathole::tty::art", path, error = %e, "failed to open art image file");
            return None;
        }
    };
    PICKER.with(|p| {
        let picker = p.borrow_mut();
        let size = Size::new(area.width, area.height);
        match picker.new_protocol(dyn_img, size, Resize::Fit(None)) {
            Ok(protocol) => Some(protocol),
            Err(e) => {
                tracing::warn!(target: "rathole::tty::art", path, error = %e, "failed to build terminal image protocol");
                None
            }
        }
    })
}
