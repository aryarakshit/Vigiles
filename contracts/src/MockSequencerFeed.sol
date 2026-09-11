// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISequencerUptimeFeed.sol";

/// @title MockSequencerFeed
/// @notice Configurable Arbitrum / Robinhood Chain Sequencer Uptime Feed mock.
contract MockSequencerFeed is ISequencerUptimeFeed {
    int256 public status; // 0 = up, 1 = down
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor() {
        status = 0; // up
        startedAt = block.timestamp > 7200 ? block.timestamp - 7200 : 0;
        updatedAt = block.timestamp;
    }

    function setStatus(int256 _status, uint256 _startedAt) external {
        status = _status;
        startedAt = _startedAt;
        updatedAt = block.timestamp;
        roundId++;
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
        return (roundId, status, startedAt, updatedAt, roundId);
    }
}
