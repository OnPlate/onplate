// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {VmSafe} from "forge-std/Vm.sol";

interface IUploadFactory {
    function canAdd(address account) external view returns (bool);
    function devBps() external view returns (uint16);
    function defaultArtistBps() external view returns (uint16);
    function maxChunks() external view returns (uint256);
    function openMax() external view returns (uint256);
    function appendMax() external view returns (uint256);
    function photoCount() external view returns (uint256);
    function photoAt(uint256 id) external view returns (address);
    function liveWork(bytes32 key) external view returns (address);
    function openBook(uint256 count) external returns (address book);
    function openBook(uint256 count, address home) external returns (address book);
    function addChunks(address book, address[] calldata chunks) external;
    function sealBook(address book) external;
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
    ) external returns (address plate);
    function linkPhoto(
        bytes32 contentHash,
        address[] calldata chunks,
        uint16 devBps_,
        uint16 artistBps,
        address artist,
        bytes calldata text
    ) external returns (address plate);
    function linkPhoto(
        bytes32 contentHash,
        address[] calldata chunks,
        uint16 devBps_,
        uint16 artistBps,
        address artist,
        bytes calldata text,
        address home
    ) external returns (address plate);
}

interface IUploadBatch {
    function createPieces(bytes[] calldata initCodes) external payable returns (address[] memory created);
    function maker(address chunk) external view returns (address);
}

interface IUploadPlate {
    function contentHash() external view returns (bytes32);
}

interface IUploadBook {
    function artist() external view returns (address);
    function expected() external view returns (uint256);
    function chunkCount() external view returns (uint256);
    function chunkAt(uint256 index) external view returns (address);
    function locked() external view returns (bool);
    function used() external view returns (bool);
}

/// Sends one photograph: piece groups, then the linking calls.
/// The file holds no key. The check run uses --sender only and stops after the
/// content hash. The send adds --account and --broadcast. OWNER is the wallet
/// that will own the photograph. Do not set the Unix HOME directory to an
/// address; that hides the keystore from --account. Set CONFIRM to the content
/// hash this script prints. A hash printed beside a download is not a check.
/// Trust the git commit you cloned. Run one upload at a time. Do not store
/// from the page while this script is sending, and do not start a second send.
contract Upload is Script {
    using stdJson for string;

    uint256 internal constant CHUNK_MAX = 18432;
    // Pieces per createPieces call. Adjust later; it does not change the per-byte bill.
    // OPEN_MAX stays 4 in a deployed factory.
    uint256 internal constant GROUP = 4;
    uint256 internal constant TX_GAS = 16_777_216;
    string internal constant PROGRESS = "broadcast/upload-progress.json";
    bytes4 internal constant LINK_PHOTO =
        bytes4(keccak256("linkPhoto(bytes32,address[],uint16,uint16,address,bytes)"));
    bytes4 internal constant LINK_HOME =
        bytes4(keccak256("linkPhoto(bytes32,address[],uint16,uint16,address,bytes,address)"));
    bytes4 internal constant OPEN_HOME = bytes4(keccak256("openBook(uint256,address)"));

    struct Job {
        address sender;
        address home;
        address factory;
        address batch;
        address artist;
        bytes32 contentHash;
        uint256 pieces;
        uint16 devBps;
        uint16 artistBps;
        string name;
        string description;
        string artistName;
        bytes image;
        bytes thumb;
        bytes creation;
        address[] chunks;
        uint256 done;
        address book;
        address plate;
    }

    function run() external {
        Job memory job;
        job.sender = vm.envAddress("SENDER");
        job.factory = vm.envAddress("FACTORY");
        job.batch = vm.envAddress("BATCH");
        job.name = vm.envString("NAME");
        job.description = vm.envOr("DESCRIPTION", string(""));
        job.artistName = vm.envOr("ARTIST_NAME", string(""));
        require(job.sender != address(0) && job.factory.code.length > 0 && job.batch.code.length > 0, "address");

        job.image = vm.readFileBinary(vm.envString("IMAGE"));
        job.thumb = vm.readFileBinary(vm.envString("THUMB"));
        require(job.image.length > 0, "image");
        checkThumb(job.thumb);
        checkText(job.name, 1, 48);
        checkText(job.description, 0, 240);
        checkText(job.artistName, 0, 48);

        job.devBps = IUploadFactory(job.factory).devBps();
        uint256 artistIn = vm.envOr("ARTIST_BPS", uint256(IUploadFactory(job.factory).defaultArtistBps()));
        require(artistIn <= 10_000 && uint256(job.devBps) + artistIn <= 10_000, "royalty");
        job.artistBps = uint16(artistIn);
        job.artist = vm.envOr("ARTIST", job.sender);
        if (job.artistBps > 0) require(job.artist != address(0), "recipient");
        require(job.artist != job.factory, "recipient");
        job.home = ownerFromEnv(job.sender);
        if (job.home == address(0)) job.home = job.sender;
        if (job.home == job.factory) {
            console2.log("OWNER cannot be the factory. Nothing was sent.");
            revert("home");
        }

        job.contentHash = keccak256(job.image);
        job.pieces = (job.image.length + CHUNK_MAX - 1) / CHUNK_MAX;
        require(job.pieces > 0 && job.pieces <= IUploadFactory(job.factory).maxChunks(), "pieces");
        if (!IUploadFactory(job.factory).canAdd(job.sender) && job.pieces > IUploadFactory(job.factory).openMax()) {
            console2.log("pieces", job.pieces);
            console2.log("A photograph larger than 4 pieces needs whitelist / boutique curation. Send this account’s public address in a direct message on X to @A_is_A. Nothing was sent.");
            revert("open");
        }
        if (job.home != job.sender) {
            bytes4 need = job.pieces <= IUploadFactory(job.factory).openMax() ? LINK_HOME : OPEN_HOME;
            if (!codeHas(job.factory, need)) {
                console2.log("This factory cannot give the photograph to OWNER. Nothing was sent.");
                revert("home");
            }
        }
        job.creation = creationCode();

        console2.log("content hash", vm.toString(job.contentHash));
        console2.log("pieces", job.pieces);
        console2.log("factory", job.factory);
        console2.log("batch", job.batch);
        console2.log("sender", job.sender);
        console2.log("owner", job.home);
        if (job.home != job.sender) console2.log("The keystore signs. The photograph will be owned by OWNER.");
        console2.log("name", job.name);
        console2.log("artist", job.artist);
        console2.log("chain", block.chainid);
        console2.log("Check this script against the git commit you cloned. A hash printed beside a download is not a check.");

        string memory confirm = vm.envOr("CONFIRM", string(""));
        if (bytes(confirm).length == 0) {
            console2.log("Set CONFIRM to the content hash above and run again with --broadcast. Nothing was sent.");
            revert("CONFIRM");
        }
        if (!sameHash(confirm, job.contentHash)) {
            console2.log("CONFIRM does not match this photograph. Nothing was sent.");
            revert("CONFIRM");
        }

        // The check run only needs the hash. Simulating every createPieces call
        // copies the photograph into EVM memory and OOGs a large file.
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            console2.log("Simulated only. Nothing was sent. Pass --broadcast to send.");
            return;
        }

        load(job);
        // The page keeps its list in the browser. This script cannot read that list.
        // It reads PieceCreated logs from this batch helper. Raw CREATE addresses
        // have no maker and cannot register. A matching progress file already
        // named live pieces. Scanning every log again copies payloads into EVM
        // memory and OOGs a large photograph.
        if (countStored(job) == 0) adopt(job);
        requireOwnPieces(job);
        console2.log("pieces already on-chain", countStored(job));
        if (job.book != address(0)) console2.log("book", job.book);
        if (job.plate != address(0)) {
            if (job.plate.code.length == 0) {
                console2.log("The progress file names a plate that was never mined. It will be registered again.");
                job.plate = address(0);
            } else {
                console2.log("This photograph is already registered.");
                console2.log(job.plate);
                return;
            }
        }
        {
            address live = livePlate(job);
            if (live != address(0)) {
                job.plate = live;
                console2.log("This photograph is already registered.");
                console2.log(live);
                return;
            }
        }

        vm.startBroadcast(job.sender);
        if (storeGroups(job)) link(job);
        vm.stopBroadcast();

        if (job.plate != address(0) && vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            console2.log("Registered.");
            console2.log(job.plate);
        } else if (job.done < job.pieces) {
            console2.log("Run the same command again to store the next group.");
        } else if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) {
            console2.log("Simulated only. Nothing was sent. Pass --broadcast to send.");
        }
    }

    /// Four full pieces fit under the 16,777,216 Osaka gas cap. Five do not.
    /// On Sepolia the inner call is not capped at that number so state gas for
    /// new code can sit above it. A short group is saved, then the script stops
    /// so a later run can continue.
    /// STORE_GROUPS limits how many new groups this run creates. Default 1 so a
    /// large photograph cannot MemoryOOG the script EVM. Zero means all groups.
    function storeGroups(Job memory job) internal returns (bool) {
        uint256 maxGroups = vm.envOr("STORE_GROUPS", uint256(1));
        uint256 groups;
        job.done = 0;
        while (job.done < job.pieces) {
            if (job.chunks[job.done] != address(0)) {
                job.done += 1;
                continue;
            }
            if (maxGroups != 0 && groups >= maxGroups) {
                console2.log("stored", job.done);
                console2.log("pieces", job.pieces);
                return false;
            }
            uint256 k;
            while (job.done + k < job.pieces && job.chunks[job.done + k] == address(0) && k < GROUP) {
                k += 1;
            }
            bytes[] memory inits = new bytes[](k);
            uint256 j;
            for (j = 0; j < k; j++) {
                inits[j] = bytes.concat(job.creation, abi.encode(sliceAt(job.image, (job.done + j) * CHUNK_MAX)));
            }
            address[] memory made;
            if (block.chainid == 11155111) {
                made = IUploadBatch(job.batch).createPieces(inits);
            } else {
                made = IUploadBatch(job.batch).createPieces{value: 0, gas: TX_GAS}(inits);
            }
            uint256 accepted;
            for (j = 0; j < made.length; j++) {
                if (!isChunk(made[j])) break;
                job.chunks[job.done + j] = made[j];
                accepted += 1;
            }
            job.done += accepted;
            save(job);
            if (accepted != k) {
                console2.log("A group stored fewer pieces than it was given. Run the same command again to continue. The photograph was not registered.");
                revert("short");
            }
            groups += 1;
        }
        return true;
    }

    /// True when the factory runtime contains this selector. An older factory keeps the four calls.
    function codeHas(address target, bytes4 sel) internal view returns (bool) {
        bytes memory code = target.code;
        if (code.length < 4) return false;
        for (uint256 i = 0; i + 3 < code.length; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }

    function link(Job memory job) internal {
        IUploadFactory factory = IUploadFactory(job.factory);
        requireOwnPieces(job);
        require(countStored(job) == job.pieces, "pieces");
        {
            address live = livePlate(job);
            if (live != address(0)) {
                job.plate = live;
                save(job);
                console2.log("This photograph is already registered.");
                console2.log(live);
                return;
            }
        }
        // One transaction when no book has been opened yet and the count fits in
        // one addChunks batch. A stranger still stops at openMax. A whitelisted
        // signer may go up to appendMax. A book that is already open, or a
        // larger photograph, keeps the four calls.
        if (job.book == address(0) && job.pieces > 0 && codeHas(job.factory, LINK_PHOTO)
            && job.pieces <= factory.appendMax()
            && (job.pieces <= factory.openMax() || factory.canAdd(job.sender))) {
            address[] memory chunks = new address[](job.pieces);
            for (uint256 i = 0; i < job.pieces; i++) chunks[i] = job.chunks[i];
            if (job.home != job.sender) {
                job.plate = factory.linkPhoto(
                    job.contentHash,
                    chunks,
                    job.devBps,
                    job.artistBps,
                    job.artist,
                    abi.encode(job.name, job.description, job.artistName, job.thumb),
                    job.home
                );
            } else {
                job.plate = factory.linkPhoto(
                    job.contentHash,
                    chunks,
                    job.devBps,
                    job.artistBps,
                    job.artist,
                    abi.encode(job.name, job.description, job.artistName, job.thumb)
                );
            }
            require(job.plate.code.length > 0, "plate");
            save(job);
            return;
        }
        if (job.book == address(0)) {
            if (job.home != job.sender) job.book = factory.openBook(job.pieces, job.home);
            else job.book = factory.openBook(job.pieces);
            require(job.book.code.length > 0, "book");
            save(job);
        }
        IUploadBook book = IUploadBook(job.book);
        require(book.artist() == job.home && book.expected() == job.pieces, "book");
        if (book.used()) {
            address found = findPlate(job);
            if (found != address(0)) {
                job.plate = found;
                save(job);
                console2.log("This photograph is already registered.");
                console2.log(found);
                return;
            }
            console2.log("This chunk book was already used. The progress file has no plate. Nothing further was sent.");
            revert("book");
        }
        uint256 linked = book.chunkCount();
        uint256 append = factory.appendMax();
        require(append > 0 && append <= 80 && linked <= job.pieces, "append");
        while (linked < job.pieces) {
            uint256 n = job.pieces - linked;
            if (n > append) n = append;
            address[] memory group = new address[](n);
            for (uint256 i = 0; i < n; i++) group[i] = job.chunks[linked + i];
            factory.addChunks(job.book, group);
            uint256 nowLinked = book.chunkCount();
            require(nowLinked == linked + n, "book");
            linked = nowLinked;
        }
        if (!book.locked()) {
            factory.sealBook(job.book);
            require(book.locked(), "book");
        }
        job.plate = factory.addPhoto(
            job.name,
            job.description,
            job.artistName,
            job.contentHash,
            job.book,
            job.thumb,
            job.devBps,
            job.artistBps,
            job.artist
        );
        require(job.plate.code.length > 0, "plate");
        save(job);
    }

    function findPlate(Job memory job) internal view returns (address) {
        uint256 n = IUploadFactory(job.factory).photoCount();
        for (uint256 i = n; i > 0; i--) {
            address plate = IUploadFactory(job.factory).photoAt(i);
            if (plate.code.length == 0) continue;
            if (IUploadPlate(plate).contentHash() == job.contentHash) return plate;
        }
        return address(0);
    }

    function countStored(Job memory job) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < job.pieces; i++) {
            if (job.chunks[i] != address(0)) n += 1;
        }
    }

    function listKey(address[] memory chunks) internal pure returns (bytes32) {
        return keccak256(abi.encode(chunks));
    }

    function livePlate(Job memory job) internal view returns (address) {
        if (countStored(job) != job.pieces || job.pieces == 0) return address(0);
        return IUploadFactory(job.factory).liveWork(listKey(job.chunks));
    }

    /// Progress is a cache. Live code, payload, and ChunkBatch.maker have to match
    /// this sender before a piece is treated as ours. An empty maker is a raw
    /// CREATE and cannot register on this factory.
    function requireOwnPieces(Job memory job) internal view {
        IUploadBatch helper = IUploadBatch(job.batch);
        uint256 i;
        for (i = 0; i < job.pieces; i++) {
            address chunk = job.chunks[i];
            if (chunk == address(0)) continue;
            address who = helper.maker(chunk);
            if (who == address(0)) {
                console2.log("This piece has no maker. Store it through ChunkBatch. Nothing was sent.");
                console2.log(chunk);
                revert("maker");
            }
            if (who != job.sender) {
                console2.log("These pieces were stored by a different account. Nothing was sent.");
                console2.log(who);
                revert("account");
            }
            if (payloadHash(chunk) != keccak256(sliceAt(job.image, i * CHUNK_MAX))) {
                console2.log("The progress file lists a piece that does not match this photograph. Nothing was sent.");
                console2.log(chunk);
                revert("progress");
            }
        }
    }

    function payloadHash(address chunk) internal view returns (bytes32) {
        bytes memory code = chunk.code;
        if (code.length < 2 || code[0] != 0x00) return bytes32(0);
        bytes memory body = new bytes(code.length - 1);
        for (uint256 i = 0; i < body.length; i++) body[i] = code[i + 1];
        return keccak256(body);
    }

    function assignOwn(Job memory job, bytes32[] memory want, bool[] memory taken, address chunk, bytes32 got)
        internal
        pure
        returns (bool)
    {
        if (got == bytes32(0) || chunk == address(0)) return false;
        for (uint256 i = 0; i < job.pieces; i++) {
            if (taken[i] || want[i] != got) continue;
            job.chunks[i] = chunk;
            taken[i] = true;
            return true;
        }
        return false;
    }

    function matchesUntaken(bytes32[] memory want, bool[] memory taken, bytes32 got) internal pure returns (bool) {
        if (got == bytes32(0)) return false;
        for (uint256 i = 0; i < want.length; i++) {
            if (!taken[i] && want[i] == got) return true;
        }
        return false;
    }

    /// PieceCreated logs from this batch helper. Raw CREATE addresses are ignored.
    /// A matching piece from another account is remembered and refused.
    function adopt(Job memory job) internal view {
        bytes32[] memory want = new bytes32[](job.pieces);
        bool[] memory taken = new bool[](job.pieces);
        address foreign;
        uint256 i;
        for (i = 0; i < job.pieces; i++) {
            want[i] = keccak256(sliceAt(job.image, i * CHUNK_MAX));
            if (job.chunks[i] == address(0)) continue;
            if (payloadHash(job.chunks[i]) != want[i]) {
                console2.log("The progress file lists a piece that does not match this photograph. Nothing was sent.");
                console2.log(job.chunks[i]);
                revert("progress");
            }
            taken[i] = true;
        }
        foreign = takePieceLogs(job, want, taken);
        takeOpenBooks(job, want, taken, foreign);
    }

    /// Public Sepolia nodes cap eth_getLogs at 50,000 blocks. Factory and batch
    /// were created in this block. Anvil and a later mainnet start at 0.
    function logFrom() internal view returns (uint256) {
        if (block.chainid == 11155111) return 12190877;
        return 0;
    }

    function takePieceLogs(Job memory job, bytes32[] memory want, bool[] memory taken)
        internal
        view
        returns (address foreign)
    {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = keccak256("PieceCreated(address,uint256,address)");
        VmSafe.EthGetLogs[] memory logs = vm.eth_getLogs(logFrom(), block.number, job.batch, topics);
        uint256 n;
        for (n = 0; n < logs.length; n++) {
            if (logs[n].topics.length < 4) continue;
            address payer = address(uint160(uint256(logs[n].topics[1])));
            address chunk = address(uint160(uint256(logs[n].topics[3])));
            bytes32 got = payloadHash(chunk);
            if (payer == job.sender) assignOwn(job, want, taken, chunk, got);
        }
        for (n = 0; n < logs.length; n++) {
            if (logs[n].topics.length < 4) continue;
            address payer = address(uint160(uint256(logs[n].topics[1])));
            if (payer == job.sender) continue;
            bytes32 got = payloadHash(address(uint160(uint256(logs[n].topics[3]))));
            if (matchesUntaken(want, taken, got)) return payer;
        }
    }

    function bookMatches(Job memory job, address book, bytes32[] memory want, bool[] memory taken)
        internal
        view
        returns (uint256 count)
    {
        IUploadBook opened = IUploadBook(book);
        uint256 n;
        if (book.code.length == 0) return 0;
        if (opened.artist() != job.home || opened.expected() != job.pieces) return 0;
        n = opened.chunkCount();
        if (n == 0 || n > job.pieces) return 0;
        for (uint256 i = 0; i < n; i++) {
            address chunk = opened.chunkAt(i);
            if (payloadHash(chunk) != want[i]) return 0;
            if (taken[i] && job.chunks[i] != chunk) return 0;
        }
        count = n;
    }

    function takeOpenBooks(Job memory job, bytes32[] memory want, bool[] memory taken, address foreign) internal view {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = keccak256("BookOpened(address,address,uint256)");
        VmSafe.EthGetLogs[] memory logs = vm.eth_getLogs(logFrom(), block.number, job.factory, topics);
        address best;
        uint256 bestCount;
        address foreignBook;
        uint256 n;
        for (n = 0; n < logs.length; n++) {
            if (logs[n].topics.length < 3 || logs[n].data.length < 32) continue;
            address book = address(uint160(uint256(logs[n].topics[1])));
            address artist = address(uint160(uint256(logs[n].topics[2])));
            uint256 count = abi.decode(logs[n].data, (uint256));
            uint256 matched;
            if (count != job.pieces || book.code.length == 0) continue;
            if (artist != job.home) {
                if (IUploadBook(book).chunkCount() > 0 && foreignBook == address(0)) {
                    if (foreignBookMatches(job, book, want)) foreignBook = artist;
                }
                continue;
            }
            matched = bookMatches(job, book, want, taken);
            if (matched > bestCount) {
                best = book;
                bestCount = matched;
            }
        }
        if (job.book != address(0)) {
            uint256 saved = bookMatches(job, job.book, want, taken);
            if (saved == 0) {
                console2.log("The progress file names a book that does not match this photograph. Nothing was sent.");
                revert("progress");
            }
            if (saved >= bestCount) {
                best = job.book;
                bestCount = saved;
            }
        }
        if (best != address(0)) {
            IUploadBook opened = IUploadBook(best);
            uint256 have = opened.chunkCount();
            for (n = 0; n < have; n++) {
                job.chunks[n] = opened.chunkAt(n);
                taken[n] = true;
            }
            job.book = best;
            if (opened.used()) {
                address plate = findPlate(job);
                if (plate != address(0)) job.plate = plate;
            }
        } else if (foreignBook != address(0)) {
            console2.log("These pieces were stored by a different account. Nothing was sent.");
            console2.log(foreignBook);
            revert("account");
        }
        if (foreign != address(0)) {
            for (n = 0; n < job.pieces; n++) {
                if (!taken[n]) {
                    console2.log("These pieces were stored by a different account. Nothing was sent.");
                    console2.log(foreign);
                    revert("account");
                }
            }
        }
    }

    function foreignBookMatches(Job memory job, address book, bytes32[] memory want) internal view returns (bool) {
        IUploadBook opened = IUploadBook(book);
        uint256 n = opened.chunkCount();
        if (opened.expected() != job.pieces || n == 0 || n > job.pieces) return false;
        for (uint256 i = 0; i < n; i++) {
            if (payloadHash(opened.chunkAt(i)) != want[i]) return false;
        }
        return true;
    }

    function load(Job memory job) internal view {
        job.chunks = new address[](job.pieces);
        if (!vm.exists(PROGRESS)) return;
        string memory json = vm.readFile(PROGRESS);
        if (
            json.readBytes32(".hash") != job.contentHash || json.readAddress(".factory") != job.factory
                || json.readAddress(".sender") != job.sender || json.readAddress(".batch") != job.batch
                || _savedHome(json, job.sender) != job.home
        ) {
            console2.log("broadcast/upload-progress.json is for a different photograph or a different OWNER. Move that file aside. Nothing was sent.");
            revert("progress");
        }
        address[] memory stored = json.readAddressArray(".chunks");
        require(stored.length <= job.pieces, "progress");
        uint256 i;
        bool skipped;
        for (i = 0; i < stored.length; i++) {
            if (stored[i] == address(0) || stored[i].code.length == 0) {
                skipped = true;
                continue;
            }
            if (!isChunk(stored[i])) {
                console2.log("The progress file lists a piece that is not one of these pieces. Nothing was sent.");
                console2.log(stored[i]);
                revert("progress");
            }
            {
                address who = IUploadBatch(job.batch).maker(stored[i]);
                if (who == address(0)) {
                    console2.log("This piece has no maker. Store it through ChunkBatch. Nothing was sent.");
                    console2.log(stored[i]);
                    revert("maker");
                }
                if (who != job.sender) {
                    console2.log("These pieces were stored by a different account. Nothing was sent.");
                    console2.log(who);
                    revert("account");
                }
            }
            job.chunks[i] = stored[i];
        }
        if (skipped) console2.log("A progress entry was never mined. That piece will be stored again.");
        job.done = stored.length;
        job.book = json.readAddress(".book");
        job.plate = json.readAddress(".plate");
        if (job.book != address(0) && job.book.code.length == 0) {
            console2.log("The progress file names a book that was never mined. A new book will be opened.");
            job.book = address(0);
        }
        if (job.plate != address(0) && job.plate.code.length == 0) {
            console2.log("The progress file names a plate that was never mined. It will be registered again.");
            job.plate = address(0);
        }
    }

    /// OWNER is the title wallet. Unix HOME is a filesystem path, so it is only
    /// treated as the owner when it is a 0x address (an older copied command).
    function ownerFromEnv(address sender) internal view returns (address) {
        if (vm.envExists("OWNER")) return vm.envAddress("OWNER");
        if (!vm.envExists("HOME")) return sender;
        string memory raw = vm.envString("HOME");
        if (bytes(raw).length != 42) return sender;
        return vm.parseAddress(raw);
    }

    /// A progress file from before OWNER existed belongs to the signer.
    function _savedHome(string memory json, address sender) internal view returns (address) {
        if (!json.keyExists(".home")) return sender;
        return json.readAddress(".home");
    }

    /// Written only while Forge is broadcasting. A dry run must not record addresses that were never mined.
    function save(Job memory job) internal {
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;
        if (!vm.exists("broadcast")) vm.createDir("broadcast", true);
        address[] memory stored = new address[](job.done);
        for (uint256 i = 0; i < job.done; i++) stored[i] = job.chunks[i];
        string memory key = "upload";
        key.serialize("hash", job.contentHash);
        key.serialize("factory", job.factory);
        key.serialize("sender", job.sender);
        key.serialize("home", job.home);
        key.serialize("batch", job.batch);
        key.serialize("book", job.book);
        key.serialize("plate", job.plate);
        string memory out = key.serialize("chunks", stored);
        vm.writeJson(out, PROGRESS);
    }

    function creationCode() internal view returns (bytes memory code) {
        bytes memory raw = bytes(vm.readFile("web/bytecode.js"));
        uint256 start;
        uint256 end;
        for (uint256 i = 0; i < raw.length; i++) {
            if (raw[i] != '"') continue;
            if (start == 0) start = i + 1;
            else {
                end = i;
                break;
            }
        }
        require(end > start && (end - start) % 2 == 0, "bytecode");
        bytes memory hexed = new bytes(end - start + 2);
        hexed[0] = "0";
        hexed[1] = "x";
        for (uint256 i = 0; i < end - start; i++) hexed[i + 2] = raw[start + i];
        code = vm.parseBytes(string(hexed));
        require(code.length > 32, "bytecode");
    }

    function sliceAt(bytes memory data, uint256 start) internal pure returns (bytes memory out) {
        uint256 len = data.length - start;
        if (len > CHUNK_MAX) len = CHUNK_MAX;
        require(len > 0, "piece");
        out = new bytes(len);
        uint256 words = (len + 31) / 32;
        uint256 src;
        uint256 dst;
        assembly {
            src := add(add(data, 32), start)
            dst := add(out, 32)
        }
        for (uint256 i = 0; i < words; i++) {
            assembly {
                mstore(add(dst, mul(i, 32)), mload(add(src, mul(i, 32))))
            }
        }
    }

    function isChunk(address chunk) internal view returns (bool) {
        bytes memory code = chunk.code;
        return code.length > 1 && code[0] == 0x00;
    }

    /// Same PNG rules as the plate: signature, IHDR, 32 or 48 square, 8-bit gray or truecolor.
    function checkThumb(bytes memory t) internal pure {
        uint256 n = t.length;
        require(n >= 29 && n <= 4096, "thumb");
        require(
            t[0] == 0x89 && t[1] == 0x50 && t[2] == 0x4e && t[3] == 0x47 && t[4] == 0x0d && t[5] == 0x0a && t[6] == 0x1a
                && t[7] == 0x0a,
            "thumb"
        );
        require(t[12] == "I" && t[13] == "H" && t[14] == "D" && t[15] == "R", "thumb");
        uint32 w = (uint32(uint8(t[16])) << 24) | (uint32(uint8(t[17])) << 16) | (uint32(uint8(t[18])) << 8)
            | uint32(uint8(t[19]));
        uint32 h = (uint32(uint8(t[20])) << 24) | (uint32(uint8(t[21])) << 16) | (uint32(uint8(t[22])) << 8)
            | uint32(uint8(t[23]));
        require((w == 48 && h == 48) || (w == 32 && h == 32), "thumb");
        require(uint8(t[24]) == 8, "thumb");
        require(uint8(t[25]) == 0 || uint8(t[25]) == 2, "thumb");
        require(uint8(t[26]) == 0 && uint8(t[27]) == 0 && uint8(t[28]) == 0, "thumb");
    }

    function checkText(string memory s, uint256 minLen, uint256 maxLen) internal pure {
        bytes memory b = bytes(s);
        require(b.length >= minLen && b.length <= maxLen, "text");
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            require(c >= 0x20 && c <= 0x7e, "text");
            require(c != '"' && c != "\\" && c != "<" && c != ">" && c != "&", "text");
        }
    }

    function sameHash(string memory text, bytes32 hash) internal pure returns (bool) {
        bytes memory raw = bytes(text);
        if (raw.length != 66 || raw[0] != "0" || (raw[1] != "x" && raw[1] != "X")) return false;
        bytes memory hexed = new bytes(66);
        hexed[0] = "0";
        hexed[1] = "x";
        for (uint256 i = 0; i < 64; i++) {
            bytes1 c = raw[i + 2];
            if (c >= "A" && c <= "F") c = bytes1(uint8(c) + 32);
            if (!((c >= "0" && c <= "9") || (c >= "a" && c <= "f"))) return false;
            hexed[i + 2] = c;
        }
        return vm.parseBytes32(string(hexed)) == hash;
    }
}
