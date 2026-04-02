# PactDAO

A simple on-chain DAO on Stellar. Pay XLM dues to join. Members submit text proposals with deadlines. Everyone votes YES or NO. Majority wins. Results are finalized on-chain by anyone after the deadline. Treasury accumulates from membership dues.

## Live Links

| | |
|---|---|
| **Frontend** | `https://pactdao.vercel.app` |
| **GitHub** | `https://github.com/YOUR_USERNAME/pactdao` |
| **Contract** | `https://stellar.expert/explorer/testnet/contract/CONTRACT_ID` |
| **Proof TX** | `https://stellar.expert/explorer/testnet/tx/TX_HASH` |

## How It Works

1. **Founder** deploys and initializes the DAO with name, description, and dues amount
2. **Anyone** joins by paying XLM dues — funds go to treasury
3. **Members** submit text proposals with a voting deadline
4. **Members** vote YES or NO (one vote per member per proposal)
5. **Anyone** calls `finalize()` after the deadline — majority wins
6. **Founder** can withdraw from treasury

## Contract Functions

```rust
initialize(founder, name, description, dues: i128, xlm_token)
join(applicant)                              // pays dues, joins DAO
propose(proposer, title, body, duration_ledgers) -> u64
vote(member, proposal_id, approve: bool)
finalize(proposal_id)                        // permissionless post-deadline
withdraw_treasury(founder, amount: i128)
get_config() -> DaoConfig
get_proposal(id) -> Proposal
get_member(addr) -> Option<Member>
has_voted(proposal_id, member) -> bool
member_count() -> u32
proposal_count() -> u64
treasury() -> i128
```

## Stack

| Layer | Tech |
|---|---|
| Contract | Rust + Soroban SDK v22 |
| Network | Stellar Testnet |
| Frontend | React 18 + Vite |
| Wallet | Freighter API 6.0.1 |
| Stellar SDK | 14.6.1 |
| Hosting | Vercel |

## Run Locally

```bash
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
cd frontend && npm install && npm run dev
```
