// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AggregatorV3Interface.sol";

/// @title MockPriceFeed
/// @notice Configurable Chainlink AggregatorV3Interface mock for stock token and crypto feeds.
contract MockPriceFeed is AggregatorV3Interface {
    uint8 public override decimals;
    string public override description;
    uint256 public override version = 1;

    int256 public price;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(uint8 _decimals, int256 _initialPrice, string memory _desc) {
        decimals = _decimals;
        price = _initialPrice;
        description = _desc;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
        roundId++;
    }

    function setUpdatedAt(uint256 _updatedAt) external {
        updatedAt = _updatedAt;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        return (roundId, price, updatedAt, updatedAt, roundId);
    }
}
