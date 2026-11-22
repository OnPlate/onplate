// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

/// Creates chunk contracts for the caller, then returns any ETH the caller attached.
/// Gas is paid by the caller in the normal way. Attaching ETH is optional.
/// The page chooses how many pieces fit in one block. A group is all-or-nothing:
/// if the next create would leave too little gas for the refund, the whole call reverts.
/// `maker` records the wallet that paid for each piece. The factory checks that
/// at registration, so another account cannot register those addresses.
contract ChunkBatch {
    error Empty();
    error CreateFailed();
    error RefundFailed();
    error Busy();

    event PieceCreated(address indexed payer, uint256 indexed which, address indexed chunk);
    event Refunded(address indexed payer, uint256 amount);

    /// Init code longer than this is refused. A full piece is well under it.
    uint256 internal constant CODE_MAX = 32000;
    /// Stop before a create if the refund would have no gas left.
    uint256 internal constant RESERVE = 150000;

    /// The account that sent the createPieces call that deployed this chunk.
    mapping(address => address) public maker;

    bool private transient entered;

    function createPieces(bytes[] calldata initCodes) external payable returns (address[] memory created) {
        uint256 n = initCodes.length;
        uint256 i;
        if (entered) revert Busy();
        entered = true;
        if (n == 0) revert Empty();
        created = new address[](n);
        for (i = 0; i < n; i++) {
            bytes calldata init = initCodes[i];
            address chunk;
            if (gasleft() < RESERVE) revert CreateFailed();
            if (init.length == 0 || init.length > CODE_MAX) revert CreateFailed();
            chunk = _create(init);
            if (chunk == address(0) || !_isStop(chunk)) revert CreateFailed();
            if (maker[chunk] != address(0)) revert CreateFailed();
            maker[chunk] = msg.sender;
            created[i] = chunk;
            emit PieceCreated(msg.sender, i, chunk);
        }
        _refund();
        entered = false;
    }

    function _create(bytes calldata init) private returns (address chunk) {
        assembly {
            let ptr := mload(0x40)
            let len := init.length
            let rounded := and(add(len, 31), not(31))
            mstore(0x40, add(ptr, rounded))
            calldatacopy(ptr, init.offset, len)
            chunk := create(0, ptr, len)
        }
    }

    /// One byte. A chunk's runtime code is STOP, then the image bytes.
    function _isStop(address chunk) private view returns (bool ok) {
        assembly {
            let size := extcodesize(chunk)
            if gt(size, 1) {
                let ptr := mload(0x40)
                extcodecopy(chunk, ptr, 0, 1)
                ok := iszero(byte(0, mload(ptr)))
            }
        }
    }

    function _refund() private {
        uint256 left = address(this).balance;
        if (left == 0) return;
        (bool ok,) = msg.sender.call{value: left}("");
        if (!ok) revert RefundFailed();
        emit Refunded(msg.sender, left);
    }
}
