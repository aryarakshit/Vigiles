// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentVault.sol";
import "./MockTokenizedStock.sol";

/// @title AgentVaultSolidityReference
/// @notice EVM-equivalent Solidity reference of AgentVault for Foundry integration testing
contract AgentVaultSolidityReference is IAgentVault {
    struct SessionKeyConfig {
        bool isActive;
        uint256 maxSpendLimit;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 lastResetTimestamp;
        uint256 expiry;
        mapping(address => bool) allowedTokens;
    }

    // user => token => balance (address(0) for ETH)
    mapping(address => mapping(address => uint256)) public balances;
    // user => agent => SessionKeyConfig
    mapping(address => mapping(address => SessionKeyConfig)) internal sessionKeys;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _reentrancyStatus = NOT_ENTERED;

    uint256 public constant SECONDS_PER_DAY = 86400;

    modifier nonReentrant() {
        if (_reentrancyStatus == ENTERED) revert ReentrancyError();
        _reentrancyStatus = ENTERED;
        _;
        _reentrancyStatus = NOT_ENTERED;
    }

    function deposit_eth() external payable override {
        if (msg.value == 0) revert ZeroAmount();
        balances[msg.sender][address(0)] += msg.value;
        emit Deposit(msg.sender, address(0), msg.value);
    }

    function deposit_erc20(address token, uint256 amount) external override {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        bool success = MockTokenizedStock(token).transferFrom(msg.sender, address(this), amount);
        if (!success) revert ExternalCallFailed();

        balances[msg.sender][token] += amount;
        emit Deposit(msg.sender, token, amount);
    }

    function withdraw_eth(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][address(0)] < amount) revert InsufficientBalance();

        balances[msg.sender][address(0)] -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert ExternalCallFailed();

        emit Withdraw(msg.sender, address(0), amount);
    }

    function withdraw_erc20(address token, uint256 amount) external override nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();

        balances[msg.sender][token] -= amount;

        bool success = MockTokenizedStock(token).transfer(msg.sender, amount);
        if (!success) revert ExternalCallFailed();

        emit Withdraw(msg.sender, token, amount);
    }

    function create_session_key(
        address agent,
        uint256 max_spend_limit,
        uint256 daily_limit,
        uint256 expiry,
        address[] calldata allowed_tokens_list
    ) external override {
        if (agent == address(0)) revert ZeroAddress();
        if (max_spend_limit == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert SessionKeyExpired();

        SessionKeyConfig storage key = sessionKeys[msg.sender][agent];
        key.isActive = true;
        key.maxSpendLimit = max_spend_limit;
        key.dailyLimit = daily_limit;
        key.spentToday = 0;
        key.lastResetTimestamp = block.timestamp;
        key.expiry = expiry;

        for (uint256 i = 0; i < allowed_tokens_list.length; i++) {
            key.allowedTokens[allowed_tokens_list[i]] = true;
        }

        emit SessionKeyCreated(msg.sender, agent, max_spend_limit, daily_limit, expiry);
    }

    function set_token_whitelist(address agent, address token, bool allowed) external override {
        if (agent == address(0) || token == address(0)) revert ZeroAddress();
        sessionKeys[msg.sender][agent].allowedTokens[token] = allowed;
        emit TokenWhitelistUpdated(msg.sender, agent, token, allowed);
    }

    function revoke_session_key(address agent) external override {
        if (agent == address(0)) revert ZeroAddress();
        sessionKeys[msg.sender][agent].isActive = false;
        emit SessionKeyRevoked(msg.sender, agent);
    }

    function execute_trade(
        address user,
        address token_address,
        uint256 amount,
        address dex_router,
        bytes calldata call_data
    ) external override nonReentrant {
        if (user == address(0) || dex_router == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        address agent = msg.sender;
        SessionKeyConfig storage key = sessionKeys[user][agent];

        // 1. Verify session active
        if (!key.isActive) revert SessionKeyInactive();

        // 2. Verify expiry
        if (block.timestamp >= key.expiry) revert SessionKeyExpired();

        // 3. Verify token whitelist
        if (!key.allowedTokens[token_address]) revert TokenNotAllowed();

        // 4. Verify per-tx max spend limit
        if (amount > key.maxSpendLimit) revert SpendLimitExceeded();

        // 5. Verify daily limit & rolling window reset
        if (block.timestamp >= key.lastResetTimestamp + SECONDS_PER_DAY) {
            key.spentToday = 0;
            key.lastResetTimestamp = block.timestamp;
        }

        uint256 newSpentToday = key.spentToday + amount;
        if (key.dailyLimit > 0 && newSpentToday > key.dailyLimit) {
            revert DailyLimitExceeded();
        }

        // 6. Verify user balance
        if (balances[user][token_address] < amount) revert InsufficientBalance();

        // 7. Update state before external call (CEI)
        balances[user][token_address] -= amount;
        key.spentToday = newSpentToday;

        // 8. Execute external swap
        if (token_address == address(0)) {
            (bool success, ) = dex_router.call{value: amount}(call_data);
            if (!success) revert ExternalCallFailed();
        } else {
            MockTokenizedStock(token_address).approve(dex_router, amount);
            (bool success, ) = dex_router.call(call_data);
            if (!success) revert ExternalCallFailed();
        }

        emit TradeExecuted(user, agent, token_address, amount, dex_router);
    }

    function get_balance(address user, address token) external view override returns (uint256) {
        return balances[user][token];
    }

    function is_session_active(address user, address agent) external view override returns (bool) {
        SessionKeyConfig storage key = sessionKeys[user][agent];
        if (!key.isActive) return false;
        return block.timestamp < key.expiry;
    }

    function is_token_allowed(address user, address agent, address token) external view override returns (bool) {
        return sessionKeys[user][agent].allowedTokens[token];
    }

    function get_session_limits(address user, address agent) external view override returns (
        bool is_active,
        uint256 max_spend_limit,
        uint256 daily_limit,
        uint256 spent_today,
        uint256 last_reset_timestamp,
        uint256 expiry
    ) {
        SessionKeyConfig storage key = sessionKeys[user][agent];
        return (
            key.isActive,
            key.maxSpendLimit,
            key.dailyLimit,
            key.spentToday,
            key.lastResetTimestamp,
            key.expiry
        );
    }
}
