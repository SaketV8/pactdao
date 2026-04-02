#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
gh repo create pactdao --public \
  --description "PactDAO — XLM membership DAO with proposals and on-chain voting. Stellar Soroban." \
  --source "${ROOT}" --remote origin --push
ENV="${ROOT}/frontend/.env"
CONTRACT_ID=$(grep VITE_CONTRACT_ID "$ENV" | cut -d= -f2 | tr -d '[:space:]')
XLM_TOKEN=$(grep VITE_XLM_TOKEN "$ENV" | cut -d= -f2 | tr -d '[:space:]')
USER=$(gh api user -q .login)
gh secret set VITE_CONTRACT_ID --body "$CONTRACT_ID" --repo "$USER/pactdao"
gh secret set VITE_XLM_TOKEN   --body "$XLM_TOKEN"   --repo "$USER/pactdao"
cd "${ROOT}/frontend" && vercel --prod --yes
echo "✓ PactDAO published!"
