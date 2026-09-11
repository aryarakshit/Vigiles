// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ISequencerUptimeFeed
/// @notice Chainlink L2 Sequencer Uptime Status Feed interface for Arbitrum Orbit chains.
interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer, // 0 = Sequencer Up, 1 = Sequencer Down
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
