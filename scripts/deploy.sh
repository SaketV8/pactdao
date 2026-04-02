#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}PACTDAO — DEPLOY${NC}"

for KEY in founder member1 member2; do
  stellar keys generate --global ${KEY} --network testnet 2>/dev/null || true
done
stellar keys fund founder --network testnet
stellar keys fund member1 --network testnet
FOUNDER=$(stellar keys address founder)
MEMBER1=$(stellar keys address member1)
XLM_TOKEN=$(stellar contract id asset --asset native --network testnet)
echo -e "${GREEN}✓ Founder: ${FOUNDER}${NC}"
echo -e "${GREEN}✓ Member1: ${MEMBER1}${NC}"

cd contract
cargo build --target wasm32-unknown-unknown --release
WASM="target/wasm32-unknown-unknown/release/pactdao.wasm"
cd ..

WASM_HASH=$(stellar contract upload --network testnet --source founder --wasm contract/${WASM})
CONTRACT_ID=$(stellar contract deploy --network testnet --source founder --wasm-hash ${WASM_HASH})
echo -e "${GREEN}✓ CONTRACT_ID: ${CONTRACT_ID}${NC}"

# Initialize DAO (dues: 5 XLM)
stellar contract invoke --network testnet --source founder --id ${CONTRACT_ID} \
  -- initialize \
  --founder ${FOUNDER} \
  --name '"Stellar Builders DAO"' \
  --description '"A decentralised collective for Stellar ecosystem builders. Join, propose, vote."' \
  --dues 50000000 \
  --xlm_token ${XLM_TOKEN} 2>&1 || true

# Member1 joins
stellar contract invoke --network testnet --source member1 --id ${XLM_TOKEN} \
  -- approve --from ${MEMBER1} --spender ${CONTRACT_ID} \
  --amount 100000000 --expiration_ledger 3110400 2>&1 || true

stellar contract invoke --network testnet --source member1 --id ${CONTRACT_ID} \
  -- join --applicant ${MEMBER1} 2>&1 || true

# Founder creates proof proposal
TX_RESULT=$(stellar contract invoke \
  --network testnet --source founder --id ${CONTRACT_ID} \
  -- propose \
  --proposer ${FOUNDER} \
  --title '"Fund open-source Soroban developer tooling"' \
  --body '"Allocate 20 XLM from treasury to fund development of better testing tools and documentation for Soroban smart contracts."' \
  --duration_ledgers 17280 2>&1)

TX_HASH=$(echo "$TX_RESULT" | grep -oP '[0-9a-f]{64}' | head -1)
echo -e "${GREEN}✓ Proof TX: ${TX_HASH}${NC}"

cat > frontend/.env << EOF
VITE_CONTRACT_ID=${CONTRACT_ID}
VITE_XLM_TOKEN=${XLM_TOKEN}
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
EOF

echo ""
echo -e "${CYAN}CONTRACT : ${CONTRACT_ID}${NC}"
echo -e "${CYAN}PROOF TX : ${TX_HASH}${NC}"
echo -e "${CYAN}EXPLORER : https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}${NC}"
echo "Next: cd frontend && npm install && npm run dev"
