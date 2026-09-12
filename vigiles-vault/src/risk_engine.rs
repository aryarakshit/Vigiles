use alloy_primitives::U256;

pub const SECONDS_PER_DAY: U256 = U256::from_limbs([86400, 0, 0, 0]);
/// Seconds in one hour, used by the rolling velocity window.
pub const SECONDS_PER_HOUR: u64 = 3600;
/// Seconds in one UTC day, used by the trading-window clock.
pub const SECONDS_PER_DAY_U64: u64 = 86_400;

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

/// Session-level guardrails that are independent of any single token policy.
/// All fields use `0` to mean "disabled" so an un-configured session behaves
/// exactly like Vigiles v2.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionGuards {
    /// Seconds since UTC midnight when the agent may start trading.
    pub window_start: u32,
    /// Seconds since UTC midnight when the agent must stop. `== window_start` disables.
    pub window_end: u32,
    /// Bitmask of allowed weekdays, bit 0 = Sunday .. bit 6 = Saturday. `0` = every day.
    pub weekday_mask: u8,
    /// Max trades in any rolling 3600s window. `0` = unlimited.
    pub max_trades_per_hour: u32,
    /// Max seconds between user heartbeats before the agent freezes. `0` = disabled.
    pub heartbeat_interval: u64,
}

/// Mutable counters that the guardrails update on every successful trade.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionCounters {
    pub last_heartbeat: u64,
    pub hour_window_start: u64,
    pub hour_trade_count: u32,
    pub trade_nonce: u64,
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
    OutsideTradingWindow,
    VelocityLimitExceeded,
    HeartbeatMissed,
    PositionCapExceeded,
    MissingIntent,
}

/// Divide a U256 by a small u64 using limb-wise long division.
///
/// The general `U256 / U256` routine from `ruint` costs ~4.4 KB of WASM; the
/// vault only ever divides by the constant `SECONDS_PER_DAY`, so this schoolbook
/// version keeps the binary under the Stylus size limit.
pub fn div_by_u64(x: U256, d: u64) -> U256 {
    debug_assert!(d != 0);
    let limbs = x.as_limbs();
    let mut out = [0u64; 4];
    let mut rem: u128 = 0;
    let d128 = d as u128;
    let mut i = 4;
    while i > 0 {
        i -= 1;
        let cur = (rem << 64) | limbs[i] as u128;
        out[i] = (cur / d128) as u64;
        rem = cur % d128;
    }
    U256::from_limbs(out)
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
        let refill = div_by_u64(elapsed.saturating_mul(daily_cap), SECONDS_PER_DAY_U64);
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

    // ---------------------------------------------------------------------
    // v3 Session Guardrails (pure, VM-free)
    // ---------------------------------------------------------------------

    /// Day of week for a unix timestamp, 0 = Sunday .. 6 = Saturday.
    /// 1970-01-01 was a Thursday (index 4).
    pub fn weekday(now: u64) -> u8 {
        ((now / SECONDS_PER_DAY_U64 + 4) % 7) as u8
    }

    /// Seconds elapsed since the most recent UTC midnight.
    pub fn seconds_of_day(now: u64) -> u32 {
        (now % SECONDS_PER_DAY_U64) as u32
    }

    /// Trading-window guard. Returns `true` when the agent is allowed to trade at `now`.
    ///
    /// * `window_start == window_end` disables the time-of-day check.
    /// * `window_start > window_end` is a window that wraps past midnight.
    /// * `weekday_mask == 0` disables the weekday check.
    pub fn is_within_trading_window(now: u64, guards: &SessionGuards) -> bool {
        if guards.weekday_mask != 0 {
            let bit = 1u8 << Self::weekday(now);
            if guards.weekday_mask & bit == 0 {
                return false;
            }
        }
        if guards.window_start == guards.window_end {
            return true;
        }
        let sod = Self::seconds_of_day(now);
        if guards.window_start < guards.window_end {
            sod >= guards.window_start && sod < guards.window_end
        } else {
            sod >= guards.window_start || sod < guards.window_end
        }
    }

    /// Velocity guard. Returns the updated `(hour_window_start, hour_trade_count)`
    /// after admitting one more trade, or an error if the rolling-hour budget is spent.
    pub fn check_velocity(
        now: u64,
        guards: &SessionGuards,
        counters: &SessionCounters,
    ) -> Result<(u64, u32), RiskEngineError> {
        if guards.max_trades_per_hour == 0 {
            return Ok((counters.hour_window_start, counters.hour_trade_count));
        }
        let (window_start, count) =
            if now.saturating_sub(counters.hour_window_start) >= SECONDS_PER_HOUR {
                (now, 0u32)
            } else {
                (counters.hour_window_start, counters.hour_trade_count)
            };
        if count >= guards.max_trades_per_hour {
            return Err(RiskEngineError::VelocityLimitExceeded);
        }
        Ok((window_start, count + 1))
    }

    /// Dead-man guard. Returns `true` when the user has checked in recently enough.
    /// A session with `heartbeat_interval == 0` never freezes.
    pub fn is_heartbeat_alive(now: u64, guards: &SessionGuards, counters: &SessionCounters) -> bool {
        if guards.heartbeat_interval == 0 {
            return true;
        }
        now.saturating_sub(counters.last_heartbeat) <= guards.heartbeat_interval
    }

    /// Position-cap guard. `max_position == 0` disables the check.
    pub fn is_within_position_cap(current_balance: U256, received: U256, max_position: U256) -> bool {
        if max_position == U256::ZERO {
            return true;
        }
        current_balance.saturating_add(received) <= max_position
    }

    /// Runs every session-level guard in order and returns the updated counters
    /// to persist if the trade is admitted.
    pub fn authorize_session_guards(
        now: u64,
        guards: &SessionGuards,
        counters: &SessionCounters,
        intent_hash_is_zero: bool,
    ) -> Result<SessionCounters, RiskEngineError> {
        if intent_hash_is_zero {
            return Err(RiskEngineError::MissingIntent);
        }
        if !Self::is_heartbeat_alive(now, guards, counters) {
            return Err(RiskEngineError::HeartbeatMissed);
        }
        if !Self::is_within_trading_window(now, guards) {
            return Err(RiskEngineError::OutsideTradingWindow);
        }
        let (hour_window_start, hour_trade_count) = Self::check_velocity(now, guards, counters)?;
        Ok(SessionCounters {
            last_heartbeat: counters.last_heartbeat,
            hour_window_start,
            hour_trade_count,
            trade_nonce: counters.trade_nonce + 1,
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
    fn test_div_by_u64_matches_reference_division() {
        let cases = [
            U256::ZERO,
            U256::from(1u64),
            U256::from(86_399u64),
            U256::from(86_400u64),
            U256::from(u64::MAX),
            U256::from(u128::MAX),
            U256::MAX,
            U256::from_limbs([0x1234_5678_9abc_def0, 0xfeed_face_cafe_beef, 0x0123_4567_89ab_cdef, 0x7fff_ffff_ffff_ffff]),
        ];
        for x in cases {
            assert_eq!(div_by_u64(x, 86_400), x / U256::from(86_400u64), "x = {x}");
            assert_eq!(div_by_u64(x, 1), x);
            assert_eq!(div_by_u64(x, u64::MAX), x / U256::from(u64::MAX));
        }
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

    // ---------------- v3 guardrail tests ----------------

    /// 2024-01-01 00:00:00 UTC was a Monday.
    const MONDAY_MIDNIGHT: u64 = 1_704_067_200;

    fn nyse_guards() -> SessionGuards {
        SessionGuards {
            window_start: 13 * 3600 + 30 * 60, // 13:30 UTC (09:30 ET during EDT)
            window_end: 20 * 3600,             // 20:00 UTC (16:00 ET)
            weekday_mask: 0b0011_1110,          // Mon..Fri (bits 1..5)
            max_trades_per_hour: 3,
            heartbeat_interval: 86_400,
        }
    }

    #[test]
    fn test_weekday_calc() {
        assert_eq!(RiskEngine::weekday(0), 4); // 1970-01-01 Thursday
        assert_eq!(RiskEngine::weekday(MONDAY_MIDNIGHT), 1);
        assert_eq!(RiskEngine::weekday(MONDAY_MIDNIGHT + 5 * 86_400), 6); // Saturday
        assert_eq!(RiskEngine::weekday(MONDAY_MIDNIGHT + 6 * 86_400), 0); // Sunday
    }

    #[test]
    fn test_trading_window_inside_hours() {
        let g = nyse_guards();
        let monday_1400_utc = MONDAY_MIDNIGHT + 14 * 3600;
        assert!(RiskEngine::is_within_trading_window(monday_1400_utc, &g));
    }

    #[test]
    fn test_trading_window_outside_hours_rejected() {
        let g = nyse_guards();
        let monday_0300_utc = MONDAY_MIDNIGHT + 3 * 3600;
        assert!(!RiskEngine::is_within_trading_window(monday_0300_utc, &g));
        // Exactly at close is exclusive
        let monday_2000_utc = MONDAY_MIDNIGHT + 20 * 3600;
        assert!(!RiskEngine::is_within_trading_window(monday_2000_utc, &g));
    }

    #[test]
    fn test_trading_window_weekend_rejected() {
        let g = nyse_guards();
        let saturday_1400_utc = MONDAY_MIDNIGHT + 5 * 86_400 + 14 * 3600;
        assert!(!RiskEngine::is_within_trading_window(saturday_1400_utc, &g));
    }

    #[test]
    fn test_trading_window_wraps_midnight() {
        let g = SessionGuards {
            window_start: 22 * 3600,
            window_end: 2 * 3600,
            ..Default::default()
        };
        assert!(RiskEngine::is_within_trading_window(MONDAY_MIDNIGHT + 23 * 3600, &g));
        assert!(RiskEngine::is_within_trading_window(MONDAY_MIDNIGHT + 3600, &g));
        assert!(!RiskEngine::is_within_trading_window(MONDAY_MIDNIGHT + 12 * 3600, &g));
    }

    #[test]
    fn test_trading_window_disabled_by_default() {
        let g = SessionGuards::default();
        assert!(RiskEngine::is_within_trading_window(MONDAY_MIDNIGHT + 3 * 3600, &g));
        assert!(RiskEngine::is_within_trading_window(MONDAY_MIDNIGHT + 6 * 86_400, &g));
    }

    #[test]
    fn test_velocity_limit_blocks_fourth_trade_in_hour() {
        let g = nyse_guards(); // max 3 / hour
        let mut c = SessionCounters { hour_window_start: 1_000, ..Default::default() };
        for expected in 1..=3u32 {
            let (ws, cnt) = RiskEngine::check_velocity(1_100, &g, &c).expect("admit");
            c.hour_window_start = ws;
            c.hour_trade_count = cnt;
            assert_eq!(cnt, expected);
        }
        assert_eq!(
            RiskEngine::check_velocity(1_200, &g, &c),
            Err(RiskEngineError::VelocityLimitExceeded)
        );
    }

    #[test]
    fn test_velocity_window_resets_after_hour() {
        let g = nyse_guards();
        let c = SessionCounters { hour_window_start: 1_000, hour_trade_count: 3, ..Default::default() };
        let (ws, cnt) = RiskEngine::check_velocity(1_000 + 3600, &g, &c).expect("new window");
        assert_eq!(ws, 4_600);
        assert_eq!(cnt, 1);
    }

    #[test]
    fn test_heartbeat_missed_freezes_agent() {
        let g = nyse_guards(); // 24h interval
        let c = SessionCounters { last_heartbeat: 100_000, ..Default::default() };
        assert!(RiskEngine::is_heartbeat_alive(100_000 + 86_400, &g, &c));
        assert!(!RiskEngine::is_heartbeat_alive(100_000 + 86_401, &g, &c));
    }

    #[test]
    fn test_position_cap() {
        let cap = U256::from(1_000);
        assert!(RiskEngine::is_within_position_cap(U256::from(900), U256::from(100), cap));
        assert!(!RiskEngine::is_within_position_cap(U256::from(900), U256::from(101), cap));
        assert!(RiskEngine::is_within_position_cap(U256::MAX, U256::MAX, U256::ZERO)); // disabled
    }

    #[test]
    fn test_authorize_session_guards_full_path() {
        let g = nyse_guards();
        let c = SessionCounters {
            last_heartbeat: MONDAY_MIDNIGHT,
            hour_window_start: MONDAY_MIDNIGHT,
            hour_trade_count: 0,
            trade_nonce: 7,
        };
        let now = MONDAY_MIDNIGHT + 14 * 3600;

        let next = RiskEngine::authorize_session_guards(now, &g, &c, false).expect("admitted");
        assert_eq!(next.trade_nonce, 8);
        assert_eq!(next.hour_window_start, now); // hour rolled over
        assert_eq!(next.hour_trade_count, 1);

        assert_eq!(
            RiskEngine::authorize_session_guards(now, &g, &c, true),
            Err(RiskEngineError::MissingIntent)
        );
    }
}
