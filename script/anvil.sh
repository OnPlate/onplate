#!/bin/bash
# Local chain. Anvil account 0 is unlocked on that node. Do not pass a key.
set -euo pipefail
cd "$(dirname "$0")/.."
if ss -ltn | awk '{print $4}' | grep -Eq '[:.]8545$'; then
  echo "port 8545 is in use" >&2
  exit 1
fi
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 >/tmp/onplate-anvil.log 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  if cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null
from=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export ONPLATE_DEV_BPS="${ONPLATE_DEV_BPS:-300}"
export ONPLATE_ARTIST_BPS="${ONPLATE_ARTIST_BPS:-700}"
export SENDER="$from"
forge script script/DeployFactory.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender "$from" --broadcast --gas-estimate-multiplier 100
factory=$(node -e '
const j = require("./broadcast/DeployFactory.s.sol/31337/run-latest.json");
const tx = j.transactions.find((row) => row.contractName === "OnPlateFactory");
if (!tx) process.exit(1);
process.stdout.write(tx.contractAddress);
')
echo "factory $factory"
node script/build-fallback.js --chain anvil --factory "$factory"
FACTORY="$factory" forge script script/DeployPage.s.sol --rpc-url http://127.0.0.1:8545 --unlocked --sender "$from" --broadcast
cast send "$factory" "setAuthorized(address,bool)" 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 true --unlocked --from "$from" --rpc-url http://127.0.0.1:8545 >/dev/null
node script/anvil-flow.js --factory "$factory"
