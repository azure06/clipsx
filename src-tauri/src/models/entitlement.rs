use serde::{Deserialize, Serialize};

pub const FREE_OFFICE_RESTORE_LIMIT: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntitlementTier {
    Free,
    Pro,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAllowance {
    pub remaining_units: u32,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementState {
    pub tier: EntitlementTier,
    pub expires_at: Option<i64>,
    pub grace_until: Option<i64>,
    pub ai_allowance: Option<UsageAllowance>,
    pub refreshed_at: Option<i64>,
}

impl Default for EntitlementState {
    fn default() -> Self {
        Self {
            tier: EntitlementTier::Free,
            expires_at: None,
            grace_until: None,
            ai_allowance: None,
            refreshed_at: None,
        }
    }
}

impl EntitlementState {
    pub fn has_pro_access_at(&self, now: i64) -> bool {
        if self.tier != EntitlementTier::Pro {
            return false;
        }

        self.expires_at.is_none_or(|expires_at| {
            now <= expires_at
                || self
                    .grace_until
                    .is_some_and(|grace_until| now <= grace_until)
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeRestoreAllowance {
    pub limit: u32,
    pub used: u32,
    pub remaining: u32,
    pub unlimited: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pro_access_honors_expiry_and_grace() {
        let entitlement = EntitlementState {
            tier: EntitlementTier::Pro,
            expires_at: Some(100),
            grace_until: Some(120),
            ..EntitlementState::default()
        };

        assert!(entitlement.has_pro_access_at(100));
        assert!(entitlement.has_pro_access_at(120));
        assert!(!entitlement.has_pro_access_at(121));
    }
}
