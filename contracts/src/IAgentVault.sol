// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAgentVault
/// @notice Interface for AgentShield: On-chain Risk-Management Vault for AI Agents (v2)
interface IAgentVault {
    // --- Events ---
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event SessionKeyCreated(address indexed user, address indexed agent, uint256 expiry, uint256 epoch);
    event SessionKeyRevoked(address indexed user, address indexed agent, uint256 epoch);
    event TokenPolicyUpdated(
        address indexed user,
        address indexed agent,
        address indexed token,
        bool allowed,
        uint256 perTradeCap,
        uint256 dailyCap,
        uint256 epoch
    );
    event AdapterPolicyUpdated(
        address indexed user,
        address indexed agent,
        address indexed adapter,
        bool allowed,
        uint256 epoch
    );
    event TradeExecuted(
        address indexed user,
        address indexed agent,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 spent,
        uint256 received,
        address adapter
    );
    event PriceFeedUpdated(address indexed token, address feed);
    event SequencerFeedUpdated(address feed);
    event SessionSlippageUpdated(address indexed user, address indexed agent, uint256 maxSlippageBps);

    // --- Custom Errors ---
    error Unauthorized();
    error SessionKeyInactive();
    error SessionKeyExpired();
    error SpendLimitExceeded();
    error DailyLimitExceeded();
    error TokenNotAllowed();
    error AdapterNotAllowed();
    error InsufficientBalance();
    error ZeroAddress();
    error ZeroAmount();
    error ReentrancyError();
    error SafeMathError();
    error ExternalCallFailed();
    error OverSpent();
    error InsufficientOutput();
    error StalePriceFeed();
    error SequencerDown();
    error GracePeriodNotOver();
    error SlippageExceeded();
    error InvalidCap();
    error InvalidAdapter();
    error InvalidToken();

    // --- Core User Functions ---
    function depositEth() external payable;
    function depositErc20(address token, uint256 amount) external;
    function withdrawEth(uint256 amount) external;
    function withdrawErc20(address token, uint256 amount) external;
    function createSessionKey(
        address agent,
        uint256 expiry,
        address[] calldata tokens,
        uint256[] calldata perTradeCaps,
        uint256[] calldata dailyCaps,
        address[] calldata adapters
    ) external;
    function setTokenPolicy(
        address agent,
        address token,
        bool allowed,
        uint256 perTradeCap,
        uint256 dailyCap
    ) external;
    function setAdapter(address agent, address adapter, bool allowed) external;
    function revokeSessionKey(address agent) external;
    function setSessionSlippage(address agent, uint256 maxSlippageBps) external;

    // --- Core AI Agent Function ---
    function executeTrade(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) external returns (uint256 received);

    // --- View Functions ---
    function getBalance(address user, address token) external view returns (uint256);
    function getSession(address user, address agent) external view returns (bool active, uint256 expiry, uint256 epoch);
    function getTokenPolicy(address user, address agent, address token) external view returns (
        bool allowed,
        uint256 perTradeCap,
        uint256 dailyCap,
        uint256 availableNow
    );
    function isAdapterAllowed(address user, address agent, address adapter) external view returns (bool);
    function sessionSlippage(address user, address agent) external view returns (uint256);
    function getPriceFloor(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 minAmountOutFloor);
}
