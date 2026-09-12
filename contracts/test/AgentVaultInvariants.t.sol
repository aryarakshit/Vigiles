// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../src/AgentVaultSolidityReference.sol";
import "../src/MockTokenizedStock.sol";
import "../src/MockSwapAdapter.sol";
import "../src/MockPriceFeed.sol";
import "../src/MockSequencerFeed.sol";

contract AgentVaultHandler is Test {
    AgentVaultSolidityReference public vault;
    MockTokenizedStock public aapl;
    MockTokenizedStock public tsla;
    MockSwapAdapter public adapter;
    MockPriceFeed public aaplFeed;
    MockPriceFeed public tslaFeed;

    address public alice;
    address public bob;
    address public agentBot;

    // Ghost variables
    uint256 public ghost_successfulTrades;
    uint256 public ghost_aliceDeposits;
    uint256 public ghost_aliceWithdrawals;
    uint256 public ghost_bobDeposits;
    uint256 public ghost_bobWithdrawals;

    constructor(
        AgentVaultSolidityReference _vault,
        MockTokenizedStock _aapl,
        MockTokenizedStock _tsla,
        MockSwapAdapter _adapter,
        MockPriceFeed _aaplFeed,
        MockPriceFeed _tslaFeed,
        address _alice,
        address _bob,
        address _agentBot
    ) {
        vault = _vault;
        aapl = _aapl;
        tsla = _tsla;
        adapter = _adapter;
        aaplFeed = _aaplFeed;
        tslaFeed = _tslaFeed;
        alice = _alice;
        bob = _bob;
        agentBot = _agentBot;
    }

    function depositAlice(uint256 amount) public {
        amount = bound(amount, 1 ether, 500 ether);
        aapl.mint(alice, amount);

        vm.startPrank(alice);
        aapl.approve(address(vault), amount);
        vault.depositErc20(address(aapl), amount);
        vm.stopPrank();

        ghost_aliceDeposits += amount;
    }

    function withdrawAlice(uint256 amount) public {
        uint256 bal = vault.getBalance(alice, address(aapl));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.prank(alice);
        vault.withdrawErc20(address(aapl), amount);
        ghost_aliceWithdrawals += amount;
    }

    function depositBob(uint256 amount) public {
        amount = bound(amount, 1 ether, 500 ether);
        aapl.mint(bob, amount);

        vm.startPrank(bob);
        aapl.approve(address(vault), amount);
        vault.depositErc20(address(aapl), amount);
        vm.stopPrank();

        ghost_bobDeposits += amount;
    }

    function withdrawBob(uint256 amount) public {
        uint256 bal = vault.getBalance(bob, address(aapl));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.prank(bob);
        vault.withdrawErc20(address(aapl), amount);
        ghost_bobWithdrawals += amount;
    }

    function executeAgentTrade(uint256 amountIn) public {
        uint256 bal = vault.getBalance(alice, address(aapl));
        (, uint256 perTradeCap, , uint256 available) = vault.getTokenPolicy(alice, agentBot, address(aapl));
        
        uint256 maxTrade = perTradeCap < available ? perTradeCap : available;
        if (maxTrade == 0 || bal == 0) return;
        if (maxTrade > bal) maxTrade = bal;

        amountIn = bound(amountIn, 1 ether, maxTrade);
        // Ensure feeds are fresh
        aaplFeed.setUpdatedAt(block.timestamp);
        tslaFeed.setUpdatedAt(block.timestamp);

        // Calculate minAmountOut with 5% slippage
        uint256 minOut = (amountIn * 95) / 100;
        if (minOut == 0) return;

        vm.prank(agentBot);
        try vault.executeTrade(
            alice,
            address(aapl),
            address(tsla),
            amountIn,
            minOut,
            address(adapter),
            keccak256("intent"),
            ""
        ) {
            ghost_successfulTrades++;
        } catch {}
    }

    function warpTime(uint256 secondsToWarp) public {
        secondsToWarp = bound(secondsToWarp, 60, 3600);
        vm.warp(block.timestamp + secondsToWarp);
        aaplFeed.setUpdatedAt(block.timestamp);
        tslaFeed.setUpdatedAt(block.timestamp);
    }
}

contract AgentVaultInvariantsTest is StdInvariant, Test {
    AgentVaultSolidityReference public vault;
    MockTokenizedStock public aapl;
    MockTokenizedStock public tsla;
    MockSwapAdapter public adapter;
    MockPriceFeed public aaplFeed;
    MockPriceFeed public tslaFeed;
    MockSequencerFeed public seqFeed;
    AgentVaultHandler public handler;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public agentBot = address(0xAA99);

    function setUp() public {
        vm.warp(100_000);
        vault = new AgentVaultSolidityReference();
        aapl = new MockTokenizedStock("Tokenized Apple", "AAPL");
        tsla = new MockTokenizedStock("Tokenized Tesla", "TSLA");
        adapter = new MockSwapAdapter();
        adapter.setReentrancyVault(address(vault));

        aaplFeed = new MockPriceFeed(8, 200e8, "AAPL / USD");
        tslaFeed = new MockPriceFeed(8, 200e8, "TSLA / USD");
        seqFeed = new MockSequencerFeed();

        vault.setPriceFeed(address(aapl), address(aaplFeed));
        vault.setPriceFeed(address(tsla), address(tslaFeed));
        vault.setSequencerFeed(address(seqFeed));

        // Alice initializes session key for agentBot
        address[] memory tokens = new address[](2);
        tokens[0] = address(aapl);
        tokens[1] = address(tsla);
        uint256[] memory perTradeCaps = new uint256[](2);
        perTradeCaps[0] = 500 ether;
        perTradeCaps[1] = 500 ether;
        uint256[] memory dailyCaps = new uint256[](2);
        dailyCaps[0] = 2000 ether;
        dailyCaps[1] = 2000 ether;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);

        vm.prank(alice);
        vault.createSessionKey(agentBot, block.timestamp + 30 days, tokens, perTradeCaps, dailyCaps, adapters);

        handler = new AgentVaultHandler(
            vault,
            aapl,
            tsla,
            adapter,
            aaplFeed,
            tslaFeed,
            alice,
            bob,
            agentBot
        );

        targetContract(address(handler));
    }

    // Invariant 1: Vault Solvency Invariant
    // Total vault balance of any token must always be >= sum of all user ledger balances
    function invariant_Solvency() public view {
        uint256 aaplVaultBal = aapl.balanceOf(address(vault));
        uint256 aaplLedgerSum = vault.getBalance(alice, address(aapl)) + vault.getBalance(bob, address(aapl));
        assertGe(aaplVaultBal, aaplLedgerSum, "Solvency violation: Vault AAPL balance < sum of ledgers");

        uint256 tslaVaultBal = tsla.balanceOf(address(vault));
        uint256 tslaLedgerSum = vault.getBalance(alice, address(tsla)) + vault.getBalance(bob, address(tsla));
        assertGe(tslaVaultBal, tslaLedgerSum, "Solvency violation: Vault TSLA balance < sum of ledgers");
    }

    // Invariant 2: User Isolation Invariant
    // Bob's ledger can only ever change via Bob's own actions
    function invariant_BobIsolation() public view {
        uint256 expectedBobAAPL = handler.ghost_bobDeposits() - handler.ghost_bobWithdrawals();
        assertEq(vault.getBalance(bob, address(aapl)), expectedBobAAPL, "Isolation violation: Bob AAPL ledger mutated unexpectedly");
        assertEq(vault.getBalance(bob, address(tsla)), 0, "Isolation violation: Bob TSLA ledger mutated unexpectedly");
    }

    // Invariant 3: Non-Vacuity Verification Test
    // Asserts that trades actually execute in the test suite and invariants are not vacuously passing
    function test_NonVacuityDeterministicCheck() public {
        handler.depositAlice(1000 ether);
        handler.executeAgentTrade(200 ether);
        assertGt(handler.ghost_successfulTrades(), 0, "Non-vacuity check failed: Zero trades executed!");

        // Invariant holds
        invariant_Solvency();
        invariant_BobIsolation();
    }
}