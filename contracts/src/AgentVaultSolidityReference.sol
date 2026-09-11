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

    // user => token => balance (address(0) for ETH)
    mapping(address => mapping(address => uint256)) public balances;

    // user => agent => SessionConfig
    mapping(address => mapping(address => SessionConfig)) internal sessions;

    // user => agent => epoch => token => TokenPolicy
    mapping(address => mapping(address => mapping(uint256 => mapping(address => TokenPolicy)))) internal tokenPolicies;

    // user => agent => epoch => adapter => bool
    mapping(address => mapping(address => mapping(uint256 => mapping(address => bool)))) internal allowedAdapters;

    // user => agent => maxSlippageBps
    mapping(address => mapping(address => uint256)) public override sessionSlippage;

    // token => price feed
    mapping(address => address) public priceFeeds;

    // Sequencer uptime feed
    address public sequencerUptimeFeed;

    // Max staleness for oracle feeds (default: 3600 seconds = 1 hour)
    uint256 public maxStaleness = 3600;

    // Sequencer grace period after restart (default: 3600 seconds = 1 hour)
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

    // --- Price Feed & Sequencer Admin ---

    function setPriceFeed(address token, address feed) external {
        if (token == address(0)) revert ZeroAddress();
        priceFeeds[token] = feed;
        emit PriceFeedUpdated(token, feed);
    }

    function setSequencerFeed(address feed) external {
        sequencerUptimeFeed = feed;
        emit SequencerFeedUpdated(feed);
    }

    function setMaxStaleness(uint256 _maxStaleness) external {
        if (_maxStaleness == 0) revert ZeroAmount();
        maxStaleness = _maxStaleness;
    }

    // --- Core User Functions ---

    function depositEth() external payable override nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        balances[msg.sender][address(0)] += msg.value;
        emit Deposit(msg.sender, address(0), msg.value);
    }

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

    function withdrawEth(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][address(0)] < amount) revert InsufficientBalance();

        balances[msg.sender][address(0)] -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert ExternalCallFailed();

        emit Withdraw(msg.sender, address(0), amount);
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

    function setTokenPolicy(
        address agent,
        address token,
        bool allowed,
        uint256 perTradeCap,
        uint256 dailyCap
    ) external override nonReentrant {
        SessionConfig storage session = sessions[msg.sender][agent];
        if (!session.isActive) revert SessionKeyInactive();
        if (block.timestamp >= session.expiry) revert SessionKeyExpired();
        if (token == address(0) || token == address(this) || token == agent) revert InvalidToken();

        uint256 currentEpoch = session.epoch;
        if (allowedAdapters[msg.sender][agent][currentEpoch][token]) revert InvalidToken();

        TokenPolicy storage policy = tokenPolicies[msg.sender][agent][currentEpoch][token];

        if (allowed) {
            if (perTradeCap == 0 || dailyCap == 0 || perTradeCap > dailyCap) {
                revert InvalidCap();
            }

            uint256 currentAvail = _calcAvailable(policy);
            policy.allowed = true;
            policy.perTradeCap = perTradeCap;
            policy.dailyCap = dailyCap;
            // Cap bucket to new dailyCap
            policy.bucket = currentAvail > dailyCap ? dailyCap : currentAvail;
            if (policy.bucket == 0 && policy.bucketTs == 0) {
                policy.bucket = dailyCap;
            }
            policy.bucketTs = block.timestamp;
        } else {
            policy.allowed = false;
        }

        emit TokenPolicyUpdated(msg.sender, agent, token, allowed, perTradeCap, dailyCap, currentEpoch);
    }

    function setAdapter(address agent, address adapter, bool allowed) external override nonReentrant {
        SessionConfig storage session = sessions[msg.sender][agent];
        if (!session.isActive) revert SessionKeyInactive();
        if (block.timestamp >= session.expiry) revert SessionKeyExpired();
        if (adapter == address(0) || adapter == address(this) || adapter == agent) revert InvalidAdapter();

        uint256 currentEpoch = session.epoch;
        if (tokenPolicies[msg.sender][agent][currentEpoch][adapter].allowed) revert InvalidAdapter();

        allowedAdapters[msg.sender][agent][currentEpoch][adapter] = allowed;
        emit AdapterPolicyUpdated(msg.sender, agent, adapter, allowed, currentEpoch);
    }

    function revokeSessionKey(address agent) external override nonReentrant {
        if (agent == address(0)) revert ZeroAddress();
        SessionConfig storage session = sessions[msg.sender][agent];
        session.isActive = false;
        session.epoch += 1;
        emit SessionKeyRevoked(msg.sender, agent, session.epoch);
    }

    function setSessionSlippage(address agent, uint256 maxSlippageBps) external override nonReentrant {
        if (maxSlippageBps > 5000) revert InvalidCap(); // Max 50% slippage allowed
        sessionSlippage[msg.sender][agent] = maxSlippageBps;
        emit SessionSlippageUpdated(msg.sender, agent, maxSlippageBps);
    }

    // --- Core AI Agent Function ---

    function executeTrade(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address adapter,
        bytes calldata data
    ) external override nonReentrant returns (uint256 received) {
        address agent = msg.sender;

        // 1. Authorize session and validate risk rules
        uint256 epoch = _authorize(user, agent, tokenIn, tokenOut, amountIn, minAmountOut, adapter);

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

        balances[user][tokenOut] += outReceived;

        emit TradeExecuted(user, agent, tokenIn, tokenOut, amountIn, spent, outReceived, adapter);
        return outReceived;
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
        address feedIn = priceFeeds[tokenIn];
        address feedOut = priceFeeds[tokenOut];

        // If either feed is not set, skip oracle check (or testnet mode)
        if (feedIn == address(0) || feedOut == address(0)) {
            return;
        }

        // Check sequencer uptime if configured
        if (sequencerUptimeFeed != address(0)) {
            (, int256 seqAnswer, uint256 seqStartedAt, , ) = ISequencerUptimeFeed(sequencerUptimeFeed).latestRoundData();
            if (seqAnswer != 0) revert SequencerDown();
            if (block.timestamp - seqStartedAt < GRACE_PERIOD_TIME) revert GracePeriodNotOver();
        }

        // Check tokenIn price feed
        (, int256 pIn, , uint256 upIn, ) = AggregatorV3Interface(feedIn).latestRoundData();
        if (pIn <= 0 || upIn == 0 || block.timestamp - upIn > maxStaleness) revert StalePriceFeed();

        // Check tokenOut price feed
        (, int256 pOut, , uint256 upOut, ) = AggregatorV3Interface(feedOut).latestRoundData();
        if (pOut <= 0 || upOut == 0 || block.timestamp - upOut > maxStaleness) revert StalePriceFeed();

        uint8 dIn = IERC20Metadata(tokenIn).decimals();
        uint8 dOut = IERC20Metadata(tokenOut).decimals();
        uint8 fpIn = AggregatorV3Interface(feedIn).decimals();
        uint8 fpOut = AggregatorV3Interface(feedOut).decimals();

        // expectedOut = (amountIn * pIn * 10^dOut * 10^fpOut) / (pOut * 10^dIn * 10^fpIn)
        uint256 numerator = amountIn * uint256(pIn) * (10 ** dOut) * (10 ** fpOut);
        uint256 denominator = uint256(pOut) * (10 ** dIn) * (10 ** fpIn);
        uint256 expectedOut = numerator / denominator;

        uint256 bps = sessionSlippage[user][agent];
        if (bps == 0) {
            bps = DEFAULT_MAX_SLIPPAGE_BPS;
        }

        uint256 floor = (expectedOut * (10_000 - bps)) / 10_000;
        if (minAmountOut < floor) {
            revert SlippageExceeded();
        }
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

    function getPriceFloor(
        address user,
        address agent,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view override returns (uint256 minAmountOutFloor) {
        address feedIn = priceFeeds[tokenIn];
        address feedOut = priceFeeds[tokenOut];
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

        uint256 bps = sessionSlippage[user][agent];
        if (bps == 0) bps = DEFAULT_MAX_SLIPPAGE_BPS;

        return (expectedOut * (10_000 - bps)) / 10_000;
    }
}
