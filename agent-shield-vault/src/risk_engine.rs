extern crate alloc;

use alloy_primitives::U256;
use crate::{
    AgentVaultError, DailyLimitExceeded, InsufficientBalance, SafeMathError, SessionKeyExpired,
    SessionKeyInactive, SpendLimitExceeded, TokenNotAllowed,
};

pub const SECONDS_PER_DAY: U256 = U256::from_limbs([86400, 0, 0, 0]);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRiskParameters {
    pub is_active: bool,
    pub max_spend_limit: U256,
    pub daily_limit: U256,
    pub spent_today: U256,
    pub last_reset_timestamp: U256,
    pub expiry: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RiskValidationResult {
    pub new_spent_today: U256,
    pub new_last_reset_timestamp: U256,
    pub new_user_balance: U256,
}

pub struct RiskEngine;

impl RiskEngine {
    /// Validates all on-chain session key risk limits and computes new balance & spend state
    pub fn validate_and_compute_trade(
        params: &SessionRiskParameters,
        is_token_allowed: bool,
        current_time: U256,
        trade_amount: U256,
        user_balance: U256,
    ) -> Result<RiskValidationResult, AgentVaultError> {
        // 1. Session Active Invariant
        if !params.is_active {
            return Err(AgentVaultError::SessionKeyInactive(SessionKeyInactive {}));
        }

        // 2. Session Expiry Invariant
        if current_time >= params.expiry {
            return Err(AgentVaultError::SessionKeyExpired(SessionKeyExpired {}));
        }

        // 3. Token Whitelist Invariant
        if !is_token_allowed {
            return Err(AgentVaultError::TokenNotAllowed(TokenNotAllowed {}));
        }

        // 4. Per-transaction Max Spend Limit Invariant
        if trade_amount > params.max_spend_limit {
            return Err(AgentVaultError::SpendLimitExceeded(SpendLimitExceeded {}));
        }

        // 5. Daily Limit & Rolling 24-Hour Window Invariant
        let (current_spent, last_reset) = if current_time >= params.last_reset_timestamp + SECONDS_PER_DAY {
            // New 24h cycle has begun: reset accumulator
            (U256::ZERO, current_time)
        } else {
            (params.spent_today, params.last_reset_timestamp)
        };

        let new_spent_today = current_spent
            .checked_add(trade_amount)
            .ok_or(AgentVaultError::SafeMathError(SafeMathError {}))?;

        if params.daily_limit > U256::ZERO && new_spent_today > params.daily_limit {
            return Err(AgentVaultError::DailyLimitExceeded(DailyLimitExceeded {}));
        }

        // 6. Solvency / Vault Balance Invariant
        let new_user_balance = user_balance
            .checked_sub(trade_amount)
            .ok_or(AgentVaultError::InsufficientBalance(InsufficientBalance {}))?;

        Ok(RiskValidationResult {
            new_spent_today,
            new_last_reset_timestamp: last_reset,
            new_user_balance,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_params() -> SessionRiskParameters {
        SessionRiskParameters {
            is_active: true,
            max_spend_limit: U256::from(500),
            daily_limit: U256::from(2000),
            spent_today: U256::from(300),
            last_reset_timestamp: U256::from(100_000),
            expiry: U256::from(200_000),
        }
    }

    #[test]
    fn test_valid_trade_execution() {
        let params = sample_params();
        let result = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000), // Within same day
            U256::from(400),     // <= max_spend_limit (500)
            U256::from(1000),    // User has 1000 balance
        )
        .expect("Valid trade should succeed");

        assert_eq!(result.new_spent_today, U256::from(700)); // 300 + 400
        assert_eq!(result.new_last_reset_timestamp, U256::from(100_000));
        assert_eq!(result.new_user_balance, U256::from(600)); // 1000 - 400
    }

    #[test]
    fn test_inactive_session_rejected() {
        let mut params = sample_params();
        params.is_active = false;

        let err = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000),
            U256::from(100),
            U256::from(1000),
        );
        assert!(matches!(err, Err(AgentVaultError::SessionKeyInactive(_))));
    }

    #[test]
    fn test_expired_session_rejected() {
        let params = sample_params();

        // Exactly at expiry
        let err = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(200_000), // expiry is 200_000
            U256::from(100),
            U256::from(1000),
        );
        assert!(matches!(err, Err(AgentVaultError::SessionKeyExpired(_))));

        // Past expiry
        let err2 = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(200_001),
            U256::from(100),
            U256::from(1000),
        );
        assert!(matches!(err2, Err(AgentVaultError::SessionKeyExpired(_))));
    }

    #[test]
    fn test_non_whitelisted_token_rejected() {
        let params = sample_params();
        let err = RiskEngine::validate_and_compute_trade(
            &params,
            false, // Token is NOT allowed
            U256::from(105_000),
            U256::from(100),
            U256::from(1000),
        );
        assert!(matches!(err, Err(AgentVaultError::TokenNotAllowed(_))));
    }

    #[test]
    fn test_spend_limit_exceeded_rejected() {
        let params = sample_params(); // max_spend_limit = 500
        let err = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000),
            U256::from(501), // Exceeds 500
            U256::from(1000),
        );
        assert!(matches!(err, Err(AgentVaultError::SpendLimitExceeded(_))));
    }

    #[test]
    fn test_daily_limit_exceeded_rejected() {
        let mut params = sample_params();
        params.daily_limit = U256::from(500);
        params.spent_today = U256::from(400);

        let err = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000),
            U256::from(200), // 400 + 200 = 600 > daily_limit (500)
            U256::from(1000),
        );
        assert!(matches!(err, Err(AgentVaultError::DailyLimitExceeded(_))));
    }

    #[test]
    fn test_daily_limit_resets_after_24_hours() {
        let mut params = sample_params();
        params.daily_limit = U256::from(500);
        params.spent_today = U256::from(450); // Almost maxed out
        params.last_reset_timestamp = U256::from(100_000);

        // Advance time by 86400 seconds (24 hours)
        let current_time = U256::from(100_000 + 86400);

        let result = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            current_time,
            U256::from(400), // Would exceed if not reset, but now succeeds!
            U256::from(1000),
        )
        .expect("Should succeed because daily spent was reset");

        assert_eq!(result.new_spent_today, U256::from(400));
        assert_eq!(result.new_last_reset_timestamp, current_time);
        assert_eq!(result.new_user_balance, U256::from(600));
    }

    #[test]
    fn test_insufficient_vault_balance_rejected() {
        let params = sample_params();
        let err = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000),
            U256::from(400),
            U256::from(350), // User only has 350, trade wants 400
        );
        assert!(matches!(err, Err(AgentVaultError::InsufficientBalance(_))));
    }

    #[test]
    fn test_exact_limit_boundaries() {
        let mut params = sample_params();
        params.max_spend_limit = U256::from(500);
        params.daily_limit = U256::from(500);
        params.spent_today = U256::ZERO;

        // Exactly at max spend limit and daily limit
        let result = RiskEngine::validate_and_compute_trade(
            &params,
            true,
            U256::from(105_000),
            U256::from(500),
            U256::from(500),
        )
        .expect("Exact boundary trade should succeed");

        assert_eq!(result.new_spent_today, U256::from(500));
        assert_eq!(result.new_user_balance, U256::ZERO);
    }
}
