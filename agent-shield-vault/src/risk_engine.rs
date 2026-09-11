use alloy_primitives::U256;

pub const SECONDS_PER_DAY: U256 = U256::from_limbs([86400, 0, 0, 0]);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TokenRiskPolicy {
    pub allowed: bool,
    pub per_trade_cap: U256,
    pub daily_cap: U256,
    pub bucket: U256,
    pub bucket_ts: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRiskConfig {
    pub is_active: bool,
    pub expiry: U256,
    pub epoch: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeAuthorizationResult {
    pub new_bucket: U256,
    pub new_user_token_in_balance: U256,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TradeSettlementResult {
    pub refund: U256,
    pub new_user_token_in_balance: U256,
    pub new_user_token_out_balance: U256,
    pub new_bucket: U256,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RiskEngineError {
    SessionKeyInactive,
    SessionKeyExpired,
    TokenNotAllowed,
    AdapterNotAllowed,
    SpendLimitExceeded,
    DailyLimitExceeded,
    InsufficientBalance,
    OverSpent,
    InsufficientOutput,
    ZeroAmount,
}

pub struct RiskEngine;

impl RiskEngine {
    /// Calculate current available spend limit from the linear refill token bucket
    pub fn calc_available(
        daily_cap: U256,
        bucket: U256,
        bucket_ts: U256,
        current_time: U256,
    ) -> U256 {
        if daily_cap == U256::ZERO {
            return U256::ZERO;
        }
        if bucket_ts == U256::ZERO {
            return daily_cap;
        }
        if current_time <= bucket_ts {
            return bucket.min(daily_cap);
        }

        let elapsed = current_time - bucket_ts;
        // refill = (elapsed * daily_cap) / 86400
        let refill = (elapsed.saturating_mul(daily_cap)) / SECONDS_PER_DAY;
        let total = bucket.saturating_add(refill);
        total.min(daily_cap)
    }

    /// Authorize a trade execution against all risk limits (session, token, per-trade, daily bucket, solvency)
    #[allow(clippy::too_many_arguments)]
    pub fn authorize_trade(
        session: &SessionRiskConfig,
        adapter_allowed: bool,
        token_in_policy: &TokenRiskPolicy,
        token_out_policy: &TokenRiskPolicy,
        current_time: U256,
        amount_in: U256,
        min_amount_out: U256,
        user_token_in_balance: U256,
    ) -> Result<TradeAuthorizationResult, RiskEngineError> {
        if amount_in == U256::ZERO || min_amount_out == U256::ZERO {
            return Err(RiskEngineError::ZeroAmount);
        }

        // 1. Session Active Invariant
        if !session.is_active {
            return Err(RiskEngineError::SessionKeyInactive);
        }

        // 2. Session Expiry Invariant
        if current_time >= session.expiry {
            return Err(RiskEngineError::SessionKeyExpired);
        }

        // 3. Allowlisted Adapter Invariant
        if !adapter_allowed {
            return Err(RiskEngineError::AdapterNotAllowed);
        }

        // 4. Whitelisted Tokens Invariant
        if !token_in_policy.allowed || !token_out_policy.allowed {
            return Err(RiskEngineError::TokenNotAllowed);
        }

        // 5. Per-Trade Cap Invariant
        if amount_in > token_in_policy.per_trade_cap {
            return Err(RiskEngineError::SpendLimitExceeded);
        }

        // 6. Token Bucket Refill Invariant (Max Burst = Daily Cap)
        let available = Self::calc_available(
            token_in_policy.daily_cap,
            token_in_policy.bucket,
            token_in_policy.bucket_ts,
            current_time,
        );

        if amount_in > available {
            return Err(RiskEngineError::DailyLimitExceeded);
        }

        // 7. Solvency Invariant
        if user_token_in_balance < amount_in {
            return Err(RiskEngineError::InsufficientBalance);
        }

        let new_bucket = available - amount_in;
        let new_user_token_in_balance = user_token_in_balance - amount_in;

        Ok(TradeAuthorizationResult {
            new_bucket,
            new_user_token_in_balance,
        })
    }

    /// Settle a completed swap by measuring actual token differences and refunding unspent input
    #[allow(clippy::too_many_arguments)]
    pub fn settle_trade(
        amount_in: U256,
        spent: U256,
        received: U256,
        min_amount_out: U256,
        user_token_in_balance: U256,
        user_token_out_balance: U256,
        current_bucket: U256,
        daily_cap: U256,
    ) -> Result<TradeSettlementResult, RiskEngineError> {
        if spent > amount_in {
            return Err(RiskEngineError::OverSpent);
        }
        if received < min_amount_out {
            return Err(RiskEngineError::InsufficientOutput);
        }

        let refund = amount_in - spent;
        let new_user_token_in_balance = user_token_in_balance + refund;
        let new_user_token_out_balance = user_token_out_balance + received;
        let new_bucket = (current_bucket + refund).min(daily_cap);

        Ok(TradeSettlementResult {
            refund,
            new_user_token_in_balance,
            new_user_token_out_balance,
            new_bucket,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_session() -> SessionRiskConfig {
        SessionRiskConfig {
            is_active: true,
            expiry: U256::from(200_000),
            epoch: U256::from(1),
        }
    }

    fn sample_token_in() -> TokenRiskPolicy {
        TokenRiskPolicy {
            allowed: true,
            per_trade_cap: U256::from(500),
            daily_cap: U256::from(2000),
            bucket: U256::from(2000),
            bucket_ts: U256::from(100_000),
        }
    }

    fn sample_token_out() -> TokenRiskPolicy {
        TokenRiskPolicy {
            allowed: true,
            per_trade_cap: U256::from(500),
            daily_cap: U256::from(2000),
            bucket: U256::from(2000),
            bucket_ts: U256::from(100_000),
        }
    }

    #[test]
    fn test_valid_trade_authorization() {
        let session = sample_session();
        let token_in = sample_token_in();
        let token_out = sample_token_out();

        let res = RiskEngine::authorize_trade(
            &session,
            true, // adapter allowed
            &token_in,
            &token_out,
            U256::from(100_000),
            U256::from(400),
            U256::from(380),
            U256::from(1000),
        )
        .expect("Valid trade should be authorized");

        assert_eq!(res.new_bucket, U256::from(1600)); // 2000 - 400
        assert_eq!(res.new_user_token_in_balance, U256::from(600)); // 1000 - 400
    }

    #[test]
    fn test_linear_bucket_refill() {
        // Daily cap 2000, drained to 0 at t = 100_000
        let bucket = U256::ZERO;
        let daily_cap = U256::from(2000);
        let bucket_ts = U256::from(100_000);

        // 6 hours later (21600s) -> exactly 25% of 2000 = 500
        let avail_6h = RiskEngine::calc_available(daily_cap, bucket, bucket_ts, U256::from(100_000 + 21600));
        assert_eq!(avail_6h, U256::from(500));

        // 12 hours later (43200s) -> exactly 50% = 1000
        let avail_12h = RiskEngine::calc_available(daily_cap, bucket, bucket_ts, U256::from(100_000 + 43200));
        assert_eq!(avail_12h, U256::from(1000));

        // 24 hours later (86400s) -> 100% = 2000
        let avail_24h = RiskEngine::calc_available(daily_cap, bucket, bucket_ts, U256::from(100_000 + 86400));
        assert_eq!(avail_24h, U256::from(2000));

        // 48 hours later -> capped at daily_cap (2000), cannot burst 2x!
        let avail_48h = RiskEngine::calc_available(daily_cap, bucket, bucket_ts, U256::from(100_000 + 172800));
        assert_eq!(avail_48h, U256::from(2000));
    }

    #[test]
    fn test_trade_settlement_with_partial_fill_refund() {
        // Agent authorized 100, but adapter only spent 80 and produced 80 out
        let res = RiskEngine::settle_trade(
            U256::from(100), // amount_in
            U256::from(80),  // spent
            U256::from(80),  // received
            U256::from(75),  // min_amount_out
            U256::from(900), // user_in_bal (after deduct)
            U256::from(0),   // user_out_bal
            U256::from(1900),// current_bucket (after deduct)
            U256::from(2000),// daily_cap
        )
        .expect("Settlement should succeed");

        assert_eq!(res.refund, U256::from(20));
        assert_eq!(res.new_user_token_in_balance, U256::from(920)); // 900 + 20 refund
        assert_eq!(res.new_user_token_out_balance, U256::from(80));
        assert_eq!(res.new_bucket, U256::from(1920)); // 1900 + 20 refund
    }

    #[test]
    fn test_rejection_on_overspent_or_insufficient_output() {
        // Adapter tries to overspend (spent 120 > 100)
        let err1 = RiskEngine::settle_trade(
            U256::from(100),
            U256::from(120),
            U256::from(80),
            U256::from(75),
            U256::from(900),
            U256::from(0),
            U256::from(1900),
            U256::from(2000),
        );
        assert_eq!(err1, Err(RiskEngineError::OverSpent));

        // Adapter produces less than min_amount_out (received 50 < 75)
        let err2 = RiskEngine::settle_trade(
            U256::from(100),
            U256::from(100),
            U256::from(50),
            U256::from(75),
            U256::from(900),
            U256::from(0),
            U256::from(1900),
            U256::from(2000),
        );
        assert_eq!(err2, Err(RiskEngineError::InsufficientOutput));
    }

    #[test]
    fn test_unauthorized_adapter_rejected() {
        let session = sample_session();
        let token_in = sample_token_in();
        let token_out = sample_token_out();

        let err = RiskEngine::authorize_trade(
            &session,
            false, // adapter NOT allowed
            &token_in,
            &token_out,
            U256::from(100_000),
            U256::from(400),
            U256::from(380),
            U256::from(1000),
        );
        assert_eq!(err, Err(RiskEngineError::AdapterNotAllowed));
    }

    #[test]
    fn test_per_trade_cap_exceeded_rejected() {
        let session = sample_session();
        let token_in = sample_token_in(); // per_trade_cap is 500
        let token_out = sample_token_out();

        let err = RiskEngine::authorize_trade(
            &session,
            true,
            &token_in,
            &token_out,
            U256::from(100_000),
            U256::from(501), // exceeds 500
            U256::from(380),
            U256::from(1000),
        );
        assert_eq!(err, Err(RiskEngineError::SpendLimitExceeded));
    }
}