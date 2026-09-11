#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

pub mod risk_engine;

use alloc::vec::Vec;
use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolEvent};
use risk_engine::{RiskEngine, SessionRiskParameters};
use stylus_sdk::prelude::*;

sol_interface! {
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
    }
}

sol! {
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
}

#[derive(SolidityError)]
pub enum AgentVaultError {
    Unauthorized(Unauthorized),
    SessionKeyInactive(SessionKeyInactive),
    SessionKeyExpired(SessionKeyExpired),
    SpendLimitExceeded(SpendLimitExceeded),
    DailyLimitExceeded(DailyLimitExceeded),
    TokenNotAllowed(TokenNotAllowed),
    InsufficientBalance(InsufficientBalance),
    ZeroAddress(ZeroAddress),
    ZeroAmount(ZeroAmount),
    ReentrancyError(ReentrancyError),
    SafeMathError(SafeMathError),
    ExternalCallFailed(ExternalCallFailed),
}

impl From<alloc::vec::Vec<u8>> for AgentVaultError {
    fn from(_: alloc::vec::Vec<u8>) -> Self {
        AgentVaultError::ExternalCallFailed(ExternalCallFailed {})
    }
}

sol_storage! {
    pub struct SessionKeyConfig {
        bool is_active;
        uint256 max_spend_limit;
        uint256 daily_limit;
        uint256 spent_today;
        uint256 last_reset_timestamp;
        uint256 expiry;
        mapping(address => bool) allowed_tokens;
    }

    #[entrypoint]
    pub struct AgentVault {
        // user => token => balance (Address::ZERO for native ETH)
        mapping(address => mapping(address => uint256)) balances;
        // user => agent => SessionKeyConfig
        mapping(address => mapping(address => SessionKeyConfig)) session_keys;
        // Reentrancy guard state: 1 = NOT_ENTERED, 2 = ENTERED
        uint256 reentrancy_status;
    }
}

const NOT_ENTERED: U256 = U256::from_limbs([1, 0, 0, 0]);
const ENTERED: U256 = U256::from_limbs([2, 0, 0, 0]);

#[public]
impl AgentVault {
    /// Initialize reentrancy lock if uninitialized
    fn ensure_reentrancy_initialized(&mut self) {
        if self.reentrancy_status.get() == U256::ZERO {
            self.reentrancy_status.set(NOT_ENTERED);
        }
    }

    /// Internal reentrancy guard lock
    fn reentrancy_guard_enter(&mut self) -> Result<(), AgentVaultError> {
        self.ensure_reentrancy_initialized();
        if self.reentrancy_status.get() == ENTERED {
            return Err(AgentVaultError::ReentrancyError(ReentrancyError {}));
        }
        self.reentrancy_status.set(ENTERED);
        Ok(())
    }

    /// Internal reentrancy guard exit
    fn reentrancy_guard_exit(&mut self) {
        self.reentrancy_status.set(NOT_ENTERED);
    }

    /// Deposit native ETH into user's vault balance
    #[payable]
    pub fn deposit_eth(&mut self) -> Result<(), AgentVaultError> {
        let caller = self.vm().msg_sender();
        let value = self.vm().msg_value();

        if value == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        let user_bals = self.balances.getter(caller);
        let current_bal = user_bals.getter(Address::ZERO).get();
        let new_bal = current_bal
            .checked_add(value)
            .ok_or(AgentVaultError::SafeMathError(SafeMathError {}))?;

        let mut user_bals_setter = self.balances.setter(caller);
        user_bals_setter.setter(Address::ZERO).set(new_bal);

        let event = Deposit {
            user: caller,
            token: Address::ZERO,
            amount: value,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// Deposit ERC-20 Tokenized Stocks (e.g., AAPL, TSLA) into user's vault balance
    pub fn deposit_erc20(&mut self, token: Address, amount: U256) -> Result<(), AgentVaultError> {
        if token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if amount == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        let caller = self.vm().msg_sender();
        let vault = self.vm().contract_address();

        let cfg = Call::new_mutating(self);
        let erc20 = IERC20::new(token);
        erc20
            .transfer_from(self.vm(), cfg, caller, vault, amount)
            .map_err(|_| AgentVaultError::ExternalCallFailed(ExternalCallFailed {}))?;

        let user_bals = self.balances.getter(caller);
        let current_bal = user_bals.getter(token).get();
        let new_bal = current_bal
            .checked_add(amount)
            .ok_or(AgentVaultError::SafeMathError(SafeMathError {}))?;

        let mut user_bals_setter = self.balances.setter(caller);
        user_bals_setter.setter(token).set(new_bal);

        let event = Deposit {
            user: caller,
            token,
            amount,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// Withdraw native ETH from user's vault balance
    pub fn withdraw_eth(&mut self, amount: U256) -> Result<(), AgentVaultError> {
        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();

        if amount == U256::ZERO {
            self.reentrancy_guard_exit();
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        let current_bal = {
            let user_bals = self.balances.getter(caller);
            user_bals.getter(Address::ZERO).get()
        };
        let new_bal = current_bal
            .checked_sub(amount)
            .ok_or(AgentVaultError::InsufficientBalance(InsufficientBalance {}))?;

        // State update before external call
        {
            let mut user_bals = self.balances.setter(caller);
            user_bals.setter(Address::ZERO).set(new_bal);
        }

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

    /// Withdraw ERC-20 Tokenized Stocks from user's vault balance
    pub fn withdraw_erc20(&mut self, token: Address, amount: U256) -> Result<(), AgentVaultError> {
        if token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if amount == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        self.reentrancy_guard_enter()?;
        let caller = self.vm().msg_sender();

        let current_bal = {
            let user_bals = self.balances.getter(caller);
            user_bals.getter(token).get()
        };
        let new_bal = current_bal
            .checked_sub(amount)
            .ok_or(AgentVaultError::InsufficientBalance(InsufficientBalance {}))?;

        // State update before external call
        {
            let mut user_bals = self.balances.setter(caller);
            user_bals.setter(token).set(new_bal);
        }

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

    /// Create or update an AI Agent Session Key with strict risk parameters
    pub fn create_session_key(
        &mut self,
        agent: Address,
        max_spend_limit: U256,
        daily_limit: U256,
        expiry: U256,
        allowed_tokens_list: Vec<Address>,
    ) -> Result<(), AgentVaultError> {
        let caller = self.vm().msg_sender();

        if agent == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if max_spend_limit == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }
        let current_time = U256::from(self.vm().block_timestamp());
        if expiry <= current_time {
            return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
        }

        {
            let mut user_keys = self.session_keys.setter(caller);
            let mut key_setter = user_keys.setter(agent);
            key_setter.is_active.set(true);
            key_setter.max_spend_limit.set(max_spend_limit);
            key_setter.daily_limit.set(daily_limit);
            key_setter.spent_today.set(U256::ZERO);
            key_setter.last_reset_timestamp.set(current_time);
            key_setter.expiry.set(expiry);

            for token in allowed_tokens_list {
                key_setter.allowed_tokens.setter(token).set(true);
            }
        }

        let event = SessionKeyCreated {
            user: caller,
            agent,
            max_spend_limit,
            daily_limit,
            expiry,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// Whitelist or blacklist a token for an agent session key
    pub fn set_token_whitelist(
        &mut self,
        agent: Address,
        token: Address,
        allowed: bool,
    ) -> Result<(), AgentVaultError> {
        let caller = self.vm().msg_sender();
        if agent == Address::ZERO || token == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }

        {
            let mut user_keys = self.session_keys.setter(caller);
            let mut agent_key = user_keys.setter(agent);
            agent_key.allowed_tokens.setter(token).set(allowed);
        }

        let event = TokenWhitelistUpdated {
            user: caller,
            agent,
            token,
            allowed,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// Revoke an AI Agent Session Key immediately
    pub fn revoke_session_key(&mut self, agent: Address) -> Result<(), AgentVaultError> {
        let caller = self.vm().msg_sender();
        if agent == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }

        {
            let mut user_keys = self.session_keys.setter(caller);
            let mut agent_key = user_keys.setter(agent);
            agent_key.is_active.set(false);
        }

        let event = SessionKeyRevoked {
            user: caller,
            agent,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// The Core Function: Execute an on-chain trade on behalf of a user
    /// Called directly by the autonomous AI Agent within strict session boundaries
    pub fn execute_trade(
        &mut self,
        user: Address,
        token_address: Address,
        amount: U256,
        dex_router: Address,
        call_data: Vec<u8>,
    ) -> Result<(), AgentVaultError> {
        let agent = self.vm().msg_sender();

        if user == Address::ZERO || dex_router == Address::ZERO {
            return Err(AgentVaultError::ZeroAddress(ZeroAddress {}));
        }
        if amount == U256::ZERO {
            return Err(AgentVaultError::ZeroAmount(ZeroAmount {}));
        }

        self.reentrancy_guard_enter()?;

        let current_time = U256::from(self.vm().block_timestamp());

        // Read session parameters and validate via RiskEngine
        let (params, is_allowed, user_balance) = {
            let user_keys = self.session_keys.getter(user);
            let session_getter = user_keys.getter(agent);

            let params = SessionRiskParameters {
                is_active: session_getter.is_active.get(),
                max_spend_limit: session_getter.max_spend_limit.get(),
                daily_limit: session_getter.daily_limit.get(),
                spent_today: session_getter.spent_today.get(),
                last_reset_timestamp: session_getter.last_reset_timestamp.get(),
                expiry: session_getter.expiry.get(),
            };

            let is_allowed = session_getter.allowed_tokens.getter(token_address).get();
            let user_bals = self.balances.getter(user);
            let user_balance = user_bals.getter(token_address).get();

            (params, is_allowed, user_balance)
        };

        let risk_result = match RiskEngine::validate_and_compute_trade(
            &params,
            is_allowed,
            current_time,
            amount,
            user_balance,
        ) {
            Ok(res) => res,
            Err(e) => {
                self.reentrancy_guard_exit();
                return Err(e);
            }
        };

        // Update state BEFORE external calls (Checks-Effects-Interactions)
        {
            let mut user_bals = self.balances.setter(user);
            user_bals.setter(token_address).set(risk_result.new_user_balance);
        }
        {
            let mut user_keys = self.session_keys.setter(user);
            let mut agent_key = user_keys.setter(agent);
            agent_key.spent_today.set(risk_result.new_spent_today);
            agent_key.last_reset_timestamp.set(risk_result.new_last_reset_timestamp);
        }

        // Execute swap via DEX router
        let trade_result = if token_address == Address::ZERO {
            // Swap native ETH
            unsafe {
                stylus_sdk::call::RawCall::new_with_value(self.vm(), amount)
                    .call(dex_router, &call_data)
            }
        } else {
            // Approve token to DEX router, then call router
            let cfg = Call::new_mutating(self);
            let erc20 = IERC20::new(token_address);
            let approve_res = erc20.approve(
                self.vm(),
                cfg,
                dex_router,
                amount,
            );
            if approve_res.is_err() {
                self.reentrancy_guard_exit();
                return Err(AgentVaultError::ExternalCallFailed(ExternalCallFailed {}));
            }
            unsafe {
                stylus_sdk::call::RawCall::new(self.vm()).call(dex_router, &call_data)
            }
        };

        self.reentrancy_guard_exit();

        if trade_result.is_err() {
            return Err(AgentVaultError::ExternalCallFailed(ExternalCallFailed {}));
        }

        let event = TradeExecuted {
            user,
            agent,
            token_in: token_address,
            amount_in: amount,
            dex_router,
        };
        let log = event.encode_log_data();
        let _ = self.vm().raw_log(log.topics(), &log.data);

        Ok(())
    }

    /// Read user vault balance for a specific token (or Address::ZERO for ETH)
    pub fn get_balance(&self, user: Address, token: Address) -> U256 {
        let user_bals = self.balances.getter(user);
        user_bals.getter(token).get()
    }

    /// Check if a session key is currently active
    pub fn is_session_active(&self, user: Address, agent: Address) -> bool {
        let user_keys = self.session_keys.getter(user);
        let key = user_keys.getter(agent);
        if !key.is_active.get() {
            return false;
        }
        let current_time = U256::from(self.vm().block_timestamp());
        current_time < key.expiry.get()
    }

    /// Check if a token is whitelisted for an agent session key
    pub fn is_token_allowed(&self, user: Address, agent: Address, token: Address) -> bool {
        let user_keys = self.session_keys.getter(user);
        let key = user_keys.getter(agent);
        key.allowed_tokens.getter(token).get()
    }

    /// Retrieve full session key risk limit parameters
    pub fn get_session_limits(
        &self,
        user: Address,
        agent: Address,
    ) -> (bool, U256, U256, U256, U256, U256) {
        let user_keys = self.session_keys.getter(user);
        let key = user_keys.getter(agent);
        (
            key.is_active.get(),
            key.max_spend_limit.get(),
            key.daily_limit.get(),
            key.spent_today.get(),
            key.last_reset_timestamp.get(),
            key.expiry.get(),
        )
    }
}
