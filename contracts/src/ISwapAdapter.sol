// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ISwapAdapter
/// @notice Interface for all allowlisted swap adapters in Vigiles Vault v2.
/// @dev The vault never forwards raw calldata to arbitrary DEXes. All swaps
/// must implement this interface and be allowlisted per-session by the vault owner.
interface ISwapAdapter {
    /// @notice Swaps an exact input amount of tokenIn for tokenOut.
    /// @param tokenIn The address of the token being sold.
    /// @param tokenOut The address of the token being bought.
    /// @param amountIn The maximum amount of tokenIn to swap.
    /// @param minAmountOut The minimum acceptable amount of tokenOut received.
    /// @param recipient The address to receive tokenOut (always the vault address).
    /// @param data Optional adapter-specific routing data (e.g. pool fee or route path).
    /// @return amountOut The actual amount of tokenOut produced.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata data
    ) external returns (uint256 amountOut);
}
