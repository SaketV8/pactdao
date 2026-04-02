import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, getPublicKey, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID       || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN         || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL   || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

export async function connectWallet() {
  if (!(await isConnected())) throw new Error('Freighter not installed.')
  return await getPublicKey()
}

async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(60).build()
  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const signedXdr = await signTransaction(prepared.toXDR(), { networkPassphrase: NET, network: 'TESTNET' })
  const signed = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NET)
  const sent = await rpc.sendTransaction(signed)
  return pollTx(sent.hash)
}

async function pollTx(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(hash)
    if (r.status === 'SUCCESS') return hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed on-chain')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction timed out')
}

async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(30).build()
  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

const tc = () => new StellarSdk.Contract(CONTRACT_ID)

export async function initializeDao(founder, name, description, duesXlm) {
  const dues = Math.ceil(duesXlm * 10_000_000)
  return sendTx(founder, tc().call(
    'initialize',
    StellarSdk.Address.fromString(founder).toScVal(),
    StellarSdk.xdr.ScVal.scvString(name),
    StellarSdk.xdr.ScVal.scvString(description),
    new StellarSdk.XdrLargeInt('i128', BigInt(dues)).toI128(),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

export async function joinDao(applicant, dues) {
  const stroops = Math.ceil(dues * 10_000_000)
  await sendTx(applicant, new StellarSdk.Contract(XLM_TOKEN).call(
    'approve',
    StellarSdk.Address.fromString(applicant).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
  return sendTx(applicant, tc().call(
    'join',
    StellarSdk.Address.fromString(applicant).toScVal(),
  ))
}

export async function createProposal(proposer, title, body, durationLedgers) {
  return sendTx(proposer, tc().call(
    'propose',
    StellarSdk.Address.fromString(proposer).toScVal(),
    StellarSdk.xdr.ScVal.scvString(title),
    StellarSdk.xdr.ScVal.scvString(body),
    StellarSdk.xdr.ScVal.scvU32(durationLedgers),
  ))
}

export async function castVote(member, proposalId, approve) {
  return sendTx(member, tc().call(
    'vote',
    StellarSdk.Address.fromString(member).toScVal(),
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
    StellarSdk.xdr.ScVal.scvBool(approve),
  ))
}

export async function finalizeProposal(caller, proposalId) {
  return sendTx(caller, tc().call(
    'finalize',
    StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
  ))
}

export async function getConfig() {
  try { return await readContract(tc().call('get_config')) }
  catch { return null }
}

export async function getProposal(id) {
  try {
    return await readContract(tc().call(
      'get_proposal',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(id)))
    ))
  } catch { return null }
}

export async function getMember(address) {
  try {
    return await readContract(tc().call(
      'get_member',
      StellarSdk.Address.fromString(address).toScVal(),
    ))
  } catch { return null }
}

export async function checkHasVoted(proposalId, member) {
  try {
    return await readContract(tc().call(
      'has_voted',
      StellarSdk.xdr.ScVal.scvU64(new StellarSdk.xdr.Uint64(BigInt(proposalId))),
      StellarSdk.Address.fromString(member).toScVal(),
    ))
  } catch { return false }
}

export async function getMemberCount() {
  try { return Number(await readContract(tc().call('member_count'))) }
  catch { return 0 }
}

export async function getProposalCount() {
  try { return Number(await readContract(tc().call('proposal_count'))) }
  catch { return 0 }
}

export async function getTreasury() {
  try { return Number(await readContract(tc().call('treasury'))) }
  catch { return 0 }
}

export const xlm   = s => (Number(s) / 10_000_000).toFixed(2)
export const short = a => a ? `${a.toString().slice(0,5)}…${a.toString().slice(-4)}` : '—'
export function ledgersToTime(ledgers) {
  const s = ledgers * 5
  if (s <= 0)    return 'Ended'
  if (s < 3600)  return `${Math.floor(s/60)}m left`
  if (s < 86400) return `${Math.floor(s/3600)}h left`
  return `${Math.floor(s/86400)}d left`
}
export { CONTRACT_ID }
