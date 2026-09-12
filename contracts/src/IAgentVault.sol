// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAgentVault
/// @notice Interface for Vigiles: On-chain Risk-Management Vault for AI Agents (v2)
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

    // --- v3 Guardrail Events ---
    event SessionGuardsUpdated(
        address indexed user,
        address indexed agent,
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval
    );
    event Heartbeat(address indexed user, address indexed agent, uint256 timestamp);
    event PositionCapUpdated(address indexed user, address indexed agent, address indexed token, uint256 maxPosition, uint256 epoch);
    event IntentRecorded(address indexed user, address indexed agent, uint256 indexed nonce, bytes32 intentHash);

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
    // --- v3 Guardrail Errors ---
    error OutsideTradingWindow();
    error VelocityLimitExceeded();
    error HeartbeatMissed();
    error PositionCapExceeded();
    error MissingIntent();
    error InvalidGuard();

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

    // --- v3 Guardrail Configuration ---
    /// @notice Session-wide guards. All zeros = disabled (v2 behaviour).
    /// @param windowStart Seconds since UTC midnight the agent may begin trading.
    /// @param windowEnd Seconds since UTC midnight the agent must stop. == windowStart disables.
    /// @param weekdayMask Bit i set = allowed on weekday i (0 = Sunday .. 6 = Saturday). 0 = all days.
    /// @param maxTradesPerHour Rolling-hour trade budget. 0 = unlimited.
    /// @param heartbeatInterval Max seconds between heartbeats before the agent freezes. 0 = disabled.
    function setSessionGuards(
        address agent,
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval
    ) external;
    /// @notice Dead-man switch: user proves liveness and restarts the heartbeat timer.
    function heartbeat(address agent) external;
    /// @notice Max holding of `token` the agent may leave in the user vault. 0 = unlimited.
    function setPositionCap(address agent, address token, uint256 maxPosition) external;

    // --- Core AI Agent Function ---
    /// @param intentHash keccak256 of the agent plaintext rationale. Must be non-zero.
    ///        Emitted in `IntentRecorded` so the off-chain reasoning log is tamper-evident.
    function executeTrade(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes32 intentHash,
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
    function getSessionGuards(address user, address agent) external view returns (
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval,
        uint256 lastHeartbeat,
        uint256 hourWindowStart,
        uint256 hourTradeCount,
        uint256 tradeNonce
    );
    function canTradeNow(address user, address agent) external view returns (bool);
    function getPositionCap(address user, address agent, address token) external view returns (uint256);
    function getPriceFloor(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 minAmountOutFloor);
}
