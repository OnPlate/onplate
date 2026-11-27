// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ChunkBook} from "./ChunkBook.sol";
import {OnPlate} from "./OnPlate.sol";
import {PlateLimits} from "./PlateLimits.sol";
interface IChunkMaker {
    function maker(address chunk) external view returns (address);
}
interface IPageFactory {
    function factory() external returns (address);
}

interface IPlateSource {
    function factory() external view returns (address);
    function kind() external view returns (uint256);
    function deploy(
        OnPlate.Terms calldata terms,
        string calldata name_,
        string calldata description_,
        string calldata artistName_,
        bool nominationAllowed_,
        address book_,
        bytes calldata thumbnail_,
        uint256 pieceExpect_
    ) external returns (address plate);
}

interface IBookSource {
    function factory() external view returns (address);
    function kind() external view returns (uint256);
    function deploy(address artist_, uint256 expected_) external returns (address book);
}

/// Deploys the photographs. Starts empty.
/// Ownership can be transferred. It cannot be renounced.
/// The owner sets the piece helper once. After that, ownership controls
/// the developer-fee recipient, the artist upload whitelist, and the on-chain fallback page.
/// Transfer itself changes none of those, and it changes no photograph.
/// The whitelist is only an upload gate. Replacing the page writes no plate.
/// The owner authorizes any address with `setAuthorized`, and can remove one.
/// A vaulted plate may add one address through `nominate`. That call cannot remove one.
/// Removing the address does not give that plate another nomination.
/// The owner, or an address on the whitelist, may add a photograph up to the full piece cap.
/// Any other address may add a photograph of at most `OPEN_MAX` pieces.
/// `linkPhoto` is one call that opens the book, writes the chunk addresses, seals, and registers.
/// A stranger may use it for at most `OPEN_MAX` pieces. A nominated signer, the owner, or a
/// restoring origin may use it up to `MAX_CHUNKS`. A larger photograph that does not take that
/// path still uses `openBook`, `addChunks`, `sealBook`, and `addPhoto`.
/// A photograph registered by an address that is not on the whitelist cannot nominate. The flag is fixed at registration.
/// The signer pays and must be allowed to register that size. The book's artist becomes the title.
/// On the first registration of a chunk list, that artist is also the origin.
/// A call that does not name a home uses the signer. Naming a home gives that wallet the photograph in the same registration.
/// There is no later transfer. A burned list can be registered again only by its origin, and only back to that origin.
/// `devBps` is the developer share of each sale.
/// That share plus the artist share on a plate cannot exceed 10,000.
/// `defaultArtistBps` is the pre-filled artist share. Each photograph may set its own.
/// `plates` creates the photograph contracts. `books` creates the chunk books.
/// This factory does not contain either creation code, and it does not store image bytes.
contract OnPlateFactory is Ownable, ReentrancyGuard {
    uint256 public photoCount;
    address public page;
    /// Copied onto each photograph at creation. Later changes do not follow.
    address public devRecipient;
    uint16 public immutable devBps;
    uint16 public immutable defaultArtistBps;
    /// The only contract allowed to create a photograph for this factory.
    address public immutable plates;
    /// The only contract allowed to create a chunk book for this factory.
    address public immutable books;
    /// The helper that records which wallet paid for each piece. Set once.
    address public batch;

    /// One batch of chunk addresses. Measured to stay under a 30,000,000 gas block.
    uint256 public constant APPEND_MAX = 80;

    mapping(uint256 => address) public photoAt;
    mapping(address => bool) public isPhoto;
    mapping(address => bool) public isBook;
    /// The account that opened this book and may still finish it. Cleared once the plate exists.
    /// The book's artist is the wallet that will own the photograph. Those two can differ.
    mapping(address => address) public openedBy;
    mapping(address => bool) public authorized;
    struct Lineage {
        address origin;
        bool extinguished;
        bool chanceOpen;
    }

    /// The plate that currently owns this ordered chunk list. Empty when none does.
    mapping(bytes32 => address) public liveWork;
    /// Set on the first registration. `extinguished` means the origin burned it.
    /// `chanceOpen` is the one nomination life of that list.
    mapping(bytes32 => Lineage) public lineage;
    /// Large works a deauthorized origin may still restore, counted by piece count.
    /// A new file does not spend this, and it still needs the whitelist.
    mapping(address => mapping(uint256 => uint256)) public restores;

    error Hook();
    error NotAllowed();
    error BadPage();
    error BadChunk();
    error Royalty();
    error WorkTaken();
    error WorkEnded();

    /// `artist` here is the account that signed. The plate's title is the book's artist.
    event PhotoAdded(uint256 indexed id, address indexed plate, address indexed artist);
    event WorkReleased(uint256 indexed id, address indexed plate, bytes32 indexed key);
    event BookOpened(address indexed book, address indexed artist, uint256 count);
    event Authorized(address indexed artist, bool ok);
    event DevRecipientSet(address indexed recipient);
    event PageSet(address indexed page);
    event BatchSet(address indexed batch);

    constructor(uint16 devBps_, uint16 defaultArtistBps_, address plates_, address books_) Ownable(msg.sender) {
        if (devBps_ > 10_000 || defaultArtistBps_ > 10_000 || uint256(devBps_) + defaultArtistBps_ > 10_000) {
            revert Royalty();
        }
        if (plates_ == address(0) || books_ == address(0) || plates_ == books_) revert Hook();
        if (plates_.code.length == 0 || books_.code.length == 0) revert Hook();
        // Read these before the immutables are set, so a callback sees empty creators.
        if (IPlateSource(plates_).factory() != address(this) || IPlateSource(plates_).kind() != 1) revert Hook();
        if (IBookSource(books_).factory() != address(this) || IBookSource(books_).kind() != 2) revert Hook();
        devBps = devBps_;
        defaultArtistBps = defaultArtistBps_;
        plates = plates_;
        books = books_;
        devRecipient = msg.sender;
    }

    /// Refused. The factory can be acquired, and it cannot be given up.
    function renounceOwnership() public pure override {
        revert Hook();
    }

    /// The owner may add. An address on the whitelist may add. Nobody else may.
    function canAdd(address account) public view returns (bool) {
        return account == owner() || authorized[account];
    }

    /// Points later photographs at `recipient`. Plates already created keep theirs.
    /// The zero address would make the next `addPhoto` revert. This factory cannot
    /// withdraw, so it is refused too.
    function setDevRecipient(address recipient) external onlyOwner {
        if (recipient == address(0) || recipient == address(this)) revert Hook();
        devRecipient = recipient;
        emit DevRecipientSet(recipient);
    }

    /// Adds to the upload whitelist when `ok` is true, and removes when it is false.
    /// `canAdd` is the only reader. A plate, a chunk, and a royalty are not written.
    /// Nomination state does not gate this call. Removing an address does not clear `nominated` on a plate.
    function setAuthorized(address artist, bool ok) external onlyOwner {
        _authorize(artist, ok);
    }

    /// A registered plate adds one whitelist address. It cannot remove one.
    /// The plate marks its nomination used before this call. This function does not read that flag.
    function authorizeNominee(address nominee) external nonReentrant {
        if (!isPhoto[msg.sender]) revert NotAllowed();
        _authorize(nominee, true);
    }

    /// Names the piece helper. The owner calls this once after deploy.
    /// A later call reverts. Direct `PlateChunk` creates have no maker and cannot register.
    function setBatch(address batch_) external onlyOwner {
        if (batch != address(0)) revert Hook();
        if (batch_ == address(0) || batch_ == address(this) || batch_.code.length == 0) revert Hook();
        batch = batch_;
        emit BatchSet(batch_);
    }

    /// Replaces the fallback page. The page must name this factory.
    /// The byte cap lives in the page contract. This writes `page` only.
    function setPage(address page_) external nonReentrant onlyOwner {
        if (page_ == address(0) || page_.code.length == 0) revert BadPage();
        page = page_;
        if (IPageFactory(page_).factory() != address(this)) revert BadPage();
        emit PageSet(page_);
    }

    function maxChunks() external pure returns (uint256) {
        return PlateLimits.MAX_CHUNKS;
    }

    /// The piece count an address may register before it is on the whitelist.
    function openMax() external pure returns (uint256) {
        return PlateLimits.OPEN_MAX;
    }

    function appendMax() external pure returns (uint256) {
        return APPEND_MAX;
    }

    /// Starts an empty address list. The image is not stored here.
    /// `count` is how many chunk contracts the photograph will use.
    /// The caller becomes the title.
    function openBook(uint256 count) external nonReentrant returns (address book) {
        book = _openBook(count, msg.sender);
    }

    /// Same as `openBook`, but `home` becomes the title and the origin.
    /// The zero address means the caller. The caller still pays and still needs the whitelist for a new large file.
    function openBook(uint256 count, address home) external nonReentrant returns (address book) {
        book = _openBook(count, _home(home));
    }

    /// The zero address means the caller. The factory cannot own a photograph.
    function _home(address home_) internal view returns (address) {
        if (home_ == address(0)) return msg.sender;
        if (home_ == address(this)) revert Hook();
        return home_;
    }

    /// Writes the next chunk addresses. At most `APPEND_MAX` per transaction.
    function addChunks(address book, address[] calldata chunks) external nonReentrant {
        _addChunks(book, chunks);
    }

    /// Locks the list. The photograph does not exist yet.
    function sealBook(address book) external nonReentrant {
        _sealBook(book);
    }

    /// Chunks are already deployed and listed in `book`. This call stores the
    /// hash, the thumbnail, and the royalty terms, and mints the one token.
    /// The image bytes are not copied. `devRecipient` is not an argument.
    /// The plate copies `devRecipient()`. `devBps_` must equal the constructor share.
    function addPhoto(
        string calldata name_,
        string calldata description_,
        string calldata artistName_,
        bytes32 contentHash,
        address book,
        bytes calldata thumbnail,
        uint16 devBps_,
        uint16 artistBps,
        address artist
    ) external nonReentrant returns (address plate) {
        Mint memory m;
        m.name = name_;
        m.description = description_;
        m.artistName = artistName_;
        m.contentHash = contentHash;
        m.book = book;
        m.thumbnail = thumbnail;
        m.devBps = devBps_;
        m.artistBps = artistBps;
        m.artist = artist;
        plate = _addPhoto(m);
    }

    /// One word of `text`. `text` is the ABI encoding of the name, the description,
    /// the artist name, and the thumbnail. Reading one field at a time keeps this
    /// call inside the compiler's stack limit.
    function _textAt(bytes calldata text, uint256 which) internal pure returns (bytes calldata part) {
        uint256 base = uint256(bytes32(text[which * 32:(which + 1) * 32]));
        uint256 len = uint256(bytes32(text[base:base + 32]));
        part = text[base + 32:base + 32 + len];
    }

    /// One transaction that opens the book, writes the chunk addresses, seals, and registers.
    /// A stranger may pass at most `OPEN_MAX` pieces. A nominated signer, the owner, or a
    /// restoring origin may pass up to `MAX_CHUNKS`. Addresses are written in batches of `APPEND_MAX`.
    /// `text` is `abi.encode(name, description, artistName, thumbnail)`.
    function linkPhoto(
        bytes32 contentHash,
        address[] calldata chunks,
        uint16 devBps_,
        uint16 artistBps,
        address artist,
        bytes calldata text
    ) external nonReentrant returns (address plate) {
        plate = _linkPhoto(contentHash, chunks, devBps_, artistBps, artist, text, msg.sender);
    }

    /// Same as `linkPhoto`, but `home` becomes the title and the origin.
    /// The zero address means the caller. Size rules are the same as the call without `home`.
    function linkPhoto(
        bytes32 contentHash,
        address[] calldata chunks,
        uint16 devBps_,
        uint16 artistBps,
        address artist,
        bytes calldata text,
        address home
    ) external nonReentrant returns (address plate) {
        plate = _linkPhoto(contentHash, chunks, devBps_, artistBps, artist, text, _home(home));
    }

    function _linkPhoto(
        bytes32 contentHash,
        address[] calldata chunks,
        uint16 devBps_,
        uint16 artistBps,
        address artist,
        bytes calldata text,
        address home_
    ) internal returns (address plate) {
        Mint memory m;
        uint256 i;
        if (chunks.length == 0 || chunks.length > PlateLimits.MAX_CHUNKS) revert BadChunk();
        if (!_sizeOpenFor(msg.sender, chunks.length)) revert NotAllowed();
        m.book = _openBook(chunks.length, home_);
        while (i < chunks.length) {
            uint256 n = chunks.length - i;
            if (n > APPEND_MAX) n = APPEND_MAX;
            _addChunks(m.book, chunks[i:i + n]);
            i += n;
        }
        _sealBook(m.book);
        m.contentHash = contentHash;
        m.devBps = devBps_;
        m.artistBps = artistBps;
        m.artist = artist;
        m.name = string(_textAt(text, 0));
        m.description = string(_textAt(text, 1));
        m.artistName = string(_textAt(text, 2));
        m.thumbnail = _textAt(text, 3);
        plate = _addPhoto(m);
    }

    function _openBook(uint256 count, address home_) internal returns (address book) {
        if (count == 0 || count > PlateLimits.MAX_CHUNKS) revert BadChunk();
        if (home_ == address(0) || home_ == address(this)) revert Hook();
        if (!_sizeOpen(count)) revert NotAllowed();
        book = IBookSource(books).deploy(home_, count);
        if (book == address(0) || book == address(this) || book == home_ || book.code.length == 0 || isBook[book]) {
            revert BadChunk();
        }
        ChunkBook opened = ChunkBook(book);
        if (opened.factory() != address(this) || opened.artist() != home_) revert BadChunk();
        if (opened.expected() != count || opened.chunkCount() != 0 || opened.locked() || opened.used()) {
            revert BadChunk();
        }
        isBook[book] = true;
        openedBy[book] = msg.sender;
        emit BookOpened(book, home_, count);
    }

    function _addChunks(address book, address[] calldata chunks) internal {
        _guardBook(book);
        if (chunks.length == 0 || chunks.length > APPEND_MAX) revert BadChunk();
        ChunkBook(book).addChunks(chunks);
    }

    function _sealBook(address book) internal {
        _guardBook(book);
        ChunkBook(book).seal();
    }

    /// One photograph's registration fields. One argument keeps the compiler's stack inside its limit.
    struct Mint {
        string name;
        string description;
        string artistName;
        bytes32 contentHash;
        address book;
        bytes thumbnail;
        uint16 devBps;
        uint16 artistBps;
        address artist;
    }

    function _addPhoto(Mint memory m) internal returns (address plate) {
        if (m.devBps != devBps) revert Royalty();
        if (!isBook[m.book]) revert BadChunk();
        address title_ = ChunkBook(m.book).artist();
        _useBook(m.book, title_);
        (bytes32 key, bool chance, bool restoring) = _prepareWork(m.book);
        uint256 expect_ = ChunkBook(m.book).chunkCount();
        uint256 id = ++photoCount;
        OnPlate.Terms memory terms = OnPlate.Terms({
            title: title_,
            plateId: id,
            contentHash: m.contentHash,
            devBps: m.devBps,
            artistBps: m.artistBps,
            artist: m.artist
        });
        plate = IPlateSource(plates).deploy(
            terms, m.name, m.description, m.artistName, chance, m.book, m.thumbnail, expect_
        );
        if (plate == address(0) || plate == address(this) || plate == m.book || plate.code.length == 0) revert Hook();
        if (plate == title_) revert Hook();
        if (isPhoto[plate]) revert Hook();
        OnPlate made = OnPlate(plate);
        if (made.factory() != address(this) || made.book() != m.book || made.plateId() != id) revert Hook();
        if (made.contentHash() != m.contentHash || made.title() != title_) revert Hook();
        if (made.nominationAllowed() != chance || made.pieceExpect() != expect_) revert Hook();
        _finishWork(key, plate, chance, restoring);
        photoAt[id] = plate;
        isPhoto[plate] = true;
        emit PhotoAdded(id, plate, msg.sender);
    }

    /// The ordered chunk addresses of a sealed book. A new upload of the same bytes
    /// is a different key, because those bytes sit in different contracts.
    function workKey(address book) public view returns (bytes32) {
        ChunkBook stored = ChunkBook(book);
        uint256 n = stored.chunkCount();
        address[] memory chunks = new address[](n);
        for (uint256 i = 0; i < n; ++i) chunks[i] = stored.chunkAt(i);
        return keccak256(abi.encode(chunks));
    }

    /// The plate calls this after it has marked itself burned and before it destroys the token.
    /// A burn by the origin finishes the list. Any other holder's burn returns it to the origin.
    /// A vault is not the origin, even when the origin chose that vault.
    function releaseWork() external nonReentrant {
        address plate = msg.sender;
        if (!isPhoto[plate]) revert Hook();
        OnPlate made = OnPlate(plate);
        if (!made.burned()) revert Hook();
        uint256 id = made.plateId();
        if (photoAt[id] != plate) revert Hook();
        if (made.book() == address(0)) revert Hook();
        bytes32 key = workKey(made.book());
        if (liveWork[key] != plate) revert Hook();
        Lineage storage row = lineage[key];
        if (row.origin == address(0)) revert Hook();
        address holder = made.burnedBy();
        if (holder == address(0)) revert Hook();
        if (holder == row.origin) {
            row.extinguished = true;
            row.chanceOpen = false;
        } else {
            row.chanceOpen = made.nominationAllowed() && !made.nominated() && !made.nominationRevoked();
            uint256 count = ChunkBook(made.book()).chunkCount();
            if (count > PlateLimits.OPEN_MAX) restores[row.origin][count] += 1;
        }
        delete liveWork[key];
        delete photoAt[id];
        isPhoto[plate] = false;
        emit WorkReleased(id, plate, key);
    }

    /// The whitelist covers a new file. Restoring a burned list above the open tier
    /// is allowed once for each such burn, and only at that piece count.
    function _sizeOpen(uint256 count) internal view returns (bool) {
        return _sizeOpenFor(msg.sender, count);
    }

    function _sizeOpenFor(address who, uint256 count) internal view returns (bool) {
        if (count <= PlateLimits.OPEN_MAX || canAdd(who)) return true;
        return restores[who][count] > 0;
    }

    /// Reads the list's life before the plate is deployed. The chance is fixed here.
    function _prepareWork(address book) internal view returns (bytes32 key, bool chance, bool restoring) {
        key = workKey(book);
        Lineage memory row = lineage[key];
        if (row.extinguished) revert WorkEnded();
        if (liveWork[key] != address(0)) revert WorkTaken();
        restoring = row.origin != address(0);
        // A restore has to be signed by the origin, and the new plate has to be titled to that same origin.
        if (restoring && (row.origin != msg.sender || ChunkBook(book).artist() != msg.sender)) revert WorkTaken();
        uint256 count = ChunkBook(book).chunkCount();
        if (count > PlateLimits.OPEN_MAX && !canAdd(msg.sender) && !restoring) revert NotAllowed();
        chance = restoring ? row.chanceOpen : canAdd(msg.sender);
    }

    /// Records the origin on the first registration. A restore spends one large-work credit.
    function _finishWork(bytes32 key, address plate, bool chance, bool restoring) internal {
        if (liveWork[key] != address(0)) revert WorkTaken();
        Lineage storage row = lineage[key];
        if (row.extinguished) revert WorkEnded();
        address artist_ = ChunkBook(OnPlate(plate).book()).artist();
        if (row.origin == address(0)) {
            if (restoring) revert Hook();
            row.origin = artist_;
            row.chanceOpen = chance;
        } else if (row.origin != msg.sender || artist_ != msg.sender) {
            revert WorkTaken();
        }
        liveWork[key] = plate;
        if (!restoring) return;
        uint256 count = ChunkBook(OnPlate(plate).book()).chunkCount();
        if (count > PlateLimits.OPEN_MAX && restores[msg.sender][count] > 0) restores[msg.sender][count] -= 1;
    }

    /// The caller is the book's artist or the account that opened the book.
    /// A new book above the open tier needs the caller's whitelist,
    /// unless this caller is restoring a burned work of that same size.
    function _guardBook(address book) internal view {
        if (!isBook[book]) revert BadChunk();
        ChunkBook stored = ChunkBook(book);
        if (stored.artist() != msg.sender && openedBy[book] != msg.sender) revert NotAllowed();
        uint256 count = stored.expected();
        if (count == 0 || count > PlateLimits.MAX_CHUNKS) revert BadChunk();
        if (!_sizeOpen(count)) revert NotAllowed();
    }

    function _useBook(address book, address artist_) internal {
        if (!isBook[book]) revert BadChunk();
        ChunkBook stored = ChunkBook(book);
        if (stored.artist() != artist_ || !stored.locked() || stored.used()) revert BadChunk();
        if (msg.sender != artist_ && openedBy[book] != msg.sender) revert NotAllowed();
        if (stored.chunkCount() == 0 || stored.chunkCount() != stored.expected()) revert BadChunk();
        _requireMakers(book);
        stored.consume();
        delete openedBy[book];
    }

    /// A first registration has to be signed by the wallet that stored the pieces,
    /// or by the account that opened the book for that wallet. A restore of a
    /// burned list is signed by the origin, who may not have been the creator.
    function _requireMakers(address book) internal view {
        if (batch == address(0)) revert Hook();
        bytes32 key = workKey(book);
        Lineage memory row = lineage[key];
        if (row.origin != address(0)) {
            if (row.extinguished) revert WorkEnded();
            if (row.origin != msg.sender) revert WorkTaken();
            return;
        }
        address opener = openedBy[book];
        ChunkBook stored = ChunkBook(book);
        uint256 n = stored.chunkCount();
        for (uint256 i = 0; i < n; ++i) {
            address who = IChunkMaker(batch).maker(stored.chunkAt(i));
            if (who == address(0)) revert BadChunk();
            if (who != msg.sender && who != opener) revert NotAllowed();
        }
    }

    function _authorize(address artist, bool ok) internal {
        if (artist == address(0) || artist == address(this)) revert NotAllowed();
        authorized[artist] = ok;
        emit Authorized(artist, ok);
    }
}
