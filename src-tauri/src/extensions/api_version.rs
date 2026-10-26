//! Shared compatibility ceiling for the desktop host and package tool.
pub const API_VERSION: &str = "3.4.0";

/// Shared by archive inspection and runtime compatibility reporting.
pub fn supports(requirement: &str) -> bool {
    semver::VersionReq::parse(requirement).is_ok_and(|range| {
        range.matches(&semver::Version::parse(API_VERSION).expect("host API version is valid"))
    })
}
#[cfg(test)]
mod tests {
    #[test]
    fn recognizes_additive_api_ranges_and_rejects_future_or_invalid_requirements() {
        for range in ["^3.2", "^3.3", "^3.4"] {
            assert!(super::supports(range));
        }
        for range in ["^3.5", "^4.0", "invalid"] {
            assert!(!super::supports(range));
        }
    }
}
