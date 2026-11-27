// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {OnPlate} from "./OnPlate.sol";

/// Creates one photograph contract. Deploy this before the factory.
/// The factory is the only caller. Image bytes are not stored here.
contract PlateDeployer {
    /// Tells the factory this contract creates photographs, not books.
    uint256 public constant KIND = 1;

    address public immutable factory;

    error Hook();

    constructor(address factory_) {
        if (factory_ == address(0)) revert Hook();
        factory = factory_;
    }

    function kind() external pure returns (uint256) {
        return KIND;
    }

    /// `factory` must already be deployed. The photograph checks that this
    /// contract is the creator that factory names.
    function deploy(
        OnPlate.Terms calldata terms,
        string calldata name_,
        string calldata description_,
        string calldata artistName_,
        address book_,
        bytes calldata thumbnail_,
        uint256 pieceExpect_
    ) external returns (address plate) {
        if (msg.sender != factory) revert Hook();
        plate = address(new OnPlate(factory, terms, name_, description_, artistName_, book_, thumbnail_, pieceExpect_));
    }
}
