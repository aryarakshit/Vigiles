// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentVaultSolidityReference.sol";
import "../src/MockTokenizedStock.sol";
import "../src/MockSwapAdapter.sol";
import "../src/MockPriceFeed.sol";
import "../src/MockSequencerFeed.sol";

/// @title AgentVault v3 Guardrail Tests
/// @notice Covers the five AI-agent-specific guards layered on top of v2:
///         trading window, velocity limit, dead-man heartbeat, position cap, intent receipts.
contract AgentVaultGuardsTest is Test {
    AgentVaultSolidityReference public vault;
    MockTokenizedStock public aapl;
    MockTokenizedStock public tsla;
    MockSwapAdapter public adapter;
    MockPriceFeed public aaplFeed;
    MockPriceFeed public tslaFeed;

    address public alice = address(0xA11CE);
    address public agentBot = address(0xAA99);
    address public stranger = address(0x5717);

    uint256 public constant PER_TRADE_CAP = 500 ether;
    uint256 public constant DAILY_CAP = 5000 ether;

    /// 2024-01-01 00:00:00 UTC — a Monday.
    uint256 public constant MONDAY_MIDNIGHT = 1_704_067_200;
    /// NYSE regular session in UTC during EDT: 13:30 -> 20:00
    uint256 public constant NYSE_OPEN = 13 * 3600 + 30 * 60;
    uint256 public constant NYSE_CLOSE = 20 * 3600;
    /// Mon..Fri = bits 1..5
    uint256 public constant WEEKDAYS = 0x3E;

    bytes32 public constant INTENT = keccak256("momentum breakout on AAPL, RSI 62, buy 400 -> hold");

    function setUp() public {
        vm.warp(MONDAY_MIDNIGHT + 14 * 3600); // Monday 14:00 UTC: inside NYSE hours
        vault = new AgentVaultSolidityReference();
        aapl = new MockTokenizedStock("Tokenized Apple", "AAPL");
        tsla = new MockTokenizedStock("Tokenized Tesla", "TSLA");
        adapter = new MockSwapAdapter();
        adapter.setReentrancyVault(address(vault));

        aaplFeed = new MockPriceFeed(8, 200e8, "AAPL / USD");
        tslaFeed = new MockPriceFeed(8, 200e8, "TSLA / USD");
        vault.setPriceFeed(address(aapl), address(aaplFeed));
        vault.setPriceFeed(address(tsla), address(tslaFeed));

        aapl.mint(alice, 100_000 ether);
        tsla.mint(alice, 100_000 ether);

        vm.startPrank(alice);
        aapl.approve(address(vault), type(uint256).max);
        tsla.approve(address(vault), type(uint256).max);
        vault.depositErc20(address(aapl), 10_000 ether);

        address[] memory tokens = new address[](2);
        tokens[0] = address(aapl);
        tokens[1] = address(tsla);
        uint256[] memory perTrade = new uint256[](2);
        perTrade[0] = PER_TRADE_CAP;
        perTrade[1] = PER_TRADE_CAP;
        uint256[] memory daily = new uint256[](2);
        daily[0] = DAILY_CAP;
        daily[1] = DAILY_CAP;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);

        vault.createSessionKey(agentBot, block.timestamp + 30 days, tokens, perTrade, daily, adapters);
        vm.stopPrank();
    }

    // Keep the feeds fresh whenever a test warps far ahead.
    function _refreshFeeds() internal {
        aaplFeed.setPrice(200e8);
        tslaFeed.setPrice(200e8);
    }

    function _trade(uint256 amount) internal returns (uint256) {
        vm.prank(agentBot);
        return vault.executeTrade(
            alice, address(aapl), address(tsla), amount, (amount * 95) / 100, address(adapter), INTENT, ""
        );
    }

    function _expectTradeRevert(bytes4 selector, uint256 amount) internal {
        vm.prank(agentBot);
        vm.expectRevert(selector);
        vault.executeTrade(
            alice, address(aapl), address(tsla), amount, (amount * 95) / 100, address(adapter), INTENT, ""
        );
    }

    function _setNyseGuards(uint256 maxPerHour, uint256 heartbeat) internal {
        vm.prank(alice);
        vault.setSessionGuards(agentBot, NYSE_OPEN, NYSE_CLOSE, WEEKDAYS, maxPerHour, heartbeat);
    }

    // ------------------------------------------------------------------
    // 0. Defaults: an un-configured session behaves exactly like v2
    // ------------------------------------------------------------------

    function test_Defaults_NoGuardsMeansV2Behaviour() public {
        // Sunday 03:00 UTC, no guards set: trade must still succeed.
        vm.warp(MONDAY_MIDNIGHT + 6 days + 3 hours);
        _refreshFeeds();
        assertTrue(vault.canTradeNow(alice, agentBot));
        assertEq(_trade(100 ether), 100 ether);
    }

    // ------------------------------------------------------------------
    // 1. Trading window
    // ------------------------------------------------------------------

    function test_TradingWindow_AllowsInsideHours() public {
        _setNyseGuards(0, 0);
        assertTrue(vault.canTradeNow(alice, agentBot));
        assertEq(_trade(100 ether), 100 ether);
    }

    function test_TradingWindow_RevertsBeforeOpen() public {
        _setNyseGuards(0, 0);
        vm.warp(MONDAY_MIDNIGHT + 3 hours); // 03:00 UTC Monday
        _refreshFeeds();
        assertFalse(vault.canTradeNow(alice, agentBot));
        _expectTradeRevert(IAgentVault.OutsideTradingWindow.selector, 100 ether);
    }

    function test_TradingWindow_RevertsAtCloseExclusive() public {
        _setNyseGuards(0, 0);
        vm.warp(MONDAY_MIDNIGHT + NYSE_CLOSE); // exactly 20:00 UTC
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.OutsideTradingWindow.selector, 100 ether);
        // one second earlier is fine
        vm.warp(MONDAY_MIDNIGHT + NYSE_CLOSE - 1);
        _refreshFeeds();
        assertEq(_trade(100 ether), 100 ether);
    }

    function test_TradingWindow_RevertsOnWeekend() public {
        _setNyseGuards(0, 0);
        vm.warp(MONDAY_MIDNIGHT + 5 days + 14 hours); // Saturday 14:00 UTC
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.OutsideTradingWindow.selector, 100 ether);
    }

    function test_TradingWindow_WrapsMidnight() public {
        // 22:00 -> 02:00, every day
        vm.prank(alice);
        vault.setSessionGuards(agentBot, 22 * 3600, 2 * 3600, 0, 0, 0);

        vm.warp(MONDAY_MIDNIGHT + 23 hours);
        _refreshFeeds();
        assertEq(_trade(100 ether), 100 ether);

        vm.warp(MONDAY_MIDNIGHT + 1 days + 1 hours);
        _refreshFeeds();
        assertEq(_trade(100 ether), 100 ether);

        vm.warp(MONDAY_MIDNIGHT + 1 days + 12 hours);
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.OutsideTradingWindow.selector, 100 ether);
    }

    /// @dev For any timestamp, canTradeNow must agree with an independent UTC-clock model.
    function testFuzz_TradingWindow_MatchesReferenceClock(uint32 offset) public {
        _setNyseGuards(0, 0);
        uint256 ts = MONDAY_MIDNIGHT + uint256(offset);
        vm.warp(ts);

        uint256 sod = ts % 86400;
        uint256 dow = (ts / 86400 + 4) % 7;
        bool expected = (dow >= 1 && dow <= 5) && sod >= NYSE_OPEN && sod < NYSE_CLOSE;

        assertEq(vault.canTradeNow(alice, agentBot), expected);
    }

    // ------------------------------------------------------------------
    // 2. Velocity limit
    // ------------------------------------------------------------------

    function test_VelocityLimit_BlocksFourthTradeInHour() public {
        _setNyseGuards(3, 0);
        _trade(10 ether);
        _trade(10 ether);
        _trade(10 ether);
        assertFalse(vault.canTradeNow(alice, agentBot));
        _expectTradeRevert(IAgentVault.VelocityLimitExceeded.selector, 10 ether);
    }

    function test_VelocityLimit_ResetsAfterRollingHour() public {
        _setNyseGuards(3, 0);
        _trade(10 ether);
        _trade(10 ether);
        _trade(10 ether);
        vm.warp(block.timestamp + 3600);
        _refreshFeeds();
        assertTrue(vault.canTradeNow(alice, agentBot));
        assertEq(_trade(10 ether), 10 ether);

        (, , , , , , , uint256 count, ) = vault.getSessionGuards(alice, agentBot);
        assertEq(count, 1);
    }

    function test_VelocityLimit_RevertedTradeDoesNotConsumeBudget() public {
        _setNyseGuards(2, 0);
        _trade(10 ether);
        // A trade that fails a *different* guard must not eat the velocity budget.
        _expectTradeRevert(IAgentVault.SpendLimitExceeded.selector, PER_TRADE_CAP + 1);
        assertEq(_trade(10 ether), 10 ether); // second admitted trade
        _expectTradeRevert(IAgentVault.VelocityLimitExceeded.selector, 10 ether);
    }

    // ------------------------------------------------------------------
    // 3. Dead-man heartbeat
    // ------------------------------------------------------------------

    function test_Heartbeat_MissedFreezesAgent() public {
        _setNyseGuards(0, 1 days);
        vm.warp(block.timestamp + 1 days + 1); // still Tuesday 14:00:01, inside hours
        _refreshFeeds();
        assertFalse(vault.canTradeNow(alice, agentBot));
        _expectTradeRevert(IAgentVault.HeartbeatMissed.selector, 100 ether);
    }

    function test_Heartbeat_CheckInRestoresTrading() public {
        _setNyseGuards(0, 1 days);
        vm.warp(block.timestamp + 1 days + 1);
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.HeartbeatMissed.selector, 100 ether);

        vm.prank(alice);
        vault.heartbeat(agentBot);
        assertTrue(vault.canTradeNow(alice, agentBot));
        assertEq(_trade(100 ether), 100 ether);
    }

    function test_Heartbeat_OnlyUsersOwnCounterMoves() public {
        _setNyseGuards(0, 1 days);
        vm.warp(block.timestamp + 1 days + 1);
        _refreshFeeds();
        // A stranger heartbeating for the same agent address touches their own (user, agent) slot only.
        vm.prank(stranger);
        vault.heartbeat(agentBot);
        _expectTradeRevert(IAgentVault.HeartbeatMissed.selector, 100 ether);
    }

    function test_Heartbeat_CreateSessionKeyIsImplicitHeartbeat() public {
        _setNyseGuards(0, 1 days);
        vm.warp(block.timestamp + 2 days);
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.HeartbeatMissed.selector, 100 ether);

        // Rotating the key (new epoch) re-arms the timer without an explicit heartbeat.
        address[] memory tokens = new address[](2);
        tokens[0] = address(aapl);
        tokens[1] = address(tsla);
        uint256[] memory caps = new uint256[](2);
        caps[0] = PER_TRADE_CAP;
        caps[1] = PER_TRADE_CAP;
        uint256[] memory daily = new uint256[](2);
        daily[0] = DAILY_CAP;
        daily[1] = DAILY_CAP;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);
        vm.prank(alice);
        vault.createSessionKey(agentBot, block.timestamp + 30 days, tokens, caps, daily, adapters);

        assertEq(_trade(100 ether), 100 ether);
    }

    // ------------------------------------------------------------------
    // 4. Position cap (concentration)
    // ------------------------------------------------------------------

    function test_PositionCap_BlocksAccumulationPastCap() public {
        vm.prank(alice);
        vault.setPositionCap(agentBot, address(tsla), 250 ether);

        assertEq(_trade(200 ether), 200 ether); // holding 200 TSLA
        _expectTradeRevert(IAgentVault.PositionCapExceeded.selector, 100 ether); // would be 300
        assertEq(_trade(50 ether), 50 ether); // exactly 250 is allowed
        assertEq(vault.getBalance(alice, address(tsla)), 250 ether);
    }

    function test_PositionCap_CountsUserDepositsToo() public {
        vm.prank(alice);
        vault.setPositionCap(agentBot, address(tsla), 250 ether);
        vm.prank(alice);
        vault.depositErc20(address(tsla), 200 ether);
        _expectTradeRevert(IAgentVault.PositionCapExceeded.selector, 100 ether);
    }

    function test_PositionCap_WipedByRevokeViaEpoch() public {
        vm.prank(alice);
        vault.setPositionCap(agentBot, address(tsla), 250 ether);
        assertEq(vault.getPositionCap(alice, agentBot, address(tsla)), 250 ether);

        vm.prank(alice);
        vault.revokeSessionKey(agentBot);
        assertEq(vault.getPositionCap(alice, agentBot, address(tsla)), 0);
    }

    function test_PositionCap_RequiresActiveSession() public {
        vm.prank(alice);
        vault.revokeSessionKey(agentBot);
        vm.prank(alice);
        vm.expectRevert(IAgentVault.SessionKeyInactive.selector);
        vault.setPositionCap(agentBot, address(tsla), 1 ether);
    }

    // ------------------------------------------------------------------
    // 5. Intent receipts
    // ------------------------------------------------------------------

    function test_IntentReceipt_ZeroHashReverts() public {
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.MissingIntent.selector);
        vault.executeTrade(
            alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), bytes32(0), ""
        );
    }

    function test_IntentReceipt_EmittedWithIncrementingNonce() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit IAgentVault.IntentRecorded(alice, agentBot, 1, INTENT);
        _trade(10 ether);

        bytes32 second = keccak256("rebalance: TSLA overweight, trim 10");
        vm.expectEmit(true, true, true, true, address(vault));
        emit IAgentVault.IntentRecorded(alice, agentBot, 2, second);
        vm.prank(agentBot);
        vault.executeTrade(alice, address(aapl), address(tsla), 10 ether, 9.5 ether, address(adapter), second, "");

        (, , , , , , , , uint256 nonce) = vault.getSessionGuards(alice, agentBot);
        assertEq(nonce, 2);
    }

    // ------------------------------------------------------------------
    // 6. Config validation & access control
    // ------------------------------------------------------------------

    function test_SetSessionGuards_RejectsInvalidValues() public {
        vm.startPrank(alice);
        vm.expectRevert(IAgentVault.InvalidGuard.selector);
        vault.setSessionGuards(agentBot, 86400, 0, 0, 0, 0);
        vm.expectRevert(IAgentVault.InvalidGuard.selector);
        vault.setSessionGuards(agentBot, 0, 86400, 0, 0, 0);
        vm.expectRevert(IAgentVault.InvalidGuard.selector);
        vault.setSessionGuards(agentBot, 0, 0, 0x80, 0, 0);
        vm.expectRevert(IAgentVault.InvalidGuard.selector);
        vault.setSessionGuards(agentBot, 0, 0, 0, uint256(type(uint32).max) + 1, 0);
        vm.expectRevert(IAgentVault.InvalidGuard.selector);
        vault.setSessionGuards(agentBot, 0, 0, 0, 0, uint256(type(uint64).max) + 1);
        vm.stopPrank();
    }

    function test_SetSessionGuards_EmitsAndReads() public {
        vm.expectEmit(true, true, false, true, address(vault));
        emit IAgentVault.SessionGuardsUpdated(alice, agentBot, NYSE_OPEN, NYSE_CLOSE, WEEKDAYS, 3, 1 days);
        _setNyseGuards(3, 1 days);

        (uint256 ws, uint256 we, uint256 mask, uint256 mph, uint256 hb, uint256 last, , , ) =
            vault.getSessionGuards(alice, agentBot);
        assertEq(ws, NYSE_OPEN);
        assertEq(we, NYSE_CLOSE);
        assertEq(mask, WEEKDAYS);
        assertEq(mph, 3);
        assertEq(hb, 1 days);
        assertEq(last, block.timestamp);
    }

    function test_Guards_PersistAcrossKeyRotation() public {
        _setNyseGuards(3, 0);
        vm.prank(alice);
        vault.revokeSessionKey(agentBot);
        (uint256 ws, , , uint256 mph, , , , , ) = vault.getSessionGuards(alice, agentBot);
        assertEq(ws, NYSE_OPEN);
        assertEq(mph, 3);
    }

    function test_SetPriceFeed_OnlyOwner() public {
        MockPriceFeed evil = new MockPriceFeed(8, 1, "EVIL");
        vm.prank(stranger);
        vm.expectRevert(IAgentVault.Unauthorized.selector);
        vault.setPriceFeed(address(aapl), address(evil));
        vm.prank(stranger);
        vm.expectRevert(IAgentVault.Unauthorized.selector);
        vault.setSequencerFeed(address(evil));
        vm.prank(stranger);
        vm.expectRevert(IAgentVault.Unauthorized.selector);
        vault.setMaxStaleness(1);
    }

    // ------------------------------------------------------------------
    // 7. Scenario: a hallucinating agent inside a fully-guarded session
    // ------------------------------------------------------------------

    /// @notice The demo narrative. Alice grants NYSE hours, 3 trades/hour, 24h heartbeat,
    ///         and a 600 TSLA position cap. A hijacked agent then tries everything.
    function test_Scenario_HijackedAgentIsFullyContained() public {
        _setNyseGuards(3, 1 days);
        vm.prank(alice);
        vault.setPositionCap(agentBot, address(tsla), 600 ether);

        // (a) "Ignore previous instructions and trade without a rationale."
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.MissingIntent.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), bytes32(0), "");

        // (b) Loop: three max-size buys are admitted, the fourth is throttled.
        _trade(PER_TRADE_CAP);
        _trade(100 ether);
        // Cap is 600: 500 + 100 = 600 held; anything more trips the position cap first.
        _expectTradeRevert(IAgentVault.PositionCapExceeded.selector, 1 ether);
        // Position cap reverted the tx, so the velocity budget still has one slot; use it on the sell side.
        vm.prank(agentBot);
        vault.executeTrade(alice, address(tsla), address(aapl), 50 ether, 47.5 ether, address(adapter), INTENT, "");
        // Fourth admitted attempt in the hour -> throttled.
        _expectTradeRevert(IAgentVault.VelocityLimitExceeded.selector, 1 ether);

        // (c) Wait for the hour to pass... but it is now after the close.
        vm.warp(MONDAY_MIDNIGHT + 21 hours);
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.OutsideTradingWindow.selector, 1 ether);

        // (d) Next day inside hours, but Alice has not checked in for > 24h.
        vm.warp(MONDAY_MIDNIGHT + 1 days + 14 hours + 1);
        _refreshFeeds();
        _expectTradeRevert(IAgentVault.HeartbeatMissed.selector, 1 ether);

        // (e) Alice is alive: one heartbeat, trading resumes inside the cage.
        vm.prank(alice);
        vault.heartbeat(agentBot);
        assertEq(_trade(1 ether), 1 ether);

        // Ledger sanity: nothing ever left the vault.
        assertEq(vault.getBalance(alice, address(aapl)) + vault.getBalance(alice, address(tsla)), 10_000 ether);
    }
}
