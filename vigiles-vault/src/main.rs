#[cfg(feature = "export-abi")]
fn main() {
    stylus_sdk::abi::export::print_from_args::<vigiles_vault::AgentVault>();
}

#[cfg(not(feature = "export-abi"))]
fn main() {}