// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISwapAdapter.sol";
import "./MockTokenizedStock.sol";

interface IVaultReentrantTarget {
    function deposit_erc20(address token, uint256 amount) external;
    function depositErc20(address token, uint256 amount) external;
    function executeTrade(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) external returns (uint256);
}

/// @title MockSwapAdapter
/// @notice Implements ISwapAdapter with configurable behavior (normal, partial fill, hostile) for testing.
contract MockSwapAdapter is ISwapAdapter {
    enum BehaviorMode {
        Normal,
        PartialFill,
        Thief,
        Greedy,
        Reentrant,
        Stingy
    }

    BehaviorMode public mode = BehaviorMode.Normal;
    address public thiefRecipient;
    address public reentrancyVault;
    uint256 public customRateNumerator = 1;
    uint256 public customRateDenominator = 1;
    uint256 public partialFillSpendBps = 8000; // 80%

    event SwapCalled(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient);

    function setMode(BehaviorMode _mode) external {
        mode = _mode;
    }

    function setThiefRecipient(address _thief) external {
        thiefRecipient = _thief;
    }

    function setReentrancyVault(address _vault) external {
        reentrancyVault = _vault;
    }

    function setRate(uint256 num, uint256 den) external {
        require(den > 0, "Invalid rate");
        customRateNumerator = num;
        customRateDenominator = den;
    }

    function setPartialFillBps(uint256 bps) external {
        partialFillSpendBps = bps;
    }

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata /* data */
    ) external override returns (uint256 amountOut) {
        emit SwapCalled(tokenIn, tokenOut, amountIn, minAmountOut, recipient);

        if (mode == BehaviorMode.Normal) {
            // Pull tokenIn from caller (vault)
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            // Mint / send tokenOut to recipient
            amountOut = (amountIn * customRateNumerator) / customRateDenominator;
            if (amountOut < minAmountOut) {
                amountOut = minAmountOut;
            }
            MockTokenizedStock(tokenOut).mint(recipient, amountOut);
            return amountOut;
        } else if (mode == BehaviorMode.PartialFill) {
            // Only spend partial amount of tokenIn
            uint256 spent = (amountIn * partialFillSpendBps) / 10_000;
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), spent);
            amountOut = (spent * customRateNumerator) / customRateDenominator;
            if (amountOut < minAmountOut) {
                amountOut = minAmountOut;
            }
            MockTokenizedStock(tokenOut).mint(recipient, amountOut);
            return amountOut;
        } else if (mode == BehaviorMode.Thief) {
            // Thief: sends output to thiefRecipient instead of recipient!
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            amountOut = (amountIn * customRateNumerator) / customRateDenominator;
            address target = thiefRecipient != address(0) ? thiefRecipient : address(0xDEAD);
            MockTokenizedStock(tokenOut).mint(target, amountOut);
            return amountOut;
        } else if (mode == BehaviorMode.Greedy) {
            // Greedy: attempts to pull 2x amountIn
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn * 2);
            MockTokenizedStock(tokenOut).mint(recipient, minAmountOut);
            return minAmountOut;
        } else if (mode == BehaviorMode.Reentrant) {
            // Reentrant: attempts to call depositErc20 on the vault mid-swap
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            MockTokenizedStock(tokenIn).mint(address(this), 10 ether);
            MockTokenizedStock(tokenIn).approve(reentrancyVault, 10 ether);
            IVaultReentrantTarget(reentrancyVault).depositErc20(tokenIn, 10 ether);
            MockTokenizedStock(tokenOut).mint(recipient, minAmountOut);
            return minAmountOut;
        } else if (mode == BehaviorMode.Stingy) {
            // Stingy: pulls full amountIn but produces dust output (less than minAmountOut)
            MockTokenizedStock(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            amountOut = 1; // 1 wei dust
            MockTokenizedStock(tokenOut).mint(recipient, amountOut);
            return amountOut;
        }
        return 0;
    }
}
