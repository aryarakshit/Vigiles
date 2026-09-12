#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![allow(clippy::too_many_arguments)]
extern crate alloc;

pub mod risk_engine;

use alloc::vec::Vec;
use alloy_primitives::aliases::{U32, U64, U8};
use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{sol, SolEvent};
use risk_engine::{RiskEngine, RiskEngineError, SessionCounters, SessionGuards};
use stylus_sdk::abi::Bytes;
use stylus_sdk::prelude::*;

sol_interface! {
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
        function decimals() external view returns (uint256);
    }

    interface IPriceFeed {
        function latestRoundData() external view returns (uint256, uint256, uint256, uint256, uint256);
        function decimals() external view returns (uint256);
    }

    interface ISwapAdapter {
        function swapExactIn(
            address token_in,
            address token_out,
            uint256 amount_in,
            uint256 min_amount_out,
            address recipient,
            bytes calldata data
        ) external returns (uint256 amount_out);
    }
}

sol! {
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
    /// v3: session-wide guardrails were (re)configured.
    event SessionGuardsUpdated(
        address indexed user,
        address indexed agent,
        uint256 windowStart,
        uint256 windowEnd,
        uint256 weekdayMask,
        uint256 maxTradesPerHour,
        uint256 heartbeatInterval
    );
    /// v3: user proved liveness; the dead-man timer restarts.
    event Heartbeat(address indexed user, address indexed agent, uint256 timestamp);
    /// v3: max holding of `token` the agent may accumulate for `user`.
    event PositionCapUpdated(address indexed user, address indexed agent, address indexed token, uint256 maxPosition, uint256 epoch);
    /// v3: tamper-proof commitment to the agent's stated reason for a trade.
    event IntentRecorded(address indexed user, address indexed agent, uint256 indexed nonce, bytes32 intentHash);
    /// Oracle floor: feeds are chosen per user, like tokens and adapters.
    event PriceFeedUpdated(address indexed user, address indexed token, address feed);
    event SequencerFeedUpdated(address indexed user, address feed);
    event SessionSlippageUpdated(address indexed user, address indexed agent, uint256 maxSlippageBps);

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
    error InvalidCap();
    error InvalidAdapter();
    error InvalidToken();
    error OutsideTradingWindow();
    error VelocityLimitExceeded();
    error HeartbeatMissed();
    error PositionCapExceeded();
    error MissingIntent();
    error InvalidGuard();
    error StalePriceFeed();
    error SequencerDown();
    error GracePeriodNotOver();
    error SlippageExceeded();
}

#[derive(SolidityError)]
pub enum AgentVaultError {
    SessionKeyInactive(SessionKeyInactive),
    SessionKeyExpired(SessionKeyExpired),
    SpendLimitExceeded(SpendLimitExceeded),
    DailyLimitExceeded(DailyLimitExceeded),
    TokenNotAllowed(TokenNotAllowed),
    AdapterNotAllowed(AdapterNotAllowed),
    InsufficientBalance(InsufficientBalance),
    ZeroAddress(ZeroAddress),
    ZeroAmount(ZeroAmount),
    ReentrancyError(ReentrancyError),
    SafeMathError(SafeMathError),
    ExternalCallFailed(ExternalCallFailed),
    OverSpent(OverSpent),
    InsufficientOutput(InsufficientOutput),
    InvalidCap(InvalidCap),
    InvalidAdapter(InvalidAdapter),
    InvalidToken(InvalidToken),
    OutsideTradingWindow(OutsideTradingWindow),
    VelocityLimitExceeded(VelocityLimitExceeded),
    HeartbeatMissed(HeartbeatMissed),
    PositionCapExceeded(PositionCapExceeded),
    MissingIntent(MissingIntent),
    InvalidGuard(InvalidGuard),
    StalePriceFeed(StalePriceFeed),
    SequencerDown(SequencerDown),
    GracePeriodNotOver(GracePeriodNotOver),
    SlippageExceeded(SlippageExceeded),
}

/// Test-only: name the variant without pulling `core::fmt` into the WASM build.
#[cfg(test)]
impl core::fmt::Debug for AgentVaultError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            AgentVaultError::SessionKeyInactive(_) => "SessionKeyInactive",
            AgentVaultError::SessionKeyExpired(_) => "SessionKeyExpired",
            AgentVaultError::SpendLimitExceeded(_) => "SpendLimitExceeded",
            AgentVaultError::DailyLimitExceeded(_) => "DailyLimitExceeded",
            AgentVaultError::TokenNotAllowed(_) => "TokenNotAllowed",
            AgentVaultError::AdapterNotAllowed(_) => "AdapterNotAllowed",
            AgentVaultError::InsufficientBalance(_) => "InsufficientBalance",
            AgentVaultError::ZeroAddress(_) => "ZeroAddress",
            AgentVaultError::ZeroAmount(_) => "ZeroAmount",
            AgentVaultError::ReentrancyError(_) => "ReentrancyError",
            AgentVaultError::SafeMathError(_) => "SafeMathError",
            AgentVaultError::ExternalCallFailed(_) => "ExternalCallFailed",
            AgentVaultError::OverSpent(_) => "OverSpent",
            AgentVaultError::InsufficientOutput(_) => "InsufficientOutput",
            AgentVaultError::InvalidCap(_) => "InvalidCap",
            AgentVaultError::InvalidAdapter(_) => "InvalidAdapter",
            AgentVaultError::InvalidToken(_) => "InvalidToken",
            AgentVaultError::OutsideTradingWindow(_) => "OutsideTradingWindow",
            AgentVaultError::VelocityLimitExceeded(_) => "VelocityLimitExceeded",
            AgentVaultError::HeartbeatMissed(_) => "HeartbeatMissed",
            AgentVaultError::PositionCapExceeded(_) => "PositionCapExceeded",
            AgentVaultError::MissingIntent(_) => "MissingIntent",
            AgentVaultError::InvalidGuard(_) => "InvalidGuard",
            AgentVaultError::StalePriceFeed(_) => "StalePriceFeed",
            AgentVaultError::SequencerDown(_) => "SequencerDown",
            AgentVaultError::GracePeriodNotOver(_) => "GracePeriodNotOver",
            AgentVaultError::SlippageExceeded(_) => "SlippageExceeded",
        })
    }
}

impl From<RiskEngineError> for AgentVaultError {
    fn from(e: RiskEngineError) -> Self {
        match e {
            RiskEngineError::SessionKeyInactive => AgentVaultError::SessionKeyInactive(SessionKeyInactive {}),
            RiskEngineError::SessionKeyExpired => AgentVaultError::SessionKeyExpired(SessionKeyExpired {}),
            RiskEngineError::TokenNotAllowed => AgentVaultError::TokenNotAllowed(TokenNotAllowed {}),
            RiskEngineError::AdapterNotAllowed => AgentVaultError::AdapterNotAllowed(AdapterNotAllowed {}),
            RiskEngineError::SpendLimitExceeded => AgentVaultError::SpendLimitExceeded(SpendLimitExceeded {}),
            RiskEngineError::DailyLimitExceeded => AgentVaultError::DailyLimitExceeded(DailyLimitExceeded {}),
            RiskEngineError::InsufficientBalance => AgentVaultError::InsufficientBalance(InsufficientBalance {}),
            RiskEngineError::OverSpent => AgentVaultError::OverSpent(OverSpent {}),
            RiskEngineError::InsufficientOutput => AgentVaultError::InsufficientOutput(InsufficientOutput {}),
            RiskEngineError::ZeroAmount => AgentVaultError::ZeroAmount(ZeroAmount {}),
            RiskEngineError::OutsideTradingWindow => AgentVaultError::OutsideTradingWindow(OutsideTradingWindow {}),
            RiskEngineError::VelocityLimitExceeded => AgentVaultError::VelocityLimitExceeded(VelocityLimitExceeded {}),
            RiskEngineError::HeartbeatMissed => AgentVaultError::HeartbeatMissed(HeartbeatMissed {}),
            RiskEngineError::PositionCapExceeded => AgentVaultError::PositionCapExceeded(PositionCapExceeded {}),
            RiskEngineError::MissingIntent => AgentVaultError::MissingIntent(MissingIntent {}),
        }
    }
}

impl From<alloc::vec::Vec<u8>> for AgentVaultError {
    fn from(_: alloc::vec::Vec<u8>) -> Self {
        AgentVaultError::ExternalCallFailed(ExternalCallFailed {})
    }
}

sol_storage! {
    pub struct SessionConfig {
        bool is_active;
        uint256 expiry;
        uint256 epoch;
    }

    pub struct TokenPolicy {
        bool allowed;
        uint256 per_trade_cap;
        uint256 daily_cap;
        uint256 bucket;
        uint256 bucket_ts;
    }

    /// v3 session guardrails + live counters. Small ints pack into two slots.
    pub struct SessionGuardState {
        uint32 window_start;
        uint32 window_end;
        uint8 weekday_mask;
        uint32 max_trades_per_hour;
        uint64 heartbeat_interval;
        uint64 last_heartbeat;
        uint64 hour_window_start;
        uint32 hour_trade_count;
        uint64 trade_nonce;
    }

    #[cfg_attr(any(target_arch = "wasm32", feature = "export-abi", test), entrypoint)]
    pub struct AgentVault {
        // user => token => balance (Address::ZERO for native ETH)
        mapping(address => mapping(address => uint256)) balances;
        // user => agent => SessionConfig
        mapping(address => mapping(address => SessionConfig)) sessions;
        // keccak(user, agent, epoch, token) => TokenPolicy
        mapping(bytes32 => TokenPolicy) token_policies;
        // keccak(user, agent, epoch, adapter) => bool
        mapping(bytes32 => bool) allowed_adapters;
        // Reentrancy guard state: 1 = NOT_ENTERED, 2 = ENTERED
        uint256 reentrancy_status;
        // v3: user => agent => guardrails (not epoch-scoped: guards only ever restrict)
        mapping(address => mapping(address => SessionGuardState)) guards;
        // v3: keccak(user, agent, epoch, token) => max holding; 0 = unlimited
        mapping(bytes32 => uint256) position_caps;
        // oracle floor: user => token => Chainlink-shaped feed (0 = no floor for that token)
        mapping(address => mapping(address => address)) price_feeds;
        // oracle floor: user => L2 sequencer uptime feed (0 = not checked)
        mapping(address => address) sequencer_feeds;
        // oracle floor: user => agent => max slippage bps (0 = default 500)
        mapping(address => mapping(address => uint256)) session_slippages;
    }
}

/// Oracle answers older than this are refused.
const MAX_STALENESS: u64 = 3600;
/// Seconds the L2 sequencer must have been back up before trades resume.
const GRACE_PERIOD: u64 = 3600;
/// Slippage tolerance used when a session has not set one.
const DEFAULT_SLIPPAGE_BPS: u64 = 500;

const NOT_ENTERED: U256 = U256::from_limbs([1, 0, 0, 0]);
const ENTERED: U256 = U256::from_limbs([2, 0, 0, 0]);

/// Epoch-scoped key shared by `token_policies`, `allowed_adapters` and `position_caps`.
/// Each lives in its own mapping, so a token and an adapter with the same address
/// never collide; the explicit token-vs-adapter checks exist for policy clarity.
fn get_policy_key(user: Address, agent: Address, epoch: U256, subject: Address) -> B256 {
    let mut buf = [0u8; 128];
    buf[12..32].copy_from_slice(user.as_slice());
    buf[44..64].copy_from_slice(agent.as_slice());
    buf[64..96].copy_from_slice(&epoch.to_be_bytes::<32>());
    buf[108..128].copy_from_slice(subject.as_slice());
    stylus_sdk::crypto::keccak(buf)
}

#[inline(always)]
fn get_adapter_key(user: Address, agent: Address, epoch: U256, adapter: Address) -> B256 {
    get_policy_key(user, agent, epoch, adapter)
}

/// Internal helpers. Kept outside the `#[public]` block on purpose: the macro
/// exports *every* fn it sees, and an externally callable `reentrancy_guard_enter`
/// would let anyone brick the vault with a single transaction.
impl AgentVault {
    fn ensure_reentrancy_initialized(&mut self) {
        if self.reentrancy_status.get() == U256::ZERO {
            self.reentrancy_status.set(NOT_ENTERED);
        }
    }

    fn reentrancy_guard_enter(&mut self) -> Result<(), AgentVaultError> {
        self.ensure_reentrancy_initialized();
        if self.reentrancy_status.get() == ENTERED {
            return Err(AgentVaultError::ReentrancyError(ReentrancyError {}));
        }
        self.reentrancy_status.set(ENTERED);
        Ok(())
    }

    fn reentrancy_guard_exit(&mut self) {
        self.reentrancy_status.set(NOT_ENTERED);
    }

    /// Reads one Chainlink-shaped feed and returns `(answer, decimals)` after
    /// staleness and sign checks. Answers with the top bit set are negative.
    fn read_feed(&self, feed: Address, now: u64) -> Result<(U256, u64), AgentVaultError> {
        let f = IPriceFeed::new(feed);
        let (_round, answer, _started, updated_at, _answered) = f
            .latest_round_data(self.vm(), Call::new())
            .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;
        let stale = answer == U256::ZERO
            || answer.bit(255)
            || updated_at == U256::ZERO
            || U256::from(now).saturating_sub(updated_at) > U256::from(MAX_STALENESS);
        if stale {
            return Err(AgentVaultError::StalePriceFeed(StalePriceFeed {}));
        }
        let dec = f
            .decimals(self.vm(), Call::new())
            .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;
        Ok((answer, dec.to::<u64>()))
    }

    /// Oracle price floor. Skipped unless the user configured a feed for BOTH
    /// tokens; then the sequencer (if configured) must be up and past its grace
    /// period, both feeds fresh, and `min_amount_out` must clear the floor.
    fn verify_oracle_floor(
        &self,
        user: Address,
        agent: Address,
        token_in: Address,
        token_out: Address,
        amount_in: U256,
        min_amount_out: U256,
    ) -> Result<(), AgentVaultError> {
        let feed_in = self.price_feeds.getter(user).getter(token_in).get();
        let feed_out = self.price_feeds.getter(user).getter(token_out).get();
        if feed_in == Address::ZERO || feed_out == Address::ZERO {
            return Ok(());
        }
        let now = self.vm().block_timestamp();

        let seq = self.sequencer_feeds.getter(user).get();
        if seq != Address::ZERO {
            let (_r, answer, started_at, _u, _a) = IPriceFeed::new(seq)
                .latest_round_data(self.vm(), Call::new())
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;
            if answer != U256::ZERO {
                return Err(AgentVaultError::SequencerDown(SequencerDown {}));
            }
            if U256::from(now).saturating_sub(started_at) < U256::from(GRACE_PERIOD) {
                return Err(AgentVaultError::GracePeriodNotOver(GracePeriodNotOver {}));
            }
        }

        let (p_in, fp_in) = self.read_feed(feed_in, now)?;
        let (p_out, fp_out) = self.read_feed(feed_out, now)?;
        let d_in = IERC20::new(token_in)
            .decimals(self.vm(), Call::new())
            .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
            .to::<u64>();
        let d_out = IERC20::new(token_out)
            .decimals(self.vm(), Call::new())
            .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
            .to::<u64>();

        let mut bps = self.session_slippages.getter(user).getter(agent).get().to::<u64>();
        if bps == 0 {
            bps = DEFAULT_SLIPPAGE_BPS;
        }
        match RiskEngine::min_out_meets_floor(amount_in, min_amount_out, p_in, p_out, d_in, d_out, fp_in, fp_out, bps) {
            Some(true) => Ok(()),
            Some(false) => Err(AgentVaultError::SlippageExceeded(SlippageExceeded {})),
            None => Err(AgentVaultError::SafeMathError(SafeMathError {})),
        }
    }

    fn load_guards(&self, user: Address, agent: Address) -> (SessionGuards, SessionCounters) {
        let g = self.guards.getter(user);
        let g = g.getter(agent);
        (
            SessionGuards {
                window_start: g.window_start.get().to::<u32>(),
                window_end: g.window_end.get().to::<u32>(),
                weekday_mask: g.weekday_mask.get().to::<u8>(),
                max_trades_per_hour: g.max_trades_per_hour.get().to::<u32>(),
                heartbeat_interval: g.heartbeat_interval.get().to::<u64>(),
            },
            SessionCounters {
                last_heartbeat: g.last_heartbeat.get().to::<u64>(),
                hour_window_start: g.hour_window_start.get().to::<u64>(),
                hour_trade_count: g.hour_trade_count.get().to::<u32>(),
                trade_nonce: g.trade_nonce.get().to::<u64>(),
            },
        )
    }
}

#[cfg(any(target_arch = "wasm32", feature = "export-abi", test))]
#[public]
impl AgentVault {
    pub fn deposit_erc20(&mut self, token: Address, amount: U256) -> Result<(), AgentVaultError> {
        if token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if amount == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        let bal_before = {
            let erc20 = IERC20::new(token);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };

        {
            let cfg = Call::new_mutating(self);
            let erc20 = IERC20::new(token);
            erc20
                .transfer_from(self.vm(), cfg, caller, vault, amount)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;
        }

        let bal_after = {
            let erc20 = IERC20::new(token);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };

        let actual_received = bal_after
            .checked_sub(bal_before)
            .ok_or(AgentVaultError::InsufficientOutput(InsufficientOutput {}))?;

        if actual_received == U256::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InsufficientOutput(InsufficientOutput {}));
        }

        let current_bal = self.balances.getter(caller).getter(token).get();
        let new_bal = current_bal
            .checked_add(actual_received)
            .ok_or(AgentVaultError::SafeMathError(SafeMathError {}))?;

        self.balances.setter(caller).setter(token).set(new_bal);
        self.reentrancy_guard_exit();

        let event = Deposit {
            user: caller,
            token,
            amount: actual_received,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    pub fn withdraw_erc20(&mut self, token: Address, amount: U256) -> Result<(), AgentVaultError> {
        if token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if amount == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();

        let current_bal = self.balances.getter(caller).getter(token).get();
        let new_bal = current_bal
            .checked_sub(amount)
            .ok_or(AgentVaultError::InsufficientBalance(InsufficientBalance {}))?;

        self.balances.setter(caller).setter(token).set(new_bal);

        let cfg = Call::new_mutating(self);
        let erc20 = IERC20::new(token);
        let call_res = erc20.transfer(self.vm(), cfg, caller, amount);
        self.reentrancy_guard_exit();

        if call_res.is_err() {
            return Err(AgentVaultError::ExternalCallFailed(ExternalCallFailed {}));
        }

        let event = Withdraw {
            user: caller,
            token,
            amount,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    pub fn create_session_key(
        &mut self,
        agent: Address,
        expiry: U256,
        tokens: Vec<Address>,
        per_trade_caps: Vec<U256>,
        daily_caps: Vec<U256>,
        adapters: Vec<Address>,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        if agent == Address::ZERO || agent == caller || agent == vault {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        let current_time = U256::from(self.vm().block_timestamp());
        if expiry <= current_time {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
        }
        if tokens.len() != per_trade_caps.len() || per_trade_caps.len() != daily_caps.len() {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SafeMathError(SafeMathError {}));
        }

        let current_epoch = {
            let mut user_sessions = self.sessions.setter(caller);
            let mut sess = user_sessions.setter(agent);
            let new_epoch = sess.epoch.get() + U256::from(1);
            sess.epoch.set(new_epoch);
            sess.is_active.set(true);
            sess.expiry.set(expiry);
            new_epoch
        };

        // Creating a key counts as a heartbeat so a dead-man timer configured
        // afterwards starts from "alive".
        {
            let now = self.vm().block_timestamp();
            let mut g = self.guards.setter(caller);
            let mut g = g.setter(agent);
            g.last_heartbeat.set(U64::from(now));
        }

        for i in 0..tokens.len() {
            let t = tokens[i];
            let pt_cap = per_trade_caps[i];
            let d_cap = daily_caps[i];

            if t == Address::ZERO || t == vault || t == agent {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InvalidToken(InvalidToken {}));
            }
            if pt_cap == U256::ZERO || d_cap == U256::ZERO || pt_cap > d_cap {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InvalidCap(InvalidCap {}));
            }

            let key = get_policy_key(caller, agent, current_epoch, t);
            let mut pol = self.token_policies.setter(key);
            pol.allowed.set(true);
            pol.per_trade_cap.set(pt_cap);
            pol.daily_cap.set(d_cap);
            pol.bucket.set(d_cap);
            pol.bucket_ts.set(current_time);
        }

        for adapter in adapters {
            if adapter == Address::ZERO || adapter == vault || adapter == agent {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InvalidAdapter(InvalidAdapter {}));
            }
            let is_token_key = get_policy_key(caller, agent, current_epoch, adapter);
            if self.token_policies.getter(is_token_key).allowed.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InvalidAdapter(InvalidAdapter {}));
            }

            let ad_key = get_adapter_key(caller, agent, current_epoch, adapter);
            self.allowed_adapters.setter(ad_key).set(true);
        }

        self.reentrancy_guard_exit();

        let event = SessionKeyCreated {
            user: caller,
            agent,
            expiry,
            epoch: current_epoch,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    pub fn revoke_session_key(&mut self, agent: Address) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        if agent == Address::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }

        let new_epoch = {
            let mut user_sessions = self.sessions.setter(caller);
            let mut sess = user_sessions.setter(agent);
            sess.is_active.set(false);
            let next_ep = sess.epoch.get() + U256::from(1);
            sess.epoch.set(next_ep);
            next_ep
        };

        self.reentrancy_guard_exit();

        let event = SessionKeyRevoked {
            user: caller,
            agent,
            epoch: new_epoch,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    // -----------------------------------------------------------------
    // Oracle floor configuration (per user — there is no admin key)
    // -----------------------------------------------------------------

    /// Point `token` at a Chainlink-shaped price feed for the caller's cage.
    /// `feed == 0` removes it. The floor is enforced only when both tokens
    /// of a trade have a feed.
    pub fn set_price_feed(&mut self, token: Address, feed: Address) -> Result<(), AgentVaultError> {
        if token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        let caller = self.vm().msg_sender();
        self.price_feeds.setter(caller).setter(token).set(feed);
        let event = PriceFeedUpdated { user: caller, token, feed };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    /// L2 sequencer uptime feed for the caller's cage. `0` disables the check.
    pub fn set_sequencer_feed(&mut self, feed: Address) -> Result<(), AgentVaultError> {
        let caller = self.vm().msg_sender();
        self.sequencer_feeds.setter(caller).set(feed);
        let event = SequencerFeedUpdated { user: caller, feed };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    /// Max slippage the floor tolerates for `agent`, in bps (≤ 5000). `0` = default 500.
    pub fn set_session_slippage(&mut self, agent: Address, max_slippage_bps: U256) -> Result<(), AgentVaultError> {
        if agent == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if max_slippage_bps > U256::from(5000u64) {
            return Err(AgentVaultError::InvalidCap(InvalidCap {}));
        }
        let caller = self.vm().msg_sender();
        self.session_slippages.setter(caller).setter(agent).set(max_slippage_bps);
        let event = SessionSlippageUpdated { user: caller, agent, maxSlippageBps: max_slippage_bps };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    // -----------------------------------------------------------------
    // v3 Guardrails
    // -----------------------------------------------------------------

    /// Configure session-wide guardrails for `agent`. Every field accepts `0`
    /// to mean "disabled"; a window with `start == end` is also disabled.
    /// Guards are intentionally NOT epoch-scoped: they persist across key
    /// rotation because they can only ever make the agent *more* restricted.
    pub fn set_session_guards(
        &mut self,
        agent: Address,
        window_start: U256,
        window_end: U256,
        weekday_mask: U256,
        max_trades_per_hour: U256,
        heartbeat_interval: U256,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        if agent == Address::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        let day = U256::from(86_400u64);
        if window_start >= day
            || window_end >= day
            || weekday_mask > U256::from(0x7Fu8)
            || max_trades_per_hour > U256::from(u32::MAX)
            || heartbeat_interval > U256::from(u64::MAX)
        {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidGuard(InvalidGuard {}));
        }
        let now = self.vm().block_timestamp();
        {
            let mut g = self.guards.setter(caller);
            let mut g = g.setter(agent);
            g.window_start.set(U32::from(window_start.to::<u32>()));
            g.window_end.set(U32::from(window_end.to::<u32>()));
            g.weekday_mask.set(U8::from(weekday_mask.to::<u8>()));
            g.max_trades_per_hour.set(U32::from(max_trades_per_hour.to::<u32>()));
            g.heartbeat_interval.set(U64::from(heartbeat_interval.to::<u64>()));
            // Configuring a heartbeat is itself a heartbeat.
            g.last_heartbeat.set(U64::from(now));
        }
        self.reentrancy_guard_exit();

        let event = SessionGuardsUpdated {
            user: caller,
            agent,
            windowStart: window_start,
            windowEnd: window_end,
            weekdayMask: weekday_mask,
            maxTradesPerHour: max_trades_per_hour,
            heartbeatInterval: heartbeat_interval,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    /// Dead-man switch: the user proves they are still watching. If
    /// `heartbeat_interval` seconds pass without a heartbeat the agent's
    /// trades revert with `HeartbeatMissed` until the user checks in again.
    pub fn heartbeat(&mut self, agent: Address) -> Result<(), AgentVaultError> {
        if agent == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        let caller = self.vm().msg_sender();
        let now = self.vm().block_timestamp();
        {
            let mut g = self.guards.setter(caller);
            let mut g = g.setter(agent);
            g.last_heartbeat.set(U64::from(now));
        }

        let event = Heartbeat {
            user: caller,
            agent,
            timestamp: U256::from(now),
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    /// Concentration guard: the agent may never leave `user`'s vault holding
    /// more than `max_position` of `token`. `0` disables. Epoch-scoped like
    /// token policies so revocation wipes it.
    pub fn set_position_cap(
        &mut self,
        agent: Address,
        token: Address,
        max_position: U256,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        if agent == Address::ZERO || token == Address::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        let (is_active, epoch) = {
            let user_sess = self.sessions.getter(caller);
            let sess = user_sess.getter(agent);
            (sess.is_active.get(), sess.epoch.get())
        };
        if !is_active {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyInactive(SessionKeyInactive {}));
        }
        let key = get_policy_key(caller, agent, epoch, token);
        self.position_caps.setter(key).set(max_position);
        self.reentrancy_guard_exit();

        let event = PositionCapUpdated {
            user: caller,
            agent,
            token,
            maxPosition: max_position,
            epoch,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);
        Ok(())
    }

    /// Execute a risk-bounded trade via an approved ISwapAdapter
    /// Zero unsafe blocks: swaps execute strictly through typed ISwapAdapter interface!
    #[allow(clippy::too_many_arguments)]
    pub fn execute_trade(
        &mut self,
        user: Address,
        token_in: Address,
        token_out: Address,
        amount_in: U256,
        min_amount_out: U256,
        adapter: Address,
        intent_hash: B256,
        data: Bytes,
    ) -> Result<U256, AgentVaultError> {
        let agent = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        if user == Address::ZERO || adapter == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if token_in == Address::ZERO || token_out == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if token_in == token_out {
            return Err(AgentVaultError::InvalidToken(InvalidToken {}));
        }
        if amount_in == U256::ZERO || min_amount_out == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        self.reentrancy_guard_enter()?;
        let current_time = U256::from(self.vm().block_timestamp());

        // 1. Authorize session & risk limits
        let (in_key, available_in, daily_cap_in) = {
            let user_sess = self.sessions.getter(user);
            let sess = user_sess.getter(agent);
            if !sess.is_active.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::SessionKeyInactive(SessionKeyInactive {}));
            }
            if current_time >= sess.expiry.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
            }
            let epoch = sess.epoch.get();

            let ad_key = get_adapter_key(user, agent, epoch, adapter);
            if !self.allowed_adapters.getter(ad_key).get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::AdapterNotAllowed(AdapterNotAllowed {}));
            }

            let in_key = get_policy_key(user, agent, epoch, token_in);
            let pol_in = self.token_policies.getter(in_key);
            if !pol_in.allowed.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::TokenNotAllowed(TokenNotAllowed {}));
            }
            if amount_in > pol_in.per_trade_cap.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::SpendLimitExceeded(SpendLimitExceeded {}));
            }

            let d_cap = pol_in.daily_cap.get();
            let avail = RiskEngine::calc_available(d_cap, pol_in.bucket.get(), pol_in.bucket_ts.get(), current_time);
            if amount_in > avail {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::DailyLimitExceeded(DailyLimitExceeded {}));
            }

            let out_key = get_policy_key(user, agent, epoch, token_out);
            let pol_out = self.token_policies.getter(out_key);
            if !pol_out.allowed.get() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::TokenNotAllowed(TokenNotAllowed {}));
            }

            let user_in_bal = self.balances.getter(user).getter(token_in).get();
            if user_in_bal < amount_in {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InsufficientBalance(InsufficientBalance {}));
            }

            (in_key, avail, d_cap)
        };

        // 1b. v3 session guardrails: intent receipt, dead-man, trading window, velocity
        let now_u64 = self.vm().block_timestamp();
        let next_counters = {
            let (g, c) = self.load_guards(user, agent);
            match RiskEngine::authorize_session_guards(now_u64, &g, &c, intent_hash == B256::ZERO) {
                Ok(next) => next,
                Err(e) => {
                    self.reentrancy_guard_exit();
                    return Err(AgentVaultError::from(e));
                }
            }
        };
        let out_key = {
            let epoch = self.sessions.getter(user).getter(agent).epoch.get();
            get_policy_key(user, agent, epoch, token_out)
        };

        // 1c. Oracle price floor (only when the user wired feeds for both tokens)
        if let Err(e) = self.verify_oracle_floor(user, agent, token_in, token_out, amount_in, min_amount_out) {
            self.reentrancy_guard_exit();
            return Err(e);
        }

        // 2. Effects: update user ledger, bucket and guard counters before external call
        {
            let mut g = self.guards.setter(user);
            let mut g = g.setter(agent);
            g.hour_window_start.set(U64::from(next_counters.hour_window_start));
            g.hour_trade_count.set(U32::from(next_counters.hour_trade_count));
            g.trade_nonce.set(U64::from(next_counters.trade_nonce));
        }
        {
            let cur_bal = self.balances.getter(user).getter(token_in).get();
            self.balances.setter(user).setter(token_in).set(cur_bal - amount_in);

            let mut pol = self.token_policies.setter(in_key);
            pol.bucket.set(available_in - amount_in);
            pol.bucket_ts.set(current_time);
        }

        // 3. Measure balances before swap
        let in_before = {
            let erc20 = IERC20::new(token_in);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };
        let out_before = {
            let erc20 = IERC20::new(token_out);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };

        // 4. Exact approval to adapter
        {
            let cfg = Call::new_mutating(self);
            let erc20 = IERC20::new(token_in);
            erc20
                .approve(self.vm(), cfg, adapter, amount_in)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;
        }

        // 5. Swap via ISwapAdapter
        {
            let cfg = Call::new_mutating(self);
            let swap_adapter = ISwapAdapter::new(adapter);
            let swap_res = swap_adapter.swap_exact_in(
                self.vm(),
                cfg,
                token_in,
                token_out,
                amount_in,
                min_amount_out,
                vault,
                data.0.into(),
            );
            if swap_res.is_err() {
                // Reset approval and exit
                let cfg_reset = Call::new_mutating(self);
                let _ = IERC20::new(token_in).approve(self.vm(), cfg_reset, adapter, U256::ZERO);
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::ExternalCallFailed(ExternalCallFailed {}));
            }
        }

        // 6. Immediate approval reset to 0
        {
            let cfg = Call::new_mutating(self);
            let _ = IERC20::new(token_in).approve(self.vm(), cfg, adapter, U256::ZERO);
        }

        // 7. Measure balances after swap
        let in_after = {
            let erc20 = IERC20::new(token_in);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };
        let out_after = {
            let erc20 = IERC20::new(token_out);
            erc20
                .balance_of(self.vm(), Call::new(), vault)
                .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?
        };

        if in_after + amount_in < in_before {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::OverSpent(OverSpent {}));
        }
        let spent = in_before - in_after;

        if out_after < out_before {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InsufficientOutput(InsufficientOutput {}));
        }
        let received = out_after - out_before;

        if received < min_amount_out {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InsufficientOutput(InsufficientOutput {}));
        }

        // 8. Refund unspent token_in and credit token_out
        let refund = amount_in - spent;
        if refund > U256::ZERO {
            let cur_in_bal = self.balances.getter(user).getter(token_in).get();
            self.balances.setter(user).setter(token_in).set(cur_in_bal + refund);

            let mut pol = self.token_policies.setter(in_key);
            let refilled = pol.bucket.get() + refund;
            pol.bucket.set(if refilled > daily_cap_in { daily_cap_in } else { refilled });
        }

        let cur_out_bal = self.balances.getter(user).getter(token_out).get();
        // v3 concentration guard: the whole tx reverts if the fill would push
        // the user's holding of token_out past the configured cap.
        let max_pos = self.position_caps.getter(out_key).get();
        if !RiskEngine::is_within_position_cap(cur_out_bal, received, max_pos) {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::PositionCapExceeded(PositionCapExceeded {}));
        }
        self.balances.setter(user).setter(token_out).set(cur_out_bal + received);

        self.reentrancy_guard_exit();

        let intent_event = IntentRecorded {
            user,
            agent,
            nonce: U256::from(next_counters.trade_nonce),
            intentHash: intent_hash,
        };
        let intent_log = intent_event.encode_log_data();
        let _ = self.vm().raw_log(intent_log.topics(), &intent_log.data);

        let event = TradeExecuted {
            user,
            agent,
            tokenIn: token_in,
            tokenOut: token_out,
            amountIn: amount_in,
            spent,
            received,
            adapter,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(received)
    }

    pub fn get_balance(&self, user: Address, token: Address) -> U256 {
        self.balances.getter(user).getter(token).get()
    }

    pub fn get_session(&self, user: Address, agent: Address) -> (bool, U256, U256) {
        let user_sess = self.sessions.getter(user);
        let sess = user_sess.getter(agent);
        let current_time = U256::from(self.vm().block_timestamp());
        (
            sess.is_active.get() && current_time < sess.expiry.get(),
            sess.expiry.get(),
            sess.epoch.get(),
        )
    }

    pub fn get_token_policy(
        &self,
        user: Address,
        agent: Address,
        token: Address,
    ) -> (bool, U256, U256, U256) {
        let user_sess = self.sessions.getter(user);
        let sess = user_sess.getter(agent);
        let epoch = sess.epoch.get();

        let pol_key = get_policy_key(user, agent, epoch, token);
        let pol = self.token_policies.getter(pol_key);

        let current_time = U256::from(self.vm().block_timestamp());
        let avail = RiskEngine::calc_available(
            pol.daily_cap.get(),
            pol.bucket.get(),
            pol.bucket_ts.get(),
            current_time,
        );

        (
            pol.allowed.get(),
            pol.per_trade_cap.get(),
            pol.daily_cap.get(),
            avail,
        )
    }

    pub fn is_adapter_allowed(&self, user: Address, agent: Address, adapter: Address) -> bool {
        let user_sess = self.sessions.getter(user);
        let sess = user_sess.getter(agent);
        let epoch = sess.epoch.get();
        let ad_key = get_adapter_key(user, agent, epoch, adapter);
        self.allowed_adapters.getter(ad_key).get()
    }

    /// v3: (windowStart, windowEnd, weekdayMask, maxTradesPerHour, heartbeatInterval,
    ///      lastHeartbeat, hourWindowStart, hourTradeCount, tradeNonce)
    pub fn get_session_guards(
        &self,
        user: Address,
        agent: Address,
    ) -> (U256, U256, U256, U256, U256, U256, U256, U256, U256) {
        let (g, c) = self.load_guards(user, agent);
        (
            U256::from(g.window_start),
            U256::from(g.window_end),
            U256::from(g.weekday_mask),
            U256::from(g.max_trades_per_hour),
            U256::from(g.heartbeat_interval),
            U256::from(c.last_heartbeat),
            U256::from(c.hour_window_start),
            U256::from(c.hour_trade_count),
            U256::from(c.trade_nonce),
        )
    }

    /// v3: true when every session guard would admit a trade right now.
    /// Lets an agent (or the MCP server) pre-flight cheaply before simulating.
    pub fn can_trade_now(&self, user: Address, agent: Address) -> bool {
        let (g, c) = self.load_guards(user, agent);
        let now = self.vm().block_timestamp();
        RiskEngine::authorize_session_guards(now, &g, &c, false).is_ok()
    }

    pub fn get_position_cap(&self, user: Address, agent: Address, token: Address) -> U256 {
        let epoch = self.sessions.getter(user).getter(agent).epoch.get();
        self.position_caps.getter(get_policy_key(user, agent, epoch, token)).get()
    }

    /// (price feed for `token`, sequencer feed, slippage bps for `agent`) — all per user.
    pub fn get_oracle_config(&self, user: Address, agent: Address, token: Address) -> (Address, Address, U256) {
        (
            self.price_feeds.getter(user).getter(token).get(),
            self.sequencer_feeds.getter(user).get(),
            self.session_slippages.getter(user).getter(agent).get(),
        )
    }
}
#[cfg(test)]
mod tests {
    //! Tests against the real Stylus contract via `TestVM`. These prove storage
    //! layout, ABI wiring and guard ordering on the actual Rust entrypoints.
    //! Swap settlement needs stateful ERC20 mocks and is covered by the Foundry
    //! suite against the Solidity reference plus the pure `risk_engine` tests.
    use super::*;
    use alloc::vec;
    use alloy_primitives::address;
    use stylus_sdk::testing::*;

    const ALICE: Address = address!("00000000000000000000000000000000000a11ce");
    const AGENT: Address = address!("000000000000000000000000000000000000aa99");
    const AAPL: Address = address!("0000000000000000000000000000000000aaaa01");
    const TSLA: Address = address!("0000000000000000000000000000000000aaaa02");
    const ADAPTER: Address = address!("00000000000000000000000000000000000ada01");
    /// 2024-01-01 00:00 UTC, a Monday.
    const MONDAY: u64 = 1_704_067_200;
    const NYSE_OPEN: u64 = 13 * 3600 + 30 * 60;
    const NYSE_CLOSE: u64 = 20 * 3600;
    const WEEKDAYS: u64 = 0x3E;

    fn setup() -> (TestVM, AgentVault) {
        let vm = TestVM::new();
        vm.set_block_timestamp(MONDAY + 14 * 3600);
        vm.set_sender(ALICE);
        let mut c = AgentVault::from(&vm);
        c.create_session_key(
            AGENT,
            U256::from(MONDAY + 30 * 86_400),
            vec![AAPL, TSLA],
            vec![U256::from(500), U256::from(500)],
            vec![U256::from(5_000), U256::from(5_000)],
            vec![ADAPTER],
        )
        .expect("session key");
        (vm, c)
    }

    fn set_nyse_guards(c: &mut AgentVault, max_per_hour: u64, heartbeat: u64) {
        c.set_session_guards(
            AGENT,
            U256::from(NYSE_OPEN),
            U256::from(NYSE_CLOSE),
            U256::from(WEEKDAYS),
            U256::from(max_per_hour),
            U256::from(heartbeat),
        )
        .expect("guards");
    }

    fn agent_trade(vm: &TestVM, c: &mut AgentVault, intent: B256) -> Result<U256, AgentVaultError> {
        vm.set_sender(AGENT);
        let r = c.execute_trade(
            ALICE,
            AAPL,
            TSLA,
            U256::from(100),
            U256::from(95),
            ADAPTER,
            intent,
            Bytes::from(alloc::vec::Vec::<u8>::new()),
        );
        vm.set_sender(ALICE);
        r
    }

    fn is(r: &Result<U256, AgentVaultError>, pred: impl Fn(&AgentVaultError) -> bool) -> bool {
        matches!(r, Err(e) if pred(e))
    }

    /// Seed `balances[user][token]` directly (Solidity-compatible nested mapping slot)
    /// so tests need no ERC20 round-trip.
    fn seed_balance(vm: &TestVM, user: Address, token: Address, amount: u64) {
        let inner = stylus_sdk::crypto::keccak({
            let mut b = [0u8; 64];
            b[12..32].copy_from_slice(user.as_slice());
            b
        });
        let slot = stylus_sdk::crypto::keccak({
            let mut b = [0u8; 64];
            b[12..32].copy_from_slice(token.as_slice());
            b[32..64].copy_from_slice(inner.as_slice());
            b
        });
        vm.set_storage(U256::from_be_bytes(slot.0), B256::from(U256::from(amount)));
    }

    #[test]
    fn session_key_roundtrip_and_epoch_bump() {
        let (_vm, mut c) = setup();
        let (active, expiry, epoch) = c.get_session(ALICE, AGENT);
        assert!(active);
        assert_eq!(expiry, U256::from(MONDAY + 30 * 86_400));
        assert_eq!(epoch, U256::from(1));

        let (allowed, per_trade, daily, avail) = c.get_token_policy(ALICE, AGENT, AAPL);
        assert!(allowed);
        assert_eq!(per_trade, U256::from(500));
        assert_eq!(daily, U256::from(5_000));
        assert_eq!(avail, U256::from(5_000));
        assert!(c.is_adapter_allowed(ALICE, AGENT, ADAPTER));

        c.revoke_session_key(AGENT).unwrap();
        let (active, _, epoch) = c.get_session(ALICE, AGENT);
        assert!(!active);
        assert_eq!(epoch, U256::from(2));
        // Epoch bump wipes the old policy view.
        let (allowed, ..) = c.get_token_policy(ALICE, AGENT, AAPL);
        assert!(!allowed);
        assert!(!c.is_adapter_allowed(ALICE, AGENT, ADAPTER));
    }

    #[test]
    fn guards_default_off_then_configured() {
        let (vm, mut c) = setup();
        // Sunday 03:00 with no guards: allowed.
        vm.set_block_timestamp(MONDAY + 6 * 86_400 + 3 * 3600);
        assert!(c.can_trade_now(ALICE, AGENT));

        set_nyse_guards(&mut c, 3, 0);
        let (ws, we, mask, mph, hb, last_hb, _, count, nonce) = c.get_session_guards(ALICE, AGENT);
        assert_eq!(ws, U256::from(NYSE_OPEN));
        assert_eq!(we, U256::from(NYSE_CLOSE));
        assert_eq!(mask, U256::from(WEEKDAYS));
        assert_eq!(mph, U256::from(3));
        assert_eq!(hb, U256::ZERO);
        assert_eq!(last_hb, U256::from(MONDAY + 6 * 86_400 + 3 * 3600));
        assert_eq!(count, U256::ZERO);
        assert_eq!(nonce, U256::ZERO);

        // Still Sunday 03:00 -> now blocked by weekday mask.
        assert!(!c.can_trade_now(ALICE, AGENT));
        // Monday 14:00 -> open.
        vm.set_block_timestamp(MONDAY + 7 * 86_400 + 14 * 3600);
        assert!(c.can_trade_now(ALICE, AGENT));
        // Monday 21:00 -> after close.
        vm.set_block_timestamp(MONDAY + 7 * 86_400 + 21 * 3600);
        assert!(!c.can_trade_now(ALICE, AGENT));
    }

    #[test]
    fn set_session_guards_rejects_invalid() {
        let (_vm, mut c) = setup();
        let bad = c.set_session_guards(AGENT, U256::from(86_400), U256::ZERO, U256::ZERO, U256::ZERO, U256::ZERO);
        assert!(matches!(bad, Err(AgentVaultError::InvalidGuard(_))));
        let bad = c.set_session_guards(AGENT, U256::ZERO, U256::ZERO, U256::from(0x80), U256::ZERO, U256::ZERO);
        assert!(matches!(bad, Err(AgentVaultError::InvalidGuard(_))));
    }

    #[test]
    fn heartbeat_freezes_and_restores() {
        let (vm, mut c) = setup();
        seed_balance(&vm, ALICE, AAPL, 10_000);
        set_nyse_guards(&mut c, 0, 86_400);
        // Tuesday 14:00:01 -> 24h + 1s since the guard config heartbeat.
        vm.set_block_timestamp(MONDAY + 86_400 + 14 * 3600 + 1);
        assert!(!c.can_trade_now(ALICE, AGENT));
        assert!(is(&agent_trade(&vm, &mut c, B256::with_last_byte(1)), |e| matches!(e, AgentVaultError::HeartbeatMissed(_))));

        c.heartbeat(AGENT).unwrap();
        assert!(c.can_trade_now(ALICE, AGENT));
        let (_, _, _, _, _, last_hb, _, _, _) = c.get_session_guards(ALICE, AGENT);
        assert_eq!(last_hb, U256::from(MONDAY + 86_400 + 14 * 3600 + 1));

        let logs = vm.get_emitted_logs();
        let heartbeat_topic = Heartbeat::SIGNATURE_HASH;
        assert!(logs.iter().any(|(topics, _)| topics[0] == heartbeat_topic));
    }

    #[test]
    fn execute_trade_guard_ordering_before_any_external_call() {
        let (vm, mut c) = setup();
        set_nyse_guards(&mut c, 3, 86_400);
        seed_balance(&vm, ALICE, AAPL, 10_000);
        assert_eq!(c.get_balance(ALICE, AAPL), U256::from(10_000));

        // 1. No rationale -> MissingIntent, even inside hours.
        assert!(is(&agent_trade(&vm, &mut c, B256::ZERO), |e| matches!(e, AgentVaultError::MissingIntent(_))));

        // 2. Outside hours -> OutsideTradingWindow.
        vm.set_block_timestamp(MONDAY + 3 * 3600);
        assert!(is(&agent_trade(&vm, &mut c, B256::with_last_byte(1)), |e| matches!(e, AgentVaultError::OutsideTradingWindow(_))));

        // 3. Revoked key -> SessionKeyInactive wins over everything.
        vm.set_block_timestamp(MONDAY + 14 * 3600);
        c.revoke_session_key(AGENT).unwrap();
        assert!(is(&agent_trade(&vm, &mut c, B256::with_last_byte(1)), |e| matches!(e, AgentVaultError::SessionKeyInactive(_))));

        // No external call was ever attempted: an un-mocked call would have panicked the TestVM.
    }

    #[test]
    fn position_cap_is_epoch_scoped() {
        let (_vm, mut c) = setup();
        c.set_position_cap(AGENT, TSLA, U256::from(250)).unwrap();
        assert_eq!(c.get_position_cap(ALICE, AGENT, TSLA), U256::from(250));
        c.revoke_session_key(AGENT).unwrap();
        assert_eq!(c.get_position_cap(ALICE, AGENT, TSLA), U256::ZERO);
        assert!(matches!(
            c.set_position_cap(AGENT, TSLA, U256::from(1)),
            Err(AgentVaultError::SessionKeyInactive(_))
        ));
    }

    // ---------------- oracle floor on the real contract ----------------
    //
    // stylus-test 0.10 serves return data from one global buffer holding the
    // LAST mocked value, whatever call matched. So every external call inside a
    // transaction sees the same bytes. We use one 160-byte blob that decodes
    // validly as both latestRoundData() (5 words) and decimals() (first word),
    // giving equal prices and decimals=1 everywhere. Per-feed asymmetry is
    // covered by the pure risk_engine tests and the Foundry suite.

    const FEED_IN: Address = address!("00000000000000000000000000000000000fee01");
    const FEED_OUT: Address = address!("00000000000000000000000000000000000fee02");
    const SEQ: Address = address!("00000000000000000000000000000000000fee03");
    const NOW: u64 = MONDAY + 14 * 3600;

    fn sel(sig: &str) -> [u8; 4] {
        let h = stylus_sdk::crypto::keccak(sig.as_bytes());
        [h[0], h[1], h[2], h[3]]
    }

    fn word(x: u64) -> [u8; 32] {
        U256::from(x).to_be_bytes::<32>()
    }

    /// Register one blob for every external view the oracle path can issue.
    fn mock_blob(vm: &TestVM, answer: u64, started_at: u64, updated_at: u64) {
        let mut blob = alloc::vec::Vec::new();
        for w in [word(1), word(answer), word(started_at), word(updated_at), word(1)] {
            blob.extend_from_slice(&w);
        }
        for to in [FEED_IN, FEED_OUT, SEQ, AAPL, TSLA] {
            for sig in ["latestRoundData()", "decimals()"] {
                vm.mock_static_call(to, sel(sig).to_vec(), Ok(blob.clone()));
            }
        }
    }

    fn oracle_setup() -> (TestVM, AgentVault) {
        let (vm, mut c) = setup();
        seed_balance(&vm, ALICE, AAPL, 10_000);
        c.set_price_feed(AAPL, FEED_IN).unwrap();
        c.set_price_feed(TSLA, FEED_OUT).unwrap();
        (vm, c)
    }

    /// Past the oracle, the trade hits the ERC20/adapter calls, which the blob
    /// cannot satisfy; either failure proves the oracle admitted the trade.
    fn reached_swap(r: &Result<U256, AgentVaultError>) -> bool {
        matches!(r, Err(AgentVaultError::ExternalCallFailed(_)) | Err(AgentVaultError::InsufficientOutput(_)))
    }

    #[test]
    fn oracle_skipped_when_no_feeds() {
        let (vm, mut c) = setup();
        seed_balance(&vm, ALICE, AAPL, 10_000);
        assert!(reached_swap(&agent_trade(&vm, &mut c, B256::with_last_byte(1))));
    }

    #[test]
    fn oracle_feeds_are_per_user() {
        let (_vm, mut c) = setup();
        c.set_price_feed(AAPL, FEED_IN).unwrap();
        let (f, seq, bps) = c.get_oracle_config(ALICE, AGENT, AAPL);
        assert_eq!((f, seq, bps), (FEED_IN, Address::ZERO, U256::ZERO));
        // Bob configuring a feed does not touch Alice's cage.
        let (bob_f, ..) = c.get_oracle_config(address!("0000000000000000000000000000000000000b0b"), AGENT, AAPL);
        assert_eq!(bob_f, Address::ZERO);
        c.set_price_feed(AAPL, Address::ZERO).unwrap();
        assert_eq!(c.get_oracle_config(ALICE, AGENT, AAPL).0, Address::ZERO);
    }

    #[test]
    fn oracle_stale_feed_refused() {
        let (vm, mut c) = oracle_setup();
        mock_blob(&vm, 200_00000000, NOW - 3601, NOW - 3601);
        let r = agent_trade(&vm, &mut c, B256::with_last_byte(1));
        assert!(matches!(r, Err(AgentVaultError::StalePriceFeed(_))), "got {:?}", r);
        // a zero answer is stale too
        mock_blob(&vm, 0, NOW, NOW);
        let r = agent_trade(&vm, &mut c, B256::with_last_byte(1));
        assert!(matches!(r, Err(AgentVaultError::StalePriceFeed(_))), "got {:?}", r);
    }

    #[test]
    fn oracle_sequencer_guard() {
        let (vm, mut c) = oracle_setup();
        c.set_sequencer_feed(SEQ).unwrap();
        // answer 1 = sequencer down
        mock_blob(&vm, 1, NOW - 10_000, NOW - 10);
        let r = agent_trade(&vm, &mut c, B256::with_last_byte(1));
        assert!(matches!(r, Err(AgentVaultError::SequencerDown(_))), "got {:?}", r);
        // back up, but only for 100 seconds
        mock_blob(&vm, 0, NOW - 100, NOW - 10);
        let r = agent_trade(&vm, &mut c, B256::with_last_byte(1));
        assert!(matches!(r, Err(AgentVaultError::GracePeriodNotOver(_))), "got {:?}", r);
        // removing the sequencer feed disables the check entirely
        c.set_sequencer_feed(Address::ZERO).unwrap();
        mock_blob(&vm, 200_00000000, NOW - 60, NOW - 60);
        assert!(reached_swap(&agent_trade(&vm, &mut c, B256::with_last_byte(1))));
    }

    #[test]
    fn oracle_floor_enforced_with_session_slippage() {
        let (vm, mut c) = oracle_setup();
        mock_blob(&vm, 200_00000000, NOW - 60, NOW - 60);
        // equal prices: 100 in -> 100 out; min 95 clears the default 5% floor
        assert!(reached_swap(&agent_trade(&vm, &mut c, B256::with_last_byte(1))));

        // tighten to 1%: min 95 < 99 -> refused before the venue is ever called
        c.set_session_slippage(AGENT, U256::from(100u64)).unwrap();
        let r = agent_trade(&vm, &mut c, B256::with_last_byte(1));
        assert!(matches!(r, Err(AgentVaultError::SlippageExceeded(_))), "got {:?}", r);

        // exactly 5% clears again
        c.set_session_slippage(AGENT, U256::from(500u64)).unwrap();
        assert!(reached_swap(&agent_trade(&vm, &mut c, B256::with_last_byte(1))));
    }

    #[test]
    fn set_session_slippage_validation() {
        let (_vm, mut c) = setup();
        assert!(matches!(c.set_session_slippage(AGENT, U256::from(5001u64)), Err(AgentVaultError::InvalidCap(_))));
        c.set_session_slippage(AGENT, U256::from(5000u64)).unwrap();
        assert_eq!(c.get_oracle_config(ALICE, AGENT, AAPL).2, U256::from(5000u64));
    }
}
