// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAgentVault
/// @notice Interface for AgentShield: On-chain Risk-Management Vault for AI Agents
interface IAgentVault {
    // --- Events ---
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event SessionKeyCreated(
        address indexed user,
        address indexed agent,
        uint256 max_spend_limit,
        uint256 daily_limit,
        uint256 expiry
    );
    event SessionKeyRevoked(address indexed user, address indexed agent);
    event TradeExecuted(
        address indexed user,
        address indexed agent,
        address indexed token_in,
        uint256 amount_in,
        address dex_router
    );
    event TokenWhitelistUpdated(
        address indexed user,
        address indexed agent,
        address indexed token,
        bool allowed
    );

    // --- Custom Errors ---
    error Unauthorized();
    error SessionKeyInactive();
    error SessionKeyExpired();
    error SpendLimitExceeded();
    error DailyLimitExceeded();
    error TokenNotAllowed();
    error InsufficientBalance();
    error ZeroAddress();
    error ZeroAmount();
    error ReentrancyError();
    error SafeMathError();
    error ExternalCallFailed();

    // --- Core User Functions ---
    function deposit_eth() external payable;
    function deposit_erc20(address token, uint256 amount) external;
    function withdraw_eth(uint256 amount) external;
    function withdraw_erc20(address token, uint256 amount) external;
    function create_session_key(
        address agent,
        uint256 max_spend_limit,
        uint256 daily_limit,
        uint256 expiry,
        address[] calldata allowed_tokens_list
    ) external;
    function set_token_whitelist(address agent, address token, bool allowed) external;
    function revoke_session_key(address agent) external;

    // --- Core AI Agent Function ---
    function execute_trade(
        address user,
        address token_address,
        uint256 amount,
        address dex_router,
        bytes calldata call_data
    ) external;

    // --- View Functions ---
    function get_balance(address user, address token) external view returns (uint256);
    function is_session_active(address user, address agent) external view returns (bool);
    function is_token_allowed(address user, address agent, address token) external view returns (bool);
    function get_session_limits(address user, address agent) external view returns (
        bool is_active,
        uint256 max_spend_limit,
        uint256 daily_limit,
        uint256 spent_today,
        uint256 last_reset_timestamp,
        uint256 expiry
    );
}
