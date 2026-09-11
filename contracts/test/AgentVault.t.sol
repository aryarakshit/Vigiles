// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentVaultSolidityReference.sol";
import "../src/MockTokenizedStock.sol";
import "../src/MockSwapAdapter.sol";
import "../src/MockPriceFeed.sol";
import "../src/MockSequencerFeed.sol";

contract AgentVaultTest is Test {
    AgentVaultSolidityReference public vault;
    MockTokenizedStock public aapl;
    MockTokenizedStock public tsla;
    MockTokenizedStock public nvda;
    MockSwapAdapter public adapter;
    MockPriceFeed public aaplFeed;
    MockPriceFeed public tslaFeed;
    MockSequencerFeed public seqFeed;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public agentBot = address(0xAA99);
    address public maliciousBot = address(0x666);

    uint256 public constant INITIAL_BALANCE = 10_000 ether;
    uint256 public constant PER_TRADE_CAP = 500 ether;
    uint256 public constant DAILY_CAP = 2000 ether;
    uint256 public defaultExpiry;

    function setUp() public {
        vm.warp(100_000);
        vault = new AgentVaultSolidityReference();
        aapl = new MockTokenizedStock("Tokenized Apple", "AAPL");
        tsla = new MockTokenizedStock("Tokenized Tesla", "TSLA");
        nvda = new MockTokenizedStock("Tokenized Nvidia", "NVDA");
        adapter = new MockSwapAdapter();
        adapter.setReentrancyVault(address(vault));

        // Feeds: AAPL = $200 (8 decimals), TSLA = $200 (8 decimals)
        aaplFeed = new MockPriceFeed(8, 200e8, "AAPL / USD");
        tslaFeed = new MockPriceFeed(8, 200e8, "TSLA / USD");
        seqFeed = new MockSequencerFeed();

        vault.setPriceFeed(address(aapl), address(aaplFeed));
        vault.setPriceFeed(address(tsla), address(tslaFeed));
        vault.setSequencerFeed(address(seqFeed));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        aapl.mint(alice, INITIAL_BALANCE);
        tsla.mint(alice, INITIAL_BALANCE);
        nvda.mint(alice, INITIAL_BALANCE);

        aapl.mint(bob, INITIAL_BALANCE);
        tsla.mint(bob, INITIAL_BALANCE);

        defaultExpiry = block.timestamp + 7 days;

        // Alice registers Session Key for agentBot
        vm.startPrank(alice);
        aapl.approve(address(vault), type(uint256).max);
        tsla.approve(address(vault), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = address(aapl);
        tokens[1] = address(tsla);

        uint256[] memory perTradeCaps = new uint256[](2);
        perTradeCaps[0] = PER_TRADE_CAP;
        perTradeCaps[1] = PER_TRADE_CAP;

        uint256[] memory dailyCaps = new uint256[](2);
        dailyCaps[0] = DAILY_CAP;
        dailyCaps[1] = DAILY_CAP;

        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);

        vault.createSessionKey(agentBot, defaultExpiry, tokens, perTradeCaps, dailyCaps, adapters);
        vm.stopPrank();
    }

    // --- 1. Deposit & Withdraw Tests ---

    function test_DepositAndWithdrawETH() public {
        vm.startPrank(alice);
        vault.depositEth{value: 10 ether}();
        assertEq(vault.getBalance(alice, address(0)), 10 ether);

        vault.withdrawEth(4 ether);
        assertEq(vault.getBalance(alice, address(0)), 6 ether);
        assertEq(alice.balance, 94 ether);
        vm.stopPrank();
    }

    function test_DepositAndWithdrawERC20TokenizedStock() public {
        vm.startPrank(alice);
        vault.depositErc20(address(aapl), 1000 ether);
        assertEq(vault.getBalance(alice, address(aapl)), 1000 ether);

        vault.withdrawErc20(address(aapl), 300 ether);
        assertEq(vault.getBalance(alice, address(aapl)), 700 ether);
        assertEq(aapl.balanceOf(alice), INITIAL_BALANCE - 700 ether);
        vm.stopPrank();
    }

    // --- 2. Session Key Configuration & Epoch Tests ---

    function test_CreateSessionKey() public view {
        (bool isActive, uint256 expiry, uint256 epoch) = vault.getSession(alice, agentBot);
        assertTrue(isActive);
        assertEq(expiry, defaultExpiry);
        assertEq(epoch, 1);

        (bool allowed, uint256 perTrade, uint256 daily, uint256 avail) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        assertTrue(allowed);
        assertEq(perTrade, PER_TRADE_CAP);
        assertEq(daily, DAILY_CAP);
        assertEq(avail, DAILY_CAP);

        assertTrue(vault.isAdapterAllowed(alice, agentBot, address(adapter)));
        assertFalse(vault.isAdapterAllowed(alice, agentBot, address(0x999)));
    }

    function test_RevokeSessionKeyWipesAccess() public {
        vm.prank(alice);
        vault.revokeSessionKey(agentBot);

        (bool isActive, , uint256 epoch) = vault.getSession(alice, agentBot);
        assertFalse(isActive);
        assertEq(epoch, 2);

        // Trade must revert
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SessionKeyInactive.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_RecreatingSessionKeyWipesOldWhitelistViaEpoch() public {
        vm.startPrank(alice);
        // Revoke key
        vault.revokeSessionKey(agentBot);

        // Recreate key with ONLY tsla allowed (aapl omitted)
        address[] memory tokens = new address[](1);
        tokens[0] = address(tsla);
        uint256[] memory perTradeCaps = new uint256[](1);
        perTradeCaps[0] = PER_TRADE_CAP;
        uint256[] memory dailyCaps = new uint256[](1);
        dailyCaps[0] = DAILY_CAP;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);

        vault.createSessionKey(agentBot, defaultExpiry + 1 days, tokens, perTradeCaps, dailyCaps, adapters);
        vm.stopPrank();

        // Check that AAPL is NO LONGER allowed in the new epoch
        (bool aaplAllowed, , , ) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        assertFalse(aaplAllowed);

        // TSLA is allowed
        (bool tslaAllowed, , , ) = vault.getTokenPolicy(alice, agentBot, address(tsla));
        assertTrue(tslaAllowed);
    }

    function test_CannotAllowlistTokenAsAdapter() public {
        vm.startPrank(alice);
        // Attempt to add AAPL (a token) as an adapter
        vm.expectRevert(IAgentVault.InvalidAdapter.selector);
        vault.setAdapter(agentBot, address(aapl), true);

        // Attempt to add adapter as a token
        vm.expectRevert(IAgentVault.InvalidToken.selector);
        vault.setTokenPolicy(agentBot, address(adapter), true, 100 ether, 500 ether);
        vm.stopPrank();
    }

    // --- 3. Linear Token Bucket Refill Tests ---

    function test_LinearRefillAfterDraining() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 3000 ether);

        // Drain DAILY_CAP (2000 ether) in 4 trades of 500 ether
        vm.startPrank(agentBot);
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");

        // Bucket is now 0
        (, , , uint256 avail0) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        assertEq(avail0, 0);

        // Warp 6 hours (21600 seconds) -> exactly 25% refill of 2000 = 500 ether
        vm.warp(block.timestamp + 21600);
        aaplFeed.setUpdatedAt(block.timestamp);
        tslaFeed.setUpdatedAt(block.timestamp);

        (, , , uint256 avail6h) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        assertEq(avail6h, 500 ether);

        // Can execute 1 trade of 500 ether
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");

        // Now bucket is 0 again, cannot execute another immediate trade
        vm.expectRevert(IAgentVault.DailyLimitExceeded.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 1 ether, 1 ether, address(adapter), "");
        vm.stopPrank();
    }

    // --- 4. Core Trade Execution & Solvency Tests ---

    function test_ExecuteTrade_Success_CreditsUserAndClearsAllowance() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        vm.prank(agentBot);
        uint256 received = vault.executeTrade(
            alice,
            address(aapl),
            address(tsla),
            400 ether,
            380 ether,
            address(adapter),
            ""
        );

        assertEq(received, 400 ether);
        assertEq(vault.getBalance(alice, address(aapl)), 600 ether);
        assertEq(vault.getBalance(alice, address(tsla)), 400 ether);

        // Verify allowance to adapter is completely reset to 0
        assertEq(aapl.allowance(address(vault), address(adapter)), 0);
    }

    function test_ExecuteTrade_RevertsOnInactiveAgent() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        vm.prank(maliciousBot);
        vm.expectRevert(IAgentVault.SessionKeyInactive.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_ExecuteTrade_RevertsOnExpiredSession() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        vm.warp(defaultExpiry + 1);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SessionKeyExpired.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_ExecuteTrade_RevertsOnNonWhitelistedTokenOut() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // NVDA is not whitelisted
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.TokenNotAllowed.selector);
        vault.executeTrade(alice, address(aapl), address(nvda), 100 ether, 95 ether, address(adapter), "");
    }

    function test_ExecuteTrade_RevertsOnPerTradeCapExceeded() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // Cap is 500 ether; agent tries 501 ether
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SpendLimitExceeded.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 501 ether, 490 ether, address(adapter), "");
    }

    // --- 5. Hostile Adapter Tests ---

    function test_HostileAdapter_Thief_FailsAndLedgerUnchanged() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        adapter.setMode(MockSwapAdapter.BehaviorMode.Thief);
        adapter.setThiefRecipient(address(0xDEAD));

        vm.prank(agentBot);
        // InsufficientOutput because vault received 0 output!
        vm.expectRevert(IAgentVault.InsufficientOutput.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");

        // Alice balances remain completely untouched
        assertEq(vault.getBalance(alice, address(aapl)), 1000 ether);
        assertEq(vault.getBalance(alice, address(tsla)), 0);
    }

    function test_HostileAdapter_Greedy_Reverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        adapter.setMode(MockSwapAdapter.BehaviorMode.Greedy);

        vm.prank(agentBot);
        // Greedy tries to pull 2x amountIn -> reverts on allowance or OverSpent
        vm.expectRevert();
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_HostileAdapter_Reentrant_Reverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        adapter.setMode(MockSwapAdapter.BehaviorMode.Reentrant);

        vm.prank(agentBot);
        // Reentrancy detected during adapter callback -> ReentrancyError
        vm.expectRevert(IAgentVault.ReentrancyError.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_HostileAdapter_PartialFill_RefundsUnspentInputAndBucket() public {
        vm.startPrank(alice);
        vault.depositErc20(address(aapl), 1000 ether);
        vault.setSessionSlippage(agentBot, 3000); // 30% slippage tolerance for partial fill
        vm.stopPrank();

        adapter.setMode(MockSwapAdapter.BehaviorMode.PartialFill);
        adapter.setPartialFillBps(8000); // Only 80% spent (80 ether of 100 ether)

        vm.prank(agentBot);
        uint256 received = vault.executeTrade(
            alice,
            address(aapl),
            address(tsla),
            100 ether,
            75 ether,
            address(adapter),
            ""
        );

        assertEq(received, 80 ether);
        // Alice spent 80 AAPL, so has 920 AAPL left (1000 - 100 + 20 refund)
        assertEq(vault.getBalance(alice, address(aapl)), 920 ether);
        assertEq(vault.getBalance(alice, address(tsla)), 80 ether);

        // Bucket should be DAILY_CAP - 80 ether (1920 ether)
        (, , , uint256 avail) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        assertEq(avail, DAILY_CAP - 80 ether);
    }

    function test_HostileAdapter_Stingy_Reverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        adapter.setMode(MockSwapAdapter.BehaviorMode.Stingy);

        vm.prank(agentBot);
        // Stingy returns dust (1 wei) < minAmountOut -> InsufficientOutput
        vm.expectRevert(IAgentVault.InsufficientOutput.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    // --- 6. v1 Exploit Regressions ---

    function test_ExploitRegression_AdapterCannotBeTokenContract() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // Setting adapter = aapl token must revert in setAdapter
        vm.prank(alice);
        vm.expectRevert(IAgentVault.InvalidAdapter.selector);
        vault.setAdapter(agentBot, address(aapl), true);

        // Calling trade with unapproved adapter reverts with AdapterNotAllowed
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.AdapterNotAllowed.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(aapl), "");

        assertEq(aapl.balanceOf(address(vault)), 1000 ether);
    }

    function test_ExploitRegression_StealingNonWhitelistedTokenFails() public {
        vm.prank(alice);
        nvda.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.depositErc20(address(nvda), 1000 ether);

        // Agent tries to trade NVDA (not whitelisted)
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.TokenNotAllowed.selector);
        vault.executeTrade(alice, address(nvda), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_ExploitRegression_DoubleSpendAt24hWindowEdgeFails() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 4000 ether);

        // Max out daily cap (2000 ether) at t0
        vm.startPrank(agentBot);
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");

        // Warp to t0 + 86399 (1 second before 24h)
        vm.warp(block.timestamp + 86399);
        aaplFeed.setUpdatedAt(block.timestamp);
        tslaFeed.setUpdatedAt(block.timestamp);

        // In v2 (token bucket), at t0+86399 it has refilled ~1999.97 ether.
        // If agent tries to burst 2000 + 500, it cannot exceed the linear available limit!
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 500 ether, 490 ether, address(adapter), "");
        vault.executeTrade(alice, address(aapl), address(tsla), 499 ether, 490 ether, address(adapter), "");

        // Cannot trade again without more time elapsed
        vm.expectRevert(IAgentVault.DailyLimitExceeded.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
        vm.stopPrank();
    }

    // --- 7. Oracle Guard Tests ---

    function test_OracleGuard_StaleFeedReverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // Make AAPL feed older than maxStaleness (3600 seconds)
        aaplFeed.setUpdatedAt(block.timestamp - 3601);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.StalePriceFeed.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_OracleGuard_SequencerDownReverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // Sequencer reported down (status = 1)
        seqFeed.setStatus(1, block.timestamp);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SequencerDown.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_OracleGuard_SequencerGracePeriodReverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // Sequencer came back up (status = 0), but started only 10 minutes ago (< 1h grace period)
        seqFeed.setStatus(0, block.timestamp - 600);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.GracePeriodNotOver.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 95 ether, address(adapter), "");
    }

    function test_OracleGuard_MinAmountOutBelowFloorReverts() public {
        vm.prank(alice);
        vault.depositErc20(address(aapl), 1000 ether);

        // AAPL = $200, TSLA = $200. Expected out for 100 AAPL is 100 TSLA.
        // Default max slippage is 5% (500 bps), floor is 95 TSLA.
        // If agent specifies minAmountOut = 90 TSLA (< 95 floor), it must revert!
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SlippageExceeded.selector);
        vault.executeTrade(alice, address(aapl), address(tsla), 100 ether, 90 ether, address(adapter), "");
    }
}