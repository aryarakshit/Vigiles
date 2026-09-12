// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MockTokenizedStock.sol";
import "../src/MockSwapAdapter.sol";

/// @title DeployMocks
/// @notice Deploys the tokenized-stock mocks and the swap adapter the Vigiles
///         demo trades through on Robinhood Chain testnet, and mints a starting
///         balance to the deployer.
///
/// Usage:
///   forge script script/DeployMocks.s.sol:DeployMocks \
///     --rpc-url https://rpc.testnet.chain.robinhood.com \
///     --private-key $PRIVATE_KEY --broadcast -vv
contract DeployMocks is Script {
    uint256 public constant STARTING_BALANCE = 10_000 ether;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockTokenizedStock aapl = new MockTokenizedStock("Tokenized Apple", "AAPL");
        MockTokenizedStock tsla = new MockTokenizedStock("Tokenized Tesla", "TSLA");
        MockTokenizedStock nvda = new MockTokenizedStock("Tokenized Nvidia", "NVDA");
        MockSwapAdapter adapter = new MockSwapAdapter();

        aapl.mint(deployer, STARTING_BALANCE);
        tsla.mint(deployer, STARTING_BALANCE);
        nvda.mint(deployer, STARTING_BALANCE);

        vm.stopBroadcast();

        console2.log("DEPLOYER    ", deployer);
        console2.log("AAPL        ", address(aapl));
        console2.log("TSLA        ", address(tsla));
        console2.log("NVDA        ", address(nvda));
        console2.log("SWAP_ADAPTER", address(adapter));

        // Machine-readable line for scripts/deploy_mocks.sh to parse.
        string memory json = string.concat(
            '{"aapl":"', vm.toString(address(aapl)),
            '","tsla":"', vm.toString(address(tsla)),
            '","nvda":"', vm.toString(address(nvda)),
            '","swapAdapter":"', vm.toString(address(adapter)),
            '","deployer":"', vm.toString(deployer), '"}'
        );
        console2.log("MOCKS_JSON", json);
    }
}
