// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IPerpOrderbook {
    event OrderCreated(
        uint256 id,
        address maker,
        address taker,
        uint256 downPayment,
        bool isLong,
        address makerToken,
        address takerToken,
        uint256 makerAmount,
        uint256 takerAmount,
        uint256 expiration,
        uint256 fee
    );

    event OrderCancelled(uint256 id);

    event OrderExecuted(uint256 id, address taker);

    /// @dev Defines a Limit Order
    /// @param id The unique identifier of the order
    /// @param maker The address of the trader who created the order
    /// @param taker The address of the taken, address(0) if everyone can take the order
    /// @param downPayment The initial down payment amount required to open the position (is in `makerToken` for long, `takerToken` for short positions)
    /// @param isLong True if the order is for a long position, false if it is for a short position
    /// @param makerToken The address of the token to be paid for the position
    /// @param takerToken The address of the token to be received for the position
    /// @param makerAmount The amount of `makerToken` to be paid for the position
    /// @param takerAmount The amount of `takerToken` to be received for the position
    /// @param expiration The timestamp of the expiration of the order
    /// @param fee The total fees to be paid for the order
    struct LimitOrder {  // CLOSE 1 ETH x3 LONG PAC
        uint256 id;
        address maker;
        address taker; // if it SL taker is US(WASABI) else addressZero
        uint256 downPayment; // 0 ETH
        bool isLong; // maybe we can use pool address
        address makerToken; // PAC
        address takerToken; //WETH
        uint256 makerAmount; // 9000 PAC
        uint256 takerAmount; // 3 ETH
        uint256 expiration;
        uint256 fee; // 0.001 ETH
    }

    /// @dev Defines a position
    /// @param id The unique identifier for the position.
    /// @param trader The address of the trader who opened the position.
    /// @param currency The address of the currency to be paid for the position.
    /// @param collateralCurrency The address of the currency to be received for the position.
    /// @param lastFundingTimestamp The timestamp of the last funding payment.
    /// @param downPayment The initial down payment amount required to open the position (is in `currency` for long, `collateralCurrency` for short positions)
    /// @param principal The total principal amount to be borrowed for the position (is in `currency`)
    /// @param collateralAmount The total collateral amount to be received for the position (is in `collateralCurrency`)
    /// @param feesToBePaid The total fees to be paid for the position (is in `currency`)
    struct Position {
        uint256 id;
        address trader;
        address currency;
        address collateralCurrency;
        uint256 lastFundingTimestamp;
        uint256 downPayment;
        uint256 principal;
        uint256 collateralAmount;
        uint256 feesToBePaid;
    }

    struct CreateCloseOrderRequest {
        Position position;
        address taker;
        bool isLong;
        uint256 expiration;
    }

    /// @dev Defines a signature
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @dev Defines the request structure for cancelling an order
    /// @param id The unique identifier of the order
    struct CancelOrderRequest {
        uint256 id;
    }

    /// @dev Defines the request structure for executing an order
    /// @param id The unique identifier of the order
    struct ExecuteOrderRequest {
        uint256 id;
    }

    /// @dev Creates a new order
    /// @param _request The request to create an order
    /// @param _signature the signature of the request
    function createOpenOrder(
        LimitOrder calldata _request,
        Signature calldata _signature
    ) external payable;

    /// @dev Creates a new order
    /// @param _request The request to create an order
    /// @param _signature the signature of the request
    function createCloseOrder(
        CreateCloseOrderRequest calldata _request,
        Signature calldata _signature
    ) external payable;

    /// @dev Cancels an existing order
    /// @param _request The request to cancel an order
    function cancelOrder(CancelOrderRequest calldata _request) external;

    /// @dev Executes an existing order
    /// @param _request The request to execute an order
    function executeOrder(
        ExecuteOrderRequest calldata _request
    ) external payable;
}
