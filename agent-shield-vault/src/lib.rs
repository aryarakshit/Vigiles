#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
#![allow(clippy::too_many_arguments)]
extern crate alloc;

pub mod risk_engine;

use alloc::vec::Vec;
use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::{sol, SolEvent};
use risk_engine::RiskEngine;
use stylus_sdk::prelude::*;

sol_interface! {
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
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
    event SessionSlippageUpdated(address indexed user, address indexed agent, uint256 maxSlippageBps);

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
}

#[derive(SolidityError)]
pub enum AgentVaultError {
    Unauthorized(Unauthorized),
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
    StalePriceFeed(StalePriceFeed),
    SequencerDown(SequencerDown),
    GracePeriodNotOver(GracePeriodNotOver),
    SlippageExceeded(SlippageExceeded),
    InvalidCap(InvalidCap),
    InvalidAdapter(InvalidAdapter),
    InvalidToken(InvalidToken),
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
        // user => agent => max_slippage_bps
        mapping(address => mapping(address => uint256)) session_slippages;
        // Reentrancy guard state: 1 = NOT_ENTERED, 2 = ENTERED
        uint256 reentrancy_status;
    }
}

const NOT_ENTERED: U256 = U256::from_limbs([1, 0, 0, 0]);
const ENTERED: U256 = U256::from_limbs([2, 0, 0, 0]);

fn get_policy_key(user: Address, agent: Address, epoch: U256, token: Address) -> B256 {
    let mut buf = [0u8; 128];
    buf[12..32].copy_from_slice(user.as_slice());
    buf[44..64].copy_from_slice(agent.as_slice());
    buf[64..96].copy_from_slice(&epoch.to_be_bytes::<32>());
    buf[108..128].copy_from_slice(token.as_slice());
    stylus_sdk::crypto::keccak(buf)
}

fn get_adapter_key(user: Address, agent: Address, epoch: U256, adapter: Address) -> B256 {
    let mut buf = [0u8; 128];
    buf[12..32].copy_from_slice(user.as_slice());
    buf[44..64].copy_from_slice(agent.as_slice());
    buf[64..96].copy_from_slice(&epoch.to_be_bytes::<32>());
    buf[108..128].copy_from_slice(adapter.as_slice());
    stylus_sdk::crypto::keccak(buf)
}

#[cfg(any(target_arch = "wasm32", feature = "export-abi", test))]
#[public]
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

    #[payable]
    pub fn deposit_eth(&mut self) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        let value = self.vm().msg_value();

        if value == U256::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        let user_bals = self.balances.getter(caller);
        let current_bal = user_bals.getter(Address::ZERO).get();
        let new_bal = current_bal
            .checked_add(value)
            .ok_or(AgentVaultError::SafeMathError(SafeMathError {}))?;

        let mut user_bals_setter = self.balances.setter(caller);
        user_bals_setter.setter(Address::ZERO).set(new_bal);
        self.reentrancy_guard_exit();

        let event = Deposit {
            user: caller,
            token: Address::ZERO,
            amount: value,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

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

    pub fn withdraw_eth(&mut self, amount: U256) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();

        if amount == U256::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        let current_bal = self.balances.getter(caller).getter(Address::ZERO).get();
        let new_bal = current_bal
            .checked_sub(amount)
            .ok_or(AgentVaultError::InsufficientBalance(InsufficientBalance {}))?;

        self.balances.setter(caller).setter(Address::ZERO).set(new_bal);

        let transfer_res = stylus_sdk::call::transfer::transfer_eth(self.vm(), caller, amount);
        self.reentrancy_guard_exit();

        if transfer_res.is_err() {
            return Err(AgentVaultError::ExternalCallFailed(ExternalCallFailed {}));
        }

        let event = Withdraw {
            user: caller,
            token: Address::ZERO,
            amount,
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

    pub fn set_token_policy(
        &mut self,
        agent: Address,
        token: Address,
        allowed: bool,
        per_trade_cap: U256,
        daily_cap: U256,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        let (is_active, expiry, epoch) = {
            let user_sess = self.sessions.getter(caller);
            let sess = user_sess.getter(agent);
            (sess.is_active.get(), sess.expiry.get(), sess.epoch.get())
        };

        if !is_active {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyInactive(SessionKeyInactive {}));
        }
        let current_time = U256::from(self.vm().block_timestamp());
        if current_time >= expiry {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
        }
        if token == Address::ZERO || token == vault || token == agent {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidToken(InvalidToken {}));
        }

        let ad_key = get_adapter_key(caller, agent, epoch, token);
        if self.allowed_adapters.getter(ad_key).get() {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidToken(InvalidToken {}));
        }

        let pol_key = get_policy_key(caller, agent, epoch, token);
        if allowed {
            if per_trade_cap == U256::ZERO || daily_cap == U256::ZERO || per_trade_cap > daily_cap {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::InvalidCap(InvalidCap {}));
            }
            let cur_bucket = self.token_policies.getter(pol_key).bucket.get();
            let cur_ts = self.token_policies.getter(pol_key).bucket_ts.get();
            let old_d_cap = self.token_policies.getter(pol_key).daily_cap.get();
            let avail = RiskEngine::calc_available(old_d_cap, cur_bucket, cur_ts, current_time);

            let mut pol = self.token_policies.setter(pol_key);
            pol.allowed.set(true);
            pol.per_trade_cap.set(per_trade_cap);
            pol.daily_cap.set(daily_cap);
            pol.bucket.set(if avail > daily_cap { daily_cap } else { avail });
            pol.bucket_ts.set(current_time);
        } else {
            self.token_policies.setter(pol_key).allowed.set(false);
        }

        self.reentrancy_guard_exit();
        Ok(())
    }

    pub fn set_adapter(
        &mut self,
        agent: Address,
        adapter: Address,
        allowed: bool,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        let (is_active, expiry, epoch) = {
            let user_sess = self.sessions.getter(caller);
            let sess = user_sess.getter(agent);
            (sess.is_active.get(), sess.expiry.get(), sess.epoch.get())
        };

        if !is_active {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyInactive(SessionKeyInactive {}));
        }
        let current_time = U256::from(self.vm().block_timestamp());
        if current_time >= expiry {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
        }
        if adapter == Address::ZERO || adapter == vault || adapter == agent {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidAdapter(InvalidAdapter {}));
        }

        let pol_key = get_policy_key(caller, agent, epoch, adapter);
        if self.token_policies.getter(pol_key).allowed.get() {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidAdapter(InvalidAdapter {}));
        }

        let ad_key = get_adapter_key(caller, agent, epoch, adapter);
        self.allowed_adapters.setter(ad_key).set(allowed);

        self.reentrancy_guard_exit();
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

    pub fn set_session_slippage(
        &mut self,
        agent: Address,
        max_slippage_bps: U256,
    ) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();
        if max_slippage_bps > U256::from(5000) {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::InvalidCap(InvalidCap {}));
        }
        self.session_slippages
            .setter(caller)
            .setter(agent)
            .set(max_slippage_bps);
        self.reentrancy_guard_exit();

        let event = SessionSlippageUpdated {
            user: caller,
            agent,
            maxSlippageBps: max_slippage_bps,
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
        data: Vec<u8>,
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

        // 2. Effects: update user ledger and bucket before external call
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
                data.into(),
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
        self.balances.setter(user).setter(token_out).set(cur_out_bal + received);

        self.reentrancy_guard_exit();

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

    pub fn session_slippage(&self, user: Address, agent: Address) -> U256 {
        self.session_slippages.getter(user).getter(agent).get()
    }
}