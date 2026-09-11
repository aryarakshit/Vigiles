// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockTokenizedStock.sol";

/// @title MockDEXRouter
/// @notice Simulates DEX swap execution for testing AI Agent trade routing
contract MockDEXRouter {
    event SwapExecuted(address indexed caller, address indexed tokenIn, uint256 amountIn, bytes data);

    function swapTokens(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut) external returns (uint256) {
        if (tokenIn != address(0)) {
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        }
        if (tokenOut != address(0)) {
            MockTokenizedStock(tokenOut).mint(msg.sender, minAmountOut);
        }
        emit SwapExecuted(msg.sender, tokenIn, amountIn, "");
        return minAmountOut;
    }

    fallback() external payable {
        emit SwapExecuted(msg.sender, address(0), msg.value, msg.data);
    }

    receive() external payable {
        emit SwapExecuted(msg.sender, address(0), msg.value, "");
    }
}
