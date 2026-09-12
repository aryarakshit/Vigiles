// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAgentVault.sol";
import "./ISwapAdapter.sol";
import "./AggregatorV3Interface.sol";
import "./ISequencerUptimeFeed.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title AgentVaultSolidityReference
/// @notice EVM-equivalent Solidity reference of AgentVault v2 for Foundry integration testing
contract AgentVaultSolidityReference is IAgentVault {
    struct SessionConfig {
        bool isActive;
        uint256 expiry;
        uint256 epoch;
    }

    struct TokenPolicy {
        bool allowed;
        uint256 perTradeCap;
        uint256 dailyCap;
        uint256 bucket;
        uint256 bucketTs;
    }

    /// @dev v3 guardrails + live counters. Mirrors `SessionGuardState` in the Stylus vault.
    struct SessionGuardState {
        uint32 windowStart;
        uint32 windowEnd;
        uint8 weekdayMask;
        uint32 maxTradesPerHour;
        uint64 heartbeatInterval;
        uint64 lastHeartbeat;
        uint64 hourWindowStart;
        uint32 hourTradeCount;
        uint64 tradeNonce;
    }

    // user => token => balance (address(0) for ETH)
    mapping(address => mapping(address => uint256)) public balances;

    // user => agent => SessionConfig
    mapping(address => mapping(address => SessionConfig)) internal sessions;

    // user => agent => epoch => token => TokenPolicy
    mapping(address => mapping(address => mapping(uint256 => mapping(address => TokenPolicy)))) internal tokenPolicies;

    // user => agent => epoch => adapter => bool
    mapping(address => mapping(address => mapping(uint256 => mapping(address => bool)))) internal allowedAdapters;

    // user => agent => maxSlippageBps (0 = default)
    mapping(address => mapping(address => uint256)) internal sessionSlippages;

    // v3: user => agent => guards (not epoch-scoped: guards only ever restrict)
    mapping(address => mapping(address => SessionGuardState)) internal guards;

    // v3: user => agent => epoch => token => max holding (0 = unlimited)
    mapping(address => mapping(address => mapping(uint256 => mapping(address => uint256)))) internal positionCaps;

    uint256 public constant SECONDS_PER_HOUR = 3600;

    // Oracle floor, per user: user => token => Chainlink-shaped feed (0 = none)
    mapping(address => mapping(address => address)) internal priceFeeds;
    // user => L2 sequencer uptime feed (0 = not checked)
    mapping(address => address) internal sequencerFeeds;

    // Oracle answers older than this are refused.
    uint256 public constant MAX_STALENESS = 3600;
    // Seconds the sequencer must have been back up before trades resume.
    uint256 public constant GRACE_PERIOD_TIME = 3600;

    // Reentrancy guard state
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _reentrancyStatus = NOT_ENTERED;

    uint256 public constant SECONDS_PER_DAY = 86400;
    uint256 public constant DEFAULT_MAX_SLIPPAGE_BPS = 500; // 5%

    modifier nonReentrant() {
        if (_reentrancyStatus == ENTERED) revert ReentrancyError();
        _reentrancyStatus = ENTERED;
        _;
        _reentrancyStatus = NOT_ENTERED;
    }

    // --- Oracle floor configuration (per user — there is no admin key) ---

    function setPriceFeed(address token, address feed) external override {
        if (token == address(0)) revert ZeroAddress();
        priceFeeds[msg.sender][token] = feed;
        emit PriceFeedUpdated(msg.sender, token, feed);
    }

    function setSequencerFeed(address feed) external override {
        sequencerFeeds[msg.sender] = feed;
        emit SequencerFeedUpdated(msg.sender, feed);
    }

    function setSessionSlippage(address agent, uint256 maxSlippageBps) external override {
        if (agent == address(0)) revert ZeroAddress();
        if (maxSlippageBps > 5000) revert InvalidCap();
        sessionSlippages[msg.sender][agent] = maxSlippageBps;
        emit SessionSlippageUpdated(msg.sender, agent, maxSlippageBps);
    }

    // --- Core User Functions ---

    function depositErc20(address token, uint256 amount) external override nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balBefore = IERC20Metadata(token).balanceOf(address(this));
        bool success = IERC20Metadata(token).transferFrom(msg.sender, address(this), amount);
        if (!success) revert ExternalCallFailed();
        uint256 balAfter = IERC20Metadata(token).balanceOf(address(this));

        uint256 actualReceived = balAfter - balBefore;
        if (actualReceived == 0) revert InsufficientOutput();

        balances[msg.sender][token] += actualReceived;
        emit Deposit(msg.sender, token, actualReceived);
    }

    function withdrawErc20(address token, uint256 amount) external override nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();

        balances[msg.sender][token] -= amount;

        bool success = IERC20Metadata(token).transfer(msg.sender, amount);
        if (!success) revert ExternalCallFailed();

        emit Withdraw(msg.sender, token, amount);
    }

    function createSessionKey(
        address agent,
        uint256 expiry,
        address[] calldata tokens,
        uint256[] calldata perTradeCaps,
        uint256[] calldata dailyCaps,
        address[] calldata adapters
    ) external override nonReentrant {
        if (agent == address(0) || agent == msg.sender || agent == address(this)) {
            revert ZeroAddress();
        }
        if (expiry <= block.timestamp) revert SessionKeyExpired();
        if (tokens.length != perTradeCaps.length || perTradeCaps.length != dailyCaps.length) {
            revert SafeMathError();
        }

        SessionConfig storage session = sessions[msg.sender][agent];
        session.epoch += 1;
        uint256 currentEpoch = session.epoch;
        session.isActive = true;
        session.expiry = expiry;

        // Creating a key is an implicit heartbeat so a dead-man timer configured
        // afterwards starts from "alive".
        guards[msg.sender][agent].lastHeartbeat = uint64(block.timestamp);

        // Configure whitelisted tokens and caps
        for (uint256 i = 0; i < tokens.length; i++) {
            address t = tokens[i];
            if (t == address(0) || t == address(this) || t == agent) revert InvalidToken();
            if (perTradeCaps[i] == 0 || dailyCaps[i] == 0 || perTradeCaps[i] > dailyCaps[i]) {
                revert InvalidCap();
            }

            TokenPolicy storage policy = tokenPolicies[msg.sender][agent][currentEpoch][t];
            policy.allowed = true;
            policy.perTradeCap = perTradeCaps[i];
            policy.dailyCap = dailyCaps[i];
            policy.bucket = dailyCaps[i];
            policy.bucketTs = block.timestamp;

            emit TokenPolicyUpdated(msg.sender, agent, t, true, perTradeCaps[i], dailyCaps[i], currentEpoch);
        }

        // Configure allowed adapters
        for (uint256 j = 0; j < adapters.length; j++) {
            address a = adapters[j];
            if (a == address(0) || a == address(this) || a == agent) revert InvalidAdapter();
            // Adapter cannot be one of the whitelisted tokens
            if (tokenPolicies[msg.sender][agent][currentEpoch][a].allowed) revert InvalidAdapter();

            allowedAdapters[msg.sender][agent][currentEpoch][a] = true;
            emit AdapterPolicyUpdated(msg.sender, agent, a, true, currentEpoch);
        }

        emit SessionKeyCreated(msg.sender, agent, expiry, currentEpoch);
    }

    function revokeSessionKey(address agent) external override nonReentrant {
        if (agent == address(0)) revert ZeroAddress();
        SessionConfig storage session = sessions[msg.sender][agent];
        session.isActive = false;
        session.epoch += 1;
        emit SessionKeyRevoked(msg.sender, agent, session.epoch);
    }

    // --- v3 Guardrail Configuration ---

    function setSessionGuards(
        address agent,
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval
    ) external override nonReentrant {
        if (agent == address(0)) revert ZeroAddress();
        if (
            windowStart >= SECONDS_PER_DAY ||
            windowEnd >= SECONDS_PER_DAY ||
            weekdayMask > 0x7F ||
            maxTradesPerHour > type(uint32).max ||
            heartbeatInterval > type(uint64).max
        ) revert InvalidGuard();

        SessionGuardState storage g = guards[msg.sender][agent];
        g.windowStart = uint32(windowStart);
        g.windowEnd = uint32(windowEnd);
        g.weekdayMask = uint8(weekdayMask);
        g.maxTradesPerHour = uint32(maxTradesPerHour);
        g.heartbeatInterval = uint64(heartbeatInterval);
        // Configuring a heartbeat is itself a heartbeat.
        g.lastHeartbeat = uint64(block.timestamp);

        emit SessionGuardsUpdated(msg.sender, agent, windowStart, windowEnd, weekdayMask, maxTradesPerHour, heartbeatInterval);
    }

    function heartbeat(address agent) external override {
        if (agent == address(0)) revert ZeroAddress();
        guards[msg.sender][agent].lastHeartbeat = uint64(block.timestamp);
        emit Heartbeat(msg.sender, agent, block.timestamp);
    }

    function setPositionCap(address agent, address token, uint256 maxPosition) external override nonReentrant {
        if (agent == address(0) || token == address(0)) revert ZeroAddress();
        SessionConfig storage session = sessions[msg.sender][agent];
        if (!session.isActive) revert SessionKeyInactive();
        positionCaps[msg.sender][agent][session.epoch][token] = maxPosition;
        emit PositionCapUpdated(msg.sender, agent, token, maxPosition, session.epoch);
    }

    // --- Core AI Agent Function ---

    function executeTrade(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes32 intentHash,
        bytes calldata data
    ) external override nonReentrant returns (uint256 received) {
        address agent = msg.sender;

        // 1. Authorize session and validate risk rules
        uint256 epoch = _authorize(user, agent, tokenIn, tokenOut, amountIn, minAmountOut, adapter);

        // 1b. v3 session guardrails: intent receipt, dead-man, trading window, velocity
        uint256 nonce = _enforceSessionGuards(user, agent, intentHash);

        // 2. Oracle price guard floor check
        _verifyOracleFloor(user, agent, tokenIn, tokenOut, amountIn, minAmountOut);

        // 3. Effects: deduct tokenIn from user ledger & deduct from token bucket
        TokenPolicy storage policyIn = tokenPolicies[user][agent][epoch][tokenIn];
        uint256 available = _calcAvailable(policyIn);
        balances[user][tokenIn] -= amountIn;
        policyIn.bucket = available - amountIn;
        policyIn.bucketTs = block.timestamp;

        // 4. Interactions: execute swap via adapter with balance diff measurement
        (uint256 spent, uint256 outReceived) = _swapMeasured(tokenIn, tokenOut, amountIn, minAmountOut, adapter, data);

        // 5. Settlement: refund any unspent tokenIn and credit tokenOut to user
        uint256 refund = amountIn - spent;
        if (refund > 0) {
            balances[user][tokenIn] += refund;
            uint256 refilledBucket = policyIn.bucket + refund;
            policyIn.bucket = refilledBucket > policyIn.dailyCap ? policyIn.dailyCap : refilledBucket;
        }

        // v3 concentration guard: revert if the fill pushes the holding past the cap.
        uint256 maxPos = positionCaps[user][agent][epoch][tokenOut];
        if (maxPos != 0 && balances[user][tokenOut] + outReceived > maxPos) revert PositionCapExceeded();

        balances[user][tokenOut] += outReceived;

        emit IntentRecorded(user, agent, nonce, intentHash);
        emit TradeExecuted(user, agent, tokenIn, tokenOut, amountIn, spent, outReceived, adapter);
        return outReceived;
    }

    // --- v3 Guard Helpers ---

    /// @dev Runs the session-wide guards and bumps the counters. Returns the new trade nonce.
    function _enforceSessionGuards(address user, address agent, bytes32 intentHash) internal returns (uint256) {
        if (intentHash == bytes32(0)) revert MissingIntent();

        SessionGuardState storage g = guards[user][agent];

        if (g.heartbeatInterval != 0 && block.timestamp - g.lastHeartbeat > g.heartbeatInterval) {
            revert HeartbeatMissed();
        }
        if (!_isWithinTradingWindow(g)) revert OutsideTradingWindow();

        if (g.maxTradesPerHour != 0) {
            if (block.timestamp - g.hourWindowStart >= SECONDS_PER_HOUR) {
                g.hourWindowStart = uint64(block.timestamp);
                g.hourTradeCount = 0;
            }
            if (g.hourTradeCount >= g.maxTradesPerHour) revert VelocityLimitExceeded();
            g.hourTradeCount += 1;
        }

        g.tradeNonce += 1;
        return g.tradeNonce;
    }

    /// @dev 0 = Sunday .. 6 = Saturday. 1970-01-01 was a Thursday (4).
    function _weekday(uint256 ts) internal pure returns (uint8) {
        return uint8((ts / SECONDS_PER_DAY + 4) % 7);
    }

    function _isWithinTradingWindow(SessionGuardState storage g) internal view returns (bool) {
        if (g.weekdayMask != 0 && (g.weekdayMask & (uint8(1) << _weekday(block.timestamp))) == 0) {
            return false;
        }
        if (g.windowStart == g.windowEnd) return true;
        uint256 sod = block.timestamp % SECONDS_PER_DAY;
        if (g.windowStart < g.windowEnd) {
            return sod >= g.windowStart && sod < g.windowEnd;
        }
        return sod >= g.windowStart || sod < g.windowEnd;
    }

    // --- Internal Helpers to prevent stack-too-deep ---

    function _authorize(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter
    ) internal view returns (uint256 epoch) {
        if (user == address(0) || adapter == address(0)) revert ZeroAddress();
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (tokenIn == tokenOut) revert InvalidToken();
        if (amountIn == 0 || minAmountOut == 0) revert ZeroAmount();

        SessionConfig storage session = sessions[user][agent];
        if (!session.isActive) revert SessionKeyInactive();
        if (block.timestamp >= session.expiry) revert SessionKeyExpired();

        epoch = session.epoch;

        if (!allowedAdapters[user][agent][epoch][adapter]) revert AdapterNotAllowed();

        TokenPolicy storage policyIn = tokenPolicies[user][agent][epoch][tokenIn];
        if (!policyIn.allowed) revert TokenNotAllowed();
        if (amountIn > policyIn.perTradeCap) revert SpendLimitExceeded();

        uint256 available = _calcAvailable(policyIn);
        if (amountIn > available) revert DailyLimitExceeded();

        TokenPolicy storage policyOut = tokenPolicies[user][agent][epoch][tokenOut];
        if (!policyOut.allowed) revert TokenNotAllowed();

        if (balances[user][tokenIn] < amountIn) revert InsufficientBalance();
    }

    function _verifyOracleFloor(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal view {
        address feedIn = priceFeeds[user][tokenIn];
        address feedOut = priceFeeds[user][tokenOut];

        // Enforced only when the user wired feeds for both tokens.
        if (feedIn == address(0) || feedOut == address(0)) {
            return;
        }

        address seq = sequencerFeeds[user];
        if (seq != address(0)) {
            (, int256 seqAnswer, uint256 seqStartedAt, , ) = ISequencerUptimeFeed(seq).latestRoundData();
            if (seqAnswer != 0) revert SequencerDown();
            if (block.timestamp - seqStartedAt < GRACE_PERIOD_TIME) revert GracePeriodNotOver();
        }

        (, int256 pIn, , uint256 upIn, ) = AggregatorV3Interface(feedIn).latestRoundData();
        if (pIn <= 0 || upIn == 0 || block.timestamp - upIn > MAX_STALENESS) revert StalePriceFeed();

        (, int256 pOut, , uint256 upOut, ) = AggregatorV3Interface(feedOut).latestRoundData();
        if (pOut <= 0 || upOut == 0 || block.timestamp - upOut > MAX_STALENESS) revert StalePriceFeed();

        uint8 dIn = IERC20Metadata(tokenIn).decimals();
        uint8 dOut = IERC20Metadata(tokenOut).decimals();
        uint8 fpIn = AggregatorV3Interface(feedIn).decimals();
        uint8 fpOut = AggregatorV3Interface(feedOut).decimals();

        uint256 bps = sessionSlippages[user][agent];
        if (bps == 0) bps = DEFAULT_MAX_SLIPPAGE_BPS;

        // floor = N / D (integer). Agents compute minOut with floored maths, so accept
        // minOut >= floor(N/D), i.e. minOut*D + D > N — cross-multiplied, identical to the Stylus vault.
        uint256 d = uint256(pOut) * (10 ** (uint256(dIn) + fpIn)) * 10_000;
        uint256 n = amountIn * uint256(pIn) * (10 ** (uint256(dOut) + fpOut)) * (10_000 - bps);
        if (minAmountOut * d + d <= n) revert SlippageExceeded();
    }

    function _swapMeasured(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) internal returns (uint256 spent, uint256 received) {
        uint256 inBefore = IERC20Metadata(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20Metadata(tokenOut).balanceOf(address(this));

        // Exact approval to adapter
        bool approveSuccess = IERC20Metadata(tokenIn).approve(adapter, amountIn);
        if (!approveSuccess) revert ExternalCallFailed();

        // Interaction with adapter
        ISwapAdapter(adapter).swapExactIn(tokenIn, tokenOut, amountIn, minAmountOut, address(this), data);

        // Immediate reset of approval
        IERC20Metadata(tokenIn).approve(adapter, 0);

        uint256 inAfter = IERC20Metadata(tokenIn).balanceOf(address(this));
        uint256 outAfter = IERC20Metadata(tokenOut).balanceOf(address(this));

        if (inAfter + amountIn < inBefore) revert OverSpent();
        spent = inBefore - inAfter;

        if (outAfter < outBefore) revert InsufficientOutput();
        received = outAfter - outBefore;

        if (received < minAmountOut) revert InsufficientOutput();
    }

    function _calcAvailable(TokenPolicy memory policy) internal view returns (uint256) {
        if (policy.dailyCap == 0) return 0;
        if (policy.bucketTs == 0) return policy.dailyCap;
        if (block.timestamp <= policy.bucketTs) return policy.bucket;

        uint256 elapsed = block.timestamp - policy.bucketTs;
        uint256 refilled = policy.bucket + (elapsed * policy.dailyCap) / SECONDS_PER_DAY;
        return refilled > policy.dailyCap ? policy.dailyCap : refilled;
    }

    // --- View Functions ---

    function getBalance(address user, address token) external view override returns (uint256) {
        return balances[user][token];
    }

    function getSession(address user, address agent) external view override returns (bool active, uint256 expiry, uint256 epoch) {
        SessionConfig storage session = sessions[user][agent];
        return (
            session.isActive && block.timestamp < session.expiry,
            session.expiry,
            session.epoch
        );
    }

    function getTokenPolicy(address user, address agent, address token) external view override returns (
        bool allowed,
        uint256 perTradeCap,
        uint256 dailyCap,
        uint256 availableNow
    ) {
        SessionConfig storage session = sessions[user][agent];
        uint256 epoch = session.epoch;
        TokenPolicy memory policy = tokenPolicies[user][agent][epoch][token];
        return (
            policy.allowed,
            policy.perTradeCap,
            policy.dailyCap,
            _calcAvailable(policy)
        );
    }

    function isAdapterAllowed(address user, address agent, address adapter) external view override returns (bool) {
        SessionConfig storage session = sessions[user][agent];
        return allowedAdapters[user][agent][session.epoch][adapter];
    }

    function getSessionGuards(address user, address agent) external view override returns (
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval,
        uint256 lastHeartbeat,
        uint256 hourWindowStart,
        uint256 hourTradeCount,
        uint256 tradeNonce
    ) {
        SessionGuardState storage g = guards[user][agent];
        return (
            g.windowStart,
            g.windowEnd,
            g.weekdayMask,
            g.maxTradesPerHour,
            g.heartbeatInterval,
            g.lastHeartbeat,
            g.hourWindowStart,
            g.hourTradeCount,
            g.tradeNonce
        );
    }

    function canTradeNow(address user, address agent) external view override returns (bool) {
        SessionGuardState storage g = guards[user][agent];
        if (g.heartbeatInterval != 0 && block.timestamp - g.lastHeartbeat > g.heartbeatInterval) return false;
        if (!_isWithinTradingWindow(g)) return false;
        if (g.maxTradesPerHour != 0) {
            bool freshWindow = block.timestamp - g.hourWindowStart >= SECONDS_PER_HOUR;
            if (!freshWindow && g.hourTradeCount >= g.maxTradesPerHour) return false;
        }
        return true;
    }

    function getPositionCap(address user, address agent, address token) external view override returns (uint256) {
        return positionCaps[user][agent][sessions[user][agent].epoch][token];
    }

    function getOracleConfig(address user, address agent, address token) external view override returns (
        address priceFeed,
        address sequencerFeed,
        uint256 maxSlippageBps
    ) {
        return (priceFeeds[user][token], sequencerFeeds[user], sessionSlippages[user][agent]);
    }

    function getPriceFloor(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 minAmountOutFloor) {
        address feedIn = priceFeeds[user][tokenIn];
        address feedOut = priceFeeds[user][tokenOut];
        if (feedIn == address(0) || feedOut == address(0)) return 0;

        (, int256 pIn, , , ) = AggregatorV3Interface(feedIn).latestRoundData();
        (, int256 pOut, , , ) = AggregatorV3Interface(feedOut).latestRoundData();
        if (pIn <= 0 || pOut <= 0) return 0;

        uint8 dIn = IERC20Metadata(tokenIn).decimals();
        uint8 dOut = IERC20Metadata(tokenOut).decimals();
        uint8 fpIn = AggregatorV3Interface(feedIn).decimals();
        uint8 fpOut = AggregatorV3Interface(feedOut).decimals();

        uint256 numerator = amountIn * uint256(pIn) * (10 ** dOut) * (10 ** fpOut);
        uint256 denominator = uint256(pOut) * (10 ** dIn) * (10 ** fpIn);
        uint256 expectedOut = numerator / denominator;

        uint256 bps = sessionSlippages[user][agent];
        if (bps == 0) bps = DEFAULT_MAX_SLIPPAGE_BPS;

        return (expectedOut * (10_000 - bps)) / 10_000;
    }
}
