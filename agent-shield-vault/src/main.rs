#[cfg(feature = "export-abi")]
fn main() {
    stylus_sdk::abi::export::print_from_args::<agent_shield_vault::AgentVault>();
}

#[cfg(not(feature = "export-abi"))]
fn main() {}