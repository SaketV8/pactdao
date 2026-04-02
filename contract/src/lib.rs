#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec, token,
};

// Members join by paying XLM dues. Members create and vote on text proposals.
// Proposals pass by simple majority of cast votes after deadline.

const MIN_DUES:      i128 = 10_000_000;  // 1 XLM minimum
const MAX_TITLE:     u32  = 80;
const MAX_BODY:      u32  = 500;
const MAX_PROPOSALS: u32  = 200;

#[contracttype]
#[derive(Clone)]
pub struct Member {
    pub address:    Address,
    pub joined_at:  u32,
    pub dues_paid:  i128,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Failed,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id:          u64,
    pub proposer:    Address,
    pub title:       String,
    pub body:        String,
    pub yes_votes:   u32,
    pub no_votes:    u32,
    pub deadline:    u32,
    pub status:      ProposalStatus,
    pub created_at:  u32,
}

#[contracttype]
pub enum DataKey {
    Config,              // DaoConfig
    Member(Address),
    MemberCount,
    Proposal(u64),
    ProposalCount,
    Voted(u64, Address), // has this member voted on proposal N?
    Treasury,            // i128 total XLM held
}

#[contracttype]
#[derive(Clone)]
pub struct DaoConfig {
    pub name:        String,
    pub description: String,
    pub dues:        i128,
    pub xlm_token:   Address,
    pub founder:     Address,
}

fn is_member(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().has(&DataKey::Member(addr.clone()))
}

#[contract]
pub struct PactDaoContract;

#[contractimpl]
impl PactDaoContract {
    /// Founder initializes the DAO
    pub fn initialize(
        env: Env,
        founder: Address,
        name: String,
        description: String,
        dues: i128,
        xlm_token: Address,
    ) {
        founder.require_auth();
        assert!(!env.storage().instance().has(&DataKey::Config), "Already initialized");
        assert!(name.len() > 0 && name.len() <= MAX_TITLE, "Name required");
        assert!(dues >= MIN_DUES, "Min dues 1 XLM");

        let config = DaoConfig { name, description, dues, xlm_token: xlm_token.clone(), founder: founder.clone() };
        env.storage().instance().set(&DataKey::Config, &config);

        // Founder auto-joins for free
        let member = Member { address: founder.clone(), joined_at: env.ledger().sequence(), dues_paid: 0 };
        env.storage().persistent().set(&DataKey::Member(founder), &member);
        env.storage().instance().set(&DataKey::MemberCount, &1u32);
        env.storage().instance().set(&DataKey::Treasury, &0i128);
    }

    /// Anyone joins by paying dues
    pub fn join(env: Env, applicant: Address) {
        applicant.require_auth();
        assert!(!is_member(&env, &applicant), "Already a member");

        let config: DaoConfig = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        let token_client = token::Client::new(&env, &config.xlm_token);
        token_client.transfer(&applicant, &env.current_contract_address(), &config.dues);

        let member = Member { address: applicant.clone(), joined_at: env.ledger().sequence(), dues_paid: config.dues };
        env.storage().persistent().set(&DataKey::Member(applicant.clone()), &member);

        let count: u32 = env.storage().instance().get(&DataKey::MemberCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::MemberCount, &(count + 1));

        let treasury: i128 = env.storage().instance().get(&DataKey::Treasury).unwrap_or(0i128);
        env.storage().instance().set(&DataKey::Treasury, &(treasury + config.dues));

        env.events().publish((symbol_short!("joined"),), (applicant, config.dues));
    }

    /// Member creates a proposal
    pub fn propose(
        env: Env,
        proposer: Address,
        title: String,
        body: String,
        duration_ledgers: u32,
    ) -> u64 {
        proposer.require_auth();
        assert!(is_member(&env, &proposer), "Not a member");
        assert!(title.len() > 0 && title.len() <= MAX_TITLE, "Title required");
        assert!(body.len() > 0 && body.len() <= MAX_BODY, "Body required");
        assert!(duration_ledgers >= 100 && duration_ledgers <= 535_680, "Bad duration");

        let count: u64 = env.storage().instance()
            .get(&DataKey::ProposalCount).unwrap_or(0u64);
        assert!(count < MAX_PROPOSALS as u64, "Proposal limit");
        let id = count + 1;

        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            title,
            body,
            yes_votes: 0,
            no_votes: 0,
            deadline: env.ledger().sequence() + duration_ledgers,
            status: ProposalStatus::Active,
            created_at: env.ledger().sequence(),
        };

        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::ProposalCount, &id);
        env.events().publish((symbol_short!("proposed"),), (id, proposer));
        id
    }

    /// Member votes on an active proposal
    pub fn vote(env: Env, member: Address, proposal_id: u64, approve: bool) {
        member.require_auth();
        assert!(is_member(&env, &member), "Not a member");

        let vote_key = DataKey::Voted(proposal_id, member.clone());
        assert!(!env.storage().persistent().has(&vote_key), "Already voted");

        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("Not found");
        assert!(proposal.status == ProposalStatus::Active, "Not active");
        assert!(env.ledger().sequence() <= proposal.deadline, "Deadline passed");

        if approve { proposal.yes_votes += 1; } else { proposal.no_votes += 1; }

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.storage().persistent().set(&vote_key, &approve);
        env.events().publish((symbol_short!("voted"),), (proposal_id, member, approve));
    }

    /// Anyone finalizes a proposal after deadline
    pub fn finalize(env: Env, proposal_id: u64) {
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id)).expect("Not found");
        assert!(proposal.status == ProposalStatus::Active, "Not active");
        assert!(env.ledger().sequence() > proposal.deadline, "Not ended");

        proposal.status = if proposal.yes_votes > proposal.no_votes {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Failed
        };

        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        env.events().publish((symbol_short!("finald"),), (proposal_id, proposal.status == ProposalStatus::Passed));
    }

    /// Founder withdraws treasury
    pub fn withdraw_treasury(env: Env, founder: Address, amount: i128) {
        founder.require_auth();
        let config: DaoConfig = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        assert!(config.founder == founder, "Not founder");

        let treasury: i128 = env.storage().instance().get(&DataKey::Treasury).unwrap_or(0i128);
        assert!(amount <= treasury, "Insufficient treasury");

        let token_client = token::Client::new(&env, &config.xlm_token);
        token_client.transfer(&env.current_contract_address(), &founder, &amount);
        env.storage().instance().set(&DataKey::Treasury, &(treasury - amount));
    }

    // ── Reads ──────────────────────────────────────────────────────────────
    pub fn get_config(env: Env) -> DaoConfig {
        env.storage().instance().get(&DataKey::Config).expect("Not initialized")
    }

    pub fn get_proposal(env: Env, id: u64) -> Proposal {
        env.storage().persistent().get(&DataKey::Proposal(id)).expect("Not found")
    }

    pub fn get_member(env: Env, addr: Address) -> Option<Member> {
        env.storage().persistent().get(&DataKey::Member(addr))
    }

    pub fn has_voted(env: Env, proposal_id: u64, member: Address) -> bool {
        env.storage().persistent().has(&DataKey::Voted(proposal_id, member))
    }

    pub fn member_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::MemberCount).unwrap_or(0)
    }

    pub fn proposal_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0)
    }

    pub fn treasury(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Treasury).unwrap_or(0i128)
    }
}
