// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/AgentVaultSolidityReference.sol";
import "../src/MockTokenizedStock.sol";
import "../src/MockDEXRouter.sol";

contract ReentrantAttacker {
    AgentVaultSolidityReference public vault;
    address public user;
    address public token;
    address public router;

    constructor(address _vault) {
        vault = AgentVaultSolidityReference(_vault);
    }

    function setParams(address _user, address _token, address _router) external {
        user = _user;
        token = _token;
        router = _router;
    }

    fallback() external payable {
        // Attempt reentrant trade execution
        if (msg.sender == address(vault)) {
            vault.execute_trade(user, token, 10, router, "");
        }
    }

    receive() external payable {}
}

contract AgentVaultTest is Test {
    AgentVaultSolidityReference public vault;
    MockTokenizedStock public aapl;
    MockTokenizedStock public tsla;
    MockTokenizedStock public nvda;
    MockDEXRouter public router;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public agentBot = address(0xAA99);
    address public maliciousBot = address(0x666);

    uint256 public constant INITIAL_BALANCE = 10_000 ether;
    uint256 public constant MAX_SPEND_LIMIT = 500 ether;
    uint256 public constant DAILY_LIMIT = 2000 ether;
    uint256 public defaultExpiry;

    function setUp() public {
        vault = new AgentVaultSolidityReference();
        aapl = new MockTokenizedStock("Tokenized Apple", "AAPL");
        tsla = new MockTokenizedStock("Tokenized Tesla", "TSLA");
        nvda = new MockTokenizedStock("Tokenized Nvidia", "NVDA");
        router = new MockDEXRouter();

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        aapl.mint(alice, INITIAL_BALANCE);
        tsla.mint(alice, INITIAL_BALANCE);
        nvda.mint(alice, INITIAL_BALANCE);

        defaultExpiry = block.timestamp + 7 days;

        // Alice registers Session Key for agentBot
        vm.startPrank(alice);
        aapl.approve(address(vault), type(uint256).max);
        tsla.approve(address(vault), type(uint256).max);

        address[] memory allowed = new address[](2);
        allowed[0] = address(aapl);
        allowed[1] = address(tsla);

        vault.create_session_key(agentBot, MAX_SPEND_LIMIT, DAILY_LIMIT, defaultExpiry, allowed);
        vm.stopPrank();
    }

    // --- 1. Deposit & Withdraw Tests ---

    function test_DepositAndWithdrawETH() public {
        vm.startPrank(alice);
        vault.deposit_eth{value: 10 ether}();
        assertEq(vault.get_balance(alice, address(0)), 10 ether);

        vault.withdraw_eth(4 ether);
        assertEq(vault.get_balance(alice, address(0)), 6 ether);
        vm.stopPrank();
    }

    function test_DepositAndWithdrawERC20TokenizedStock() public {
        vm.startPrank(alice);
        vault.deposit_erc20(address(aapl), 1000 ether);
        assertEq(vault.get_balance(alice, address(aapl)), 1000 ether);

        vault.withdraw_erc20(address(aapl), 300 ether);
        assertEq(vault.get_balance(alice, address(aapl)), 700 ether);
        assertEq(aapl.balanceOf(alice), INITIAL_BALANCE - 700 ether);
        vm.stopPrank();
    }

    // --- 2. Session Key Configuration Tests ---

    function test_CreateSessionKey() public view {
        (
            bool isActive,
            uint256 maxSpend,
            uint256 dailyLimit,
            uint256 spentToday,
            uint256 lastReset,
            uint256 expiry
        ) = vault.get_session_limits(alice, agentBot);

        assertTrue(isActive);
        assertEq(maxSpend, MAX_SPEND_LIMIT);
        assertEq(dailyLimit, DAILY_LIMIT);
        assertEq(spentToday, 0);
        assertEq(lastReset, block.timestamp);
        assertEq(expiry, defaultExpiry);

        assertTrue(vault.is_token_allowed(alice, agentBot, address(aapl)));
        assertTrue(vault.is_token_allowed(alice, agentBot, address(tsla)));
        assertFalse(vault.is_token_allowed(alice, agentBot, address(nvda)));
    }

    function test_RevokeSessionKey() public {
        vm.prank(alice);
        vault.revoke_session_key(agentBot);

        assertFalse(vault.is_session_active(alice, agentBot));

        // Attempt trade after revocation
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SessionKeyInactive.selector);
        vault.execute_trade(alice, address(aapl), 100 ether, address(router), "");
    }

    // --- 3. Core Trade Execution Tests ---

    function test_ExecuteTrade_Success() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 1000 ether);

        // Agent executes trade within limits
        bytes memory swapCalldata = abi.encodeWithSelector(
            MockDEXRouter.swapTokens.selector,
            address(aapl),
            400 ether,
            address(0),
            1 ether
        );

        vm.prank(agentBot);
        vault.execute_trade(alice, address(aapl), 400 ether, address(router), swapCalldata);

        assertEq(vault.get_balance(alice, address(aapl)), 600 ether);

        (, , , uint256 spentToday, , ) = vault.get_session_limits(alice, agentBot);
        assertEq(spentToday, 400 ether);
    }

    function test_ExecuteTrade_RevertUnauthorizedAgent() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 1000 ether);

        // Unauthorized bot tries to trade
        vm.prank(maliciousBot);
        vm.expectRevert(IAgentVault.SessionKeyInactive.selector);
        vault.execute_trade(alice, address(aapl), 100 ether, address(router), "");
    }

    function test_ExecuteTrade_RevertExpiredSession() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 1000 ether);

        // Fast-forward past expiry (7 days + 1 second)
        vm.warp(defaultExpiry + 1);

        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SessionKeyExpired.selector);
        vault.execute_trade(alice, address(aapl), 100 ether, address(router), "");
    }

    function test_ExecuteTrade_RevertNonWhitelistedToken() public {
        vm.startPrank(alice);
        nvda.approve(address(vault), type(uint256).max);
        vault.deposit_erc20(address(nvda), 1000 ether);
        vm.stopPrank();

        // Agent tries to trade NVDA (not in whitelist)
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.TokenNotAllowed.selector);
        vault.execute_trade(alice, address(nvda), 100 ether, address(router), "");
    }

    function test_ExecuteTrade_RevertSpendLimitExceeded() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 2000 ether);

        // Trade amount: 501 ether (limit is 500 ether)
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.SpendLimitExceeded.selector);
        vault.execute_trade(alice, address(aapl), 501 ether, address(router), "");
    }

    function test_ExecuteTrade_RevertDailyLimitExceeded() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 3000 ether);

        vm.startPrank(agentBot);
        // Execute 4 trades of 500 ether = 2000 ether (hits daily limit)
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");

        // 5th trade exceeds daily limit
        vm.expectRevert(IAgentVault.DailyLimitExceeded.selector);
        vault.execute_trade(alice, address(aapl), 100 ether, address(router), "");
        vm.stopPrank();
    }

    function test_ExecuteTrade_DailyLimitResetsAfter24Hours() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 3000 ether);

        vm.startPrank(agentBot);
        // Max out daily limit today
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");
        vault.execute_trade(alice, address(aapl), 500 ether, address(router), "");

        // Warp 24 hours + 1 second into the next day
        vm.warp(block.timestamp + 86401);

        // Trade now succeeds because rolling 24-hour limit has reset!
        vault.execute_trade(alice, address(aapl), 400 ether, address(router), "");
        vm.stopPrank();

        (, , , uint256 spentToday, , ) = vault.get_session_limits(alice, agentBot);
        assertEq(spentToday, 400 ether);
    }

    function test_ExecuteTrade_RevertInsufficientVaultBalance() public {
        vm.prank(alice);
        vault.deposit_erc20(address(aapl), 200 ether); // User only deposited 200

        // Agent tries to trade 300 ether
        vm.prank(agentBot);
        vm.expectRevert(IAgentVault.InsufficientBalance.selector);
        vault.execute_trade(alice, address(aapl), 300 ether, address(router), "");
    }
}
