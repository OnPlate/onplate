// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ChunkBatch} from "../src/ChunkBatch.sol";
import {PlateChunk} from "../src/PlateChunk.sol";

contract ReturnsOne {
    constructor() {
        assembly {
            mstore8(0, 1)
            return(0, 2)
        }
    }
}

contract BatchCatcher {
    ChunkBatch public batch;
    bool public caught;

    constructor(ChunkBatch batch_) {
        batch = batch_;
    }

    receive() external payable {
        try batch.createPieces(new bytes[](0)) {}
        catch {
            caught = true;
        }
    }

    function go(bytes[] calldata initCodes) external payable {
        batch.createPieces{value: msg.value}(initCodes);
    }
}

contract BatchBurster {
    ChunkBatch public batch;

    constructor(ChunkBatch batch_) {
        batch = batch_;
    }

    receive() external payable {
        batch.createPieces(new bytes[](0));
    }

    function go(bytes[] calldata initCodes) external payable {
        batch.createPieces{value: msg.value}(initCodes);
    }
}

contract ChunkBatchTest is Test {
    ChunkBatch internal batch;

    function setUp() public {
        batch = new ChunkBatch();
    }

    receive() external payable {}

    function _init(bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(type(PlateChunk).creationCode, abi.encode(data));
    }

    function _payload(address chunk) internal view returns (bytes memory out) {
        assembly {
            let size := extcodesize(chunk)
            if lt(size, 2) { revert(0, 0) }
            size := sub(size, 1)
            out := mload(0x40)
            mstore(out, size)
            let dest := add(out, 32)
            extcodecopy(chunk, dest, 1, size)
            mstore(add(dest, size), 0)
            mstore(0x40, add(dest, and(add(size, 31), not(31))))
        }
    }

    function test_CreatesOnePieceAndRefunds() public {
        bytes[] memory initCodes = new bytes[](1);
        initCodes[0] = _init(hex"010203");
        uint256 nonce = vm.getNonce(address(batch));
        address predicted = vm.computeCreateAddress(address(batch), nonce);
        vm.deal(address(this), 5 ether);
        uint256 before = address(this).balance;
        vm.recordLogs();
        address[] memory made = batch.createPieces{value: 1 ether}(initCodes);
        assertEq(made.length, 1);
        assertEq(made[0], predicted);
        assertEq(batch.maker(made[0]), address(this));
        assertEq(_payload(made[0]), hex"010203");
        assertEq(uint256(uint8(made[0].code[0])), 0);
        assertEq(address(batch).balance, 0);
        assertEq(address(this).balance, before);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[0], keccak256("PieceCreated(address,uint256,address)"));
        assertEq(logs[1].topics[0], keccak256("Refunded(address,uint256)"));
        assertEq(uint256(bytes32(logs[1].data)), 1 ether);
    }

    function test_CreatesTwoPiecesWithNoValue() public {
        bytes[] memory initCodes = new bytes[](2);
        initCodes[0] = _init(hex"aa");
        initCodes[1] = _init(hex"bbcc");
        address[] memory made = batch.createPieces(initCodes);
        assertEq(made.length, 2);
        assertEq(batch.maker(made[0]), address(this));
        assertEq(batch.maker(made[1]), address(this));
        assertEq(_payload(made[0]), hex"aa");
        assertEq(_payload(made[1]), hex"bbcc");
        assertEq(address(batch).balance, 0);
    }

    function test_EmptyArrayReverts() public {
        vm.expectRevert(ChunkBatch.Empty.selector);
        batch.createPieces(new bytes[](0));
    }

    function test_EmptyInitReverts() public {
        bytes[] memory initCodes = new bytes[](1);
        vm.expectRevert(ChunkBatch.CreateFailed.selector);
        batch.createPieces(initCodes);
    }

    function test_BadRuntimeReverts() public {
        bytes[] memory initCodes = new bytes[](1);
        initCodes[0] = type(ReturnsOne).creationCode;
        vm.expectRevert(ChunkBatch.CreateFailed.selector);
        batch.createPieces(initCodes);
    }

    function test_TooLongReverts() public {
        bytes[] memory initCodes = new bytes[](1);
        initCodes[0] = new bytes(32001);
        vm.expectRevert(ChunkBatch.CreateFailed.selector);
        batch.createPieces(initCodes);
    }

    function test_PlainTransferReverts() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(batch).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(batch).balance, 0);
    }

    function test_RefundReenterIsBusyAndCaught() public {
        BatchCatcher catcher = new BatchCatcher(batch);
        bytes[] memory initCodes = new bytes[](1);
        initCodes[0] = _init(hex"11");
        vm.deal(address(catcher), 1 ether);
        catcher.go{value: 0.2 ether}(initCodes);
        assertTrue(catcher.caught());
        assertEq(address(batch).balance, 0);
    }

    function test_RefundReenterWithoutCatchReverts() public {
        BatchBurster burster = new BatchBurster(batch);
        bytes[] memory initCodes = new bytes[](1);
        initCodes[0] = _init(hex"11");
        vm.deal(address(burster), 1 ether);
        vm.expectRevert(ChunkBatch.RefundFailed.selector);
        burster.go{value: 0.2 ether}(initCodes);
        assertEq(address(batch).balance, 0);
    }
}
