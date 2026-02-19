#[cfg(target_os = "linux")]
pub fn get_active_app_name() -> Option<String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, Window};

    // Connect to X server
    let (conn, screen_num) = x11rb::connect(None).ok()?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    // Get _NET_ACTIVE_WINDOW atom
    let net_active_window = conn
        .intern_atom(false, b"_NET_ACTIVE_WINDOW")
        .ok()?
        .reply()
        .ok()?
        .atom;

    // Get active window
    // 32 = window id (u32), length 1
    let reply = conn
        .get_property(false, root, net_active_window, AtomEnum::WINDOW, 0, 1)
        .ok()?
        .reply()
        .ok()?;

    if reply.value_len == 0 {
        return None;
    }

    let active_window = u32::from_ne_bytes(reply.value[0..4].try_into().unwrap());

    // Get _NET_WM_NAME or WM_CLASS
    // First try _NET_WM_NAME (UTF-8)
    let net_wm_name = conn
        .intern_atom(false, b"_NET_WM_NAME")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let utf8_string = conn
        .intern_atom(false, b"UTF8_STRING")
        .ok()?
        .reply()
        .ok()?
        .atom;

    let reply = conn
        .get_property(false, active_window, net_wm_name, utf8_string, 0, 1024)
        .ok()?
        .reply()
        .ok()?;

    if reply.value_len > 0 {
        return String::from_utf8(reply.value).ok();
    }

    // Fallback to WM_CLASS (legacy)
    let reply = conn
        .get_property(
            false,
            active_window,
            AtomEnum::WM_CLASS,
            AtomEnum::STRING,
            0,
            1024,
        )
        .ok()?
        .reply()
        .ok()?;

    if reply.value_len > 0 {
        // WM_CLASS contains two strings separated by null byte: "instance\0class\0"
        // We usually want the class (second string) which is capitalized/proper name usually
        let s = reply.value;
        let parts: Vec<&[u8]> = s.split(|&b| b == 0).collect();
        if parts.len() >= 2 && !parts[1].is_empty() {
            return String::from_utf8(parts[1].to_vec()).ok();
        } else if !parts.is_empty() && !parts[0].is_empty() {
            return String::from_utf8(parts[0].to_vec()).ok();
        }
    }

    None
}
