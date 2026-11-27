// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ChunkBook} from "./ChunkBook.sol";
import {PlateLimits} from "./PlateLimits.sol";

interface IFactoryDev {
    function devRecipient() external view returns (address);
    function plates() external view returns (address);
}

interface IFactoryWork {
    function releaseWork() external;
}

/// One photograph. Token id is always 1.
/// The image lives in chunk contracts. This contract stores the hash, the book
/// that lists those chunks, the royalty terms, a small PNG, and the vault state.
/// The image bytes are not copied into storage.
/// Sale, park, and return are the only moves. Approvals and standard transfers revert.
/// Royalties are fixed here. The dev recipient is copied from the factory at creation.
/// Buy credits balances. Recipients withdraw. Buy does not call out.
/// Parking is added security for a mounted photograph. The title names a vault
/// and the token moves there in the same call. That vault can only send it home.
contract OnPlate is ERC721, ReentrancyGuard {
    uint256 public constant TOKEN = 1;
    uint256 public constant BPS = 10_000;
    /// Same cap as the chunk book. One registration stores the book, not every address.
    uint256 public constant MAX_CHUNKS = PlateLimits.MAX_CHUNKS;
    uint256 public constant THUMB_MAX = 4096;

    struct Terms {
        address title;
        uint256 plateId;
        bytes32 contentHash;
        uint16 devBps;
        uint16 artistBps;
        address artist;
    }

    address public immutable factory;
    uint256 public immutable plateId;
    bytes32 public immutable contentHash;
    address public immutable devRecipient;
    address public immutable artistRecipient;
    uint16 public immutable devBps;
    uint16 public immutable artistBps;
    uint256 public immutable pieceExpect;

    string public description;
    /// The name the artist typed. Empty when they left it blank.
    string public artistName;
    bytes public thumbnail;

    address public title;
    address public mailbox;
    uint256 public listedPrice;
    mapping(address => uint256) public claimable;
    uint256 public accounted;
    /// Zero means any buyer. Any other address is the only address that may buy.
    address public allowedBuyer;

    /// The chunk addresses live here. The image bytes do not.
    address private _book;
    bool public burned;
    /// The account that burned this plate. Empty until then.
    address public burnedBy;
    bool private _minting;
    bool private _selling;
    bool private _parking;
    bool private _releasing;
    bool private _burning;

    error Hook();
    error BadPrice();
    error NotTitle();
    error NotListed();
    error BadChunk();
    error BadText();
    error BadThumb();
    error Royalty();
    error TransfersOff();
    error ApprovalsOff();
    error Nothing();
    error Unpaid();
    error NotBuyer();
    error NotHolder();

    event Listed(uint256 price);
    event Cancelled();
    event Bought(address indexed buyer, address indexed seller, uint256 price);
    event Parked(address indexed vault);
    event Released(address indexed vault);
    event MailboxCleared();
    event Withdrawn(address indexed to, uint256 amount);
    event BuyerSet(address indexed buyer);
    event Burned(address indexed holder);

    constructor(
        address factory_,
        Terms memory terms,
        string memory name_,
        string memory description_,
        string memory artistName_,
        address book_,
        bytes memory thumbnail_,
        uint256 pieceExpect_
    ) ERC721(name_, "PLATE") {
        // The caller is the plate creator, not the factory. The factory names that creator.
        if (factory_ == address(0) || msg.sender != IFactoryDev(factory_).plates()) revert Hook();
        if (terms.title == address(0) || terms.title == address(this)) revert Hook();
        if (terms.contentHash == bytes32(0)) revert Hook();
        _plain(name_, 1, 48);
        _plain(description_, 0, 240);
        _plain(artistName_, 0, 48);
        _png(thumbnail_);
        _royalty(terms);

        address dev = IFactoryDev(factory_).devRecipient();
        if (dev == address(0)) revert Hook();
        if (pieceExpect_ == 0 || pieceExpect_ > MAX_CHUNKS) revert BadChunk();

        factory = factory_;
        plateId = terms.plateId;
        contentHash = terms.contentHash;
        devRecipient = dev;
        devBps = terms.devBps;
        artistBps = terms.artistBps;
        artistRecipient = _artist(terms);
        description = description_;
        artistName = artistName_;
        thumbnail = thumbnail_;
        pieceExpect = pieceExpect_;
        _boundBook(factory_, terms.title, book_);
        if (ChunkBook(book_).chunkCount() != pieceExpect_) revert BadChunk();
        _book = book_;

        title = terms.title;
        _minting = true;
        _mint(terms.title, TOKEN);
        _minting = false;
    }

    function book() public view returns (address) {
        return _book;
    }

    function printed() public view returns (bool) {
        return _book != address(0);
    }

    function chunkCount() external view returns (uint256) {
        if (_book == address(0)) return 0;
        return ChunkBook(_book).chunkCount();
    }

    function chunkAt(uint256 index) external view returns (address) {
        return ChunkBook(_book).chunkAt(index);
    }

    /// Copies chunk bytecode. Does not call the chunk. Does not read the original transaction.
    function readChunk(uint256 index) external view returns (bytes memory out) {
        address chunk = ChunkBook(_book).chunkAt(index);
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

    /// True only while the named vault holds the token.
    function parked() public view returns (bool) {
        address box = mailbox;
        return box != address(0) && ownerOf(TOKEN) == box;
    }

    /// Title names a price. The token must be in the title's hand.
    function list(uint256 ask) external nonReentrant {
        if (ask == 0) revert BadPrice();
        if (msg.sender != title || ownerOf(TOKEN) != title) revert NotTitle();
        listedPrice = ask;
        emit Listed(ask);
    }

    /// Title takes the price off. The token stays where it is.
    /// The named buyer, if any, stays until the title changes it.
    /// A parked photograph reverts.
    function cancel() external nonReentrant {
        if (parked()) revert Hook();
        if (msg.sender != title) revert NotTitle();
        delete listedPrice;
        emit Cancelled();
    }

    /// Title names the only buyer, replaces that address, or clears it with the zero address.
    /// A parked photograph reverts. The price is unchanged.
    function setAllowedBuyer(address buyer) external nonReentrant {
        if (parked()) revert Hook();
        if (msg.sender != title || ownerOf(TOKEN) != title) revert NotTitle();
        allowedBuyer = buyer;
        emit BuyerSet(buyer);
    }

    /// Buyer pays the listed price and receives the token.
    /// Short and over both revert. The price is cleared before the move.
    /// A named buyer is the only address that may call this. That name is cleared
    /// so the new title starts with a public listing. Dev, artist, and seller are credited. Nobody is called.
    function buy() external payable nonReentrant {
        _buy(msg.sender);
    }

    function _buy(address buyer) internal {
        address seller = title;
        uint256 cost = listedPrice;
        if (_book == address(0)) revert BadChunk();
        if (seller == address(0) || cost == 0) revert NotListed();
        if (ownerOf(TOKEN) != seller) revert Hook();
        if (msg.value != cost) revert BadPrice();
        if (buyer == seller) revert Hook();
        if (allowedBuyer != address(0) && buyer != allowedBuyer) revert NotBuyer();

        delete listedPrice;
        mailbox = address(0);
        allowedBuyer = address(0);
        emit BuyerSet(address(0));
        _credit(seller, cost);

        _selling = true;
        _update(buyer, TOKEN, address(0));
        _selling = false;
        emit Bought(buyer, seller, cost);
    }

    /// Title names a vault. The contract parks the token in the same call.
    /// The zero address, this contract, and the title are not a vault.
    /// The listed price and the named buyer are cleared. A later sale needs a new list.
    function setMailbox(address vault) external nonReentrant {
        if (_book == address(0)) revert BadChunk();
        if (msg.sender != title || ownerOf(TOKEN) != title) revert NotTitle();
        if (vault == address(0) || vault == address(this) || vault == title) revert Hook();
        mailbox = vault;
        delete listedPrice;
        allowedBuyer = address(0);
        emit BuyerSet(address(0));
        _parking = true;
        _update(vault, TOKEN, address(0));
        _parking = false;
        emit Parked(vault);
    }

    /// The vault sends the token home. Home is the title. There is no other destination.
    /// The vault name is cleared so a later park can name a different address.
    function release() external nonReentrant {
        address box = mailbox;
        if (box == address(0) || msg.sender != box) revert Hook();
        if (ownerOf(TOKEN) != box) revert Hook();
        _releasing = true;
        _update(title, TOKEN, address(0));
        _releasing = false;
        mailbox = address(0);
        emit Released(box);
        emit MailboxCleared();
    }

    /// Title clears the vault name. Only while the token is not parked.
    function clearMailbox() external nonReentrant {
        if (msg.sender != title || ownerOf(TOKEN) != title) revert NotTitle();
        mailbox = address(0);
        emit MailboxCleared();
    }

    /// The title destroys the token while holding it. A past seller cannot.
    /// A parked photograph reverts. The vault cannot burn. Credited sale money stays withdrawable.
    /// The factory then either finishes this chunk list or returns it to the original registrar.
    function burn() external nonReentrant {
        if (burned) revert Nothing();
        if (parked()) revert Hook();
        if (msg.sender != ownerOf(TOKEN)) revert NotHolder();
        burned = true;
        burnedBy = msg.sender;
        delete listedPrice;
        allowedBuyer = address(0);
        emit BuyerSet(address(0));
        emit Cancelled();
        IFactoryWork(factory).releaseWork();
        _burning = true;
        _burn(TOKEN);
        _burning = false;
        emit Burned(msg.sender);
    }

    /// Pays `msg.sender` the balance credited to them. No one else.
    function withdraw() external nonReentrant {
        uint256 bal = claimable[msg.sender];
        if (bal == 0) revert Nothing();
        claimable[msg.sender] = 0;
        accounted -= bal;
        emit Withdrawn(msg.sender, bal);
        (bool ok,) = msg.sender.call{value: bal}("");
        if (!ok) revert Unpaid();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert TransfersOff();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert TransfersOff();
    }

    function approve(address, uint256) public pure override {
        revert ApprovalsOff();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalsOff();
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        ownerOf(id);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_json())));
    }

    function _json() internal view returns (string memory) {
        return string.concat(_jsonHead(), _jsonTail());
    }

    function _jsonHead() internal view returns (string memory) {
        return string.concat(
            '{"name":"',
            name(),
            '","description":"',
            description,
            '","artist_name":"',
            artistName,
            '","content_hash":"',
            Strings.toHexString(uint256(contentHash), 32)
        );
    }

    function _jsonTail() internal view returns (string memory) {
        return string.concat(
            '","image":"data:image/png;base64,',
            Base64.encode(thumbnail),
            '"}'
        );
    }

    function _credit(address seller, uint256 cost) internal {
        uint256 devCut = (cost * devBps) / BPS;
        uint256 artistCut = (cost * artistBps) / BPS;
        uint256 sellerCut = cost - devCut - artistCut;
        if (devCut > 0) claimable[devRecipient] += devCut;
        if (artistCut > 0) claimable[artistRecipient] += artistCut;
        if (sellerCut > 0) claimable[seller] += sellerCut;
        accounted += cost;
    }

    function _royalty(Terms memory terms) internal view {
        if (terms.devBps > BPS || terms.artistBps > BPS) revert Royalty();
        if (uint256(terms.devBps) + terms.artistBps > BPS) revert Royalty();
        if (terms.artist == address(this)) revert Royalty();
        if (terms.artistBps > 0 && terms.artist == address(0)) revert Royalty();
    }

    /// A zero artist share may name address(0). The address is still stored.
    function _artist(Terms memory terms) internal pure returns (address) {
        return terms.artist;
    }

    /// The book is already locked and marked used. This checks that fact.
    /// It does not copy the image.
    function _boundBook(address factory_, address title_, address book_) internal view {
        if (book_ == address(0) || book_ == address(this) || book_ == factory_) revert BadChunk();
        ChunkBook stored = ChunkBook(book_);
        if (stored.factory() != factory_ || stored.artist() != title_) revert BadChunk();
        if (!stored.locked() || !stored.used()) revert BadChunk();
        uint256 n = stored.chunkCount();
        if (n == 0 || n > MAX_CHUNKS || n != stored.expected()) revert BadChunk();
    }

    function _plain(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        bytes memory b = bytes(s);
        if (b.length < minLen || b.length > maxLen) revert BadText();
        for (uint256 i = 0; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c < 0x20 || c > 0x7e) revert BadText();
            if (c == '"' || c == "\\" || c == "<" || c == ">" || c == "&") revert BadText();
        }
    }

    /// PNG signature, then an IHDR of 32×32 or 48×48, 8-bit gray or truecolor.
    function _png(bytes memory t) internal pure {
        uint256 n = t.length;
        if (n < 29 || n > THUMB_MAX) revert BadThumb();
        if (
            t[0] != 0x89 || t[1] != 0x50 || t[2] != 0x4e || t[3] != 0x47 || t[4] != 0x0d || t[5] != 0x0a
                || t[6] != 0x1a || t[7] != 0x0a
        ) revert BadThumb();
        if (t[12] != "I" || t[13] != "H" || t[14] != "D" || t[15] != "R") revert BadThumb();
        uint32 w = (uint32(uint8(t[16])) << 24) | (uint32(uint8(t[17])) << 16) | (uint32(uint8(t[18])) << 8)
            | uint32(uint8(t[19]));
        uint32 h = (uint32(uint8(t[20])) << 24) | (uint32(uint8(t[21])) << 16) | (uint32(uint8(t[22])) << 8)
            | uint32(uint8(t[23]));
        if (!((w == 48 && h == 48) || (w == 32 && h == 32))) revert BadThumb();
        if (uint8(t[24]) != 8) revert BadThumb();
        if (uint8(t[25]) != 0 && uint8(t[25]) != 2) revert BadThumb();
        if (uint8(t[26]) != 0 || uint8(t[27]) != 0 || uint8(t[28]) != 0) revert BadThumb();
    }

    function _update(address to, uint256 id, address) internal override returns (address) {
        if (id != TOKEN) revert Hook();
        address from = _ownerOf(id);
        if (from != address(0)) delete listedPrice;
        if (_burning) {
            if (to != address(0) || from == address(0)) revert Hook();
            return super._update(to, id, address(0));
        }
        if (to == address(0)) revert Hook();

        if (_minting) {
            if (from != address(0) || to != title) revert Hook();
            return super._update(to, id, address(0));
        }
        if (_selling) {
            if (from != title || to == title) revert Hook();
            title = to;
            return super._update(to, id, address(0));
        }
        if (_parking) {
            if (from != title || to != mailbox || mailbox == address(0)) revert Hook();
            return super._update(to, id, address(0));
        }
        if (_releasing) {
            if (from != mailbox || to != title || mailbox == address(0)) revert Hook();
            return super._update(to, id, address(0));
        }
        revert Hook();
    }
}
