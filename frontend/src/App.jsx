import { useState, useEffect } from 'react'
import {
  connectWallet, initializeDao, joinDao, createProposal, castVote, finalizeProposal,
  getConfig, getProposal, getMember, checkHasVoted,
  getMemberCount, getProposalCount, getTreasury,
  xlm, short, ledgersToTime, CONTRACT_ID,
} from './lib/stellar'

// ── Vote bar ───────────────────────────────────────────────────────────────
function VoteBar({ yes, no }) {
  const total = yes + no
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 50
  const noPct  = 100 - yesPct
  return (
    <div className="vote-bar-wrap">
      <div className="vote-bar">
        <div className="vb-yes" style={{ width: `${yesPct}%` }} />
        <div className="vb-no"  style={{ width: `${noPct}%` }} />
      </div>
      <div className="vb-labels">
        <span className="vbl-yes">✓ {yes} ({yesPct}%)</span>
        <span className="vbl-no">{noPct}% ({no}) ✗</span>
      </div>
    </div>
  )
}

// ── Status pill ────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    Active:    { label: 'ACTIVE',    cls: 'sp-active'    },
    Passed:    { label: 'PASSED',    cls: 'sp-passed'    },
    Failed:    { label: 'FAILED',    cls: 'sp-failed'    },
    Cancelled: { label: 'CANCELLED', cls: 'sp-cancelled' },
  }
  const s = map[status] || { label: status, cls: '' }
  return <span className={`status-pill ${s.cls}`}>{s.label}</span>
}

// ── Proposal card ──────────────────────────────────────────────────────────
function ProposalCard({ proposal, currentLedger, wallet, isMember, onAction }) {
  const [busy,      setBusy]      = useState(false)
  const [voted,     setVoted]     = useState(false)
  const [expanded,  setExpanded]  = useState(false)

  const ledgersLeft = Math.max(0, Number(proposal.deadline) - currentLedger)
  const isLive      = proposal.status === 'Active' && ledgersLeft > 0
  const canFinalize = proposal.status === 'Active' && ledgersLeft === 0
  const total       = Number(proposal.yes_votes) + Number(proposal.no_votes)

  useEffect(() => {
    if (wallet) checkHasVoted(proposal.id, wallet).then(setVoted)
  }, [wallet, proposal.id])

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash, refresh: true })
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className={`proposal-card ${!isLive && proposal.status === 'Active' ? 'pc-ended' : ''}`}>
      <div className="pc-header" onClick={() => setExpanded(e => !e)} style={{ cursor:'pointer' }}>
        <div className="pc-left">
          <div className="pc-id">#{proposal.id?.toString().padStart(3,'0')}</div>
          <StatusPill status={proposal.status} />
          {isLive && <span className="pc-timer">{ledgersToTime(ledgersLeft)}</span>}
        </div>
        <div className="pc-toggle">{expanded ? '▲' : '▼'}</div>
      </div>

      <h3 className="pc-title">{proposal.title}</h3>

      {expanded && (
        <div className="pc-body">
          <p className="pc-body-text">{proposal.body}</p>
        </div>
      )}

      <div className="pc-meta">
        <span>By {short(proposal.proposer)}</span>
        <span>{total} votes cast</span>
      </div>

      <VoteBar yes={Number(proposal.yes_votes)} no={Number(proposal.no_votes)} />

      {/* Result banners */}
      {proposal.status === 'Passed' && (
        <div className="result-banner rb-passed">✓ Proposal Passed</div>
      )}
      {proposal.status === 'Failed' && (
        <div className="result-banner rb-failed">✗ Proposal Failed</div>
      )}

      {/* Actions */}
      {wallet && isMember && isLive && !voted && (
        <div className="pc-vote-actions">
          <button className="btn-vote-yes" disabled={busy}
            onClick={() => handle(() => castVote(wallet, proposal.id, true), 'Voted YES ✓')}>
            {busy ? '…' : '✓ YES'}
          </button>
          <button className="btn-vote-no" disabled={busy}
            onClick={() => handle(() => castVote(wallet, proposal.id, false), 'Voted NO ✗')}>
            {busy ? '…' : '✗ NO'}
          </button>
        </div>
      )}

      {wallet && voted && isLive && (
        <div className="voted-tag">✓ You voted on this proposal</div>
      )}

      {wallet && canFinalize && (
        <button className="btn-finalize" disabled={busy}
          onClick={() => handle(() => finalizeProposal(wallet, proposal.id), 'Proposal finalized!')}>
          {busy ? '…' : 'Finalize Result'}
        </button>
      )}
    </div>
  )
}

// ── Propose form ───────────────────────────────────────────────────────────
function ProposeForm({ wallet, onProposed }) {
  const [title, setTitle] = useState('')
  const [body,  setBody]  = useState('')
  const [days,  setDays]  = useState('3')
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState('')

  const ledgers = Math.round(parseFloat(days || 1) * 17_280)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const hash = await createProposal(wallet, title, body, ledgers)
      onProposed(hash)
      setTitle(''); setBody('')
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="propose-form" onSubmit={handleSubmit}>
      <div className="pf-title">NEW PROPOSAL</div>
      <div className="pf-field">
        <label>TITLE</label>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="What are you proposing?"
          maxLength={80} required disabled={busy} />
      </div>
      <div className="pf-field">
        <label>BODY</label>
        <textarea value={body} onChange={e => setBody(e.target.value)}
          placeholder="Describe the proposal in detail. What should the DAO do, and why?"
          maxLength={500} rows={5} required disabled={busy} />
        <span className="pf-chars">{body.length}/500</span>
      </div>
      <div className="pf-field">
        <label>VOTING DURATION</label>
        <div className="dur-row">
          {['1','3','7','14'].map(d => (
            <button key={d} type="button"
              className={`dur-btn ${days === d ? 'dur-active' : ''}`}
              onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
        <span className="pf-hint">≈ {ledgers.toLocaleString()} ledgers</span>
      </div>
      {err && <p className="pf-err">{err}</p>}
      <button type="submit" className="btn-propose"
        disabled={busy || !title || !body}>
        {busy ? 'Submitting…' : 'Submit Proposal'}
      </button>
    </form>
  )
}

function SetupDaoForm({ wallet, onInitialized }) {
  const [name, setName] = useState('Stellar Builders DAO')
  const [description, setDescription] = useState('A decentralised collective for Stellar ecosystem builders.')
  const [dues, setDues] = useState('5')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!wallet) return
    setBusy(true); setErr('')
    try {
      const hash = await initializeDao(wallet, name, description, parseFloat(dues))
      onInitialized(hash)
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="form-wrap">
      <form className="propose-form" onSubmit={handleSubmit}>
        <div className="pf-title">INITIALIZE DAO</div>
        <div className="pf-field">
          <label>DAO NAME</label>
          <input value={name} onChange={e => setName(e.target.value)}
            maxLength={80} required disabled={busy} />
        </div>
        <div className="pf-field">
          <label>DESCRIPTION</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            maxLength={500} rows={4} disabled={busy} />
        </div>
        <div className="pf-field">
          <label>MEMBERSHIP DUES (XLM)</label>
          <input type="number" min="1" step="0.1"
            value={dues} onChange={e => setDues(e.target.value)}
            required disabled={busy} />
        </div>
        {err && <p className="pf-err">{err}</p>}
        <button type="submit" className="btn-propose" disabled={busy || !name}>
          {busy ? 'Initializing…' : 'Initialize DAO'}
        </button>
      </form>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,        setWallet]        = useState(null)
  const [config,        setConfig_]       = useState(null)
  const [member,        setMember]        = useState(null)
  const [proposals,     setProposals]     = useState([])
  const [memberCount,   setMemberCount]   = useState(0)
  const [treasury,      setTreasury]      = useState(0)
  const [currentLedger, setCurrentLedger] = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [tab,           setTab]           = useState('proposals')
  const [toast,         setToast]         = useState(null)
  const [joiningBusy,   setJoiningBusy]   = useState(false)

  const isMember = !!member

  const loadData = async () => {
    setLoading(true)
    try {
      const [cfg, mc, tr, pc] = await Promise.all([
        getConfig(), getMemberCount(), getTreasury(), getProposalCount()
      ])
      setConfig_(cfg); setMemberCount(mc); setTreasury(tr)

      // Load recent proposals
      const ids = []
      for (let i = pc; i >= Math.max(1, pc - 9); i--) ids.push(i)
      const loaded = await Promise.allSettled(ids.map(id => getProposal(id)))
      setProposals(loaded.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value))

      // Current ledger
      try {
        const resp = await fetch(
          (import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org').trim(),
          { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({jsonrpc:'2.0',id:1,method:'getLedgers',params:{limit:1}}) }
        ).then(r => r.json())
        if (resp.result?.ledgers?.[0]?.sequence) setCurrentLedger(resp.result.ledgers[0].sequence)
      } catch {}
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    if (wallet) getMember(wallet).then(m => setMember(m || null))
  }, [wallet])

  const handleConnect = async () => {
    try {
      const addr = await connectWallet()
      setWallet(addr)
      getMember(addr).then(m => setMember(m || null))
    } catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
  }

  const handleJoin = async () => {
    if (!wallet || !config) return
    setJoiningBusy(true)
    try {
      await joinDao(wallet, Number(config.dues) / 10_000_000)
      showToast(true, `Welcome to ${config.name}! 🎉`)
      getMember(wallet).then(m => setMember(m || null))
      loadData()
    } catch (e) { showToast(false, e.message) }
    finally { setJoiningBusy(false) }
  }

  const handleAction = ({ ok, msg, hash, refresh }) => {
    showToast(ok, msg, hash)
    if (ok && refresh) loadData()
  }

  const handleProposed = (hash) => {
    showToast(true, 'Proposal submitted!', hash)
    setTab('proposals')
    loadData()
  }

  const liveCount = proposals.filter(p => p.status === 'Active').length

  if (!config) {
    return (
      <div className="app">
        <header className="header">
          <div className="brand">
            <div className="brand-icon">◎</div>
            <div>
              <div className="brand-name">PactDAO</div>
              <div className="brand-tag">on-chain governance · stellar</div>
            </div>
          </div>
          <div className="header-right">
            {wallet
              ? <div className="wallet-pill"><span className="wdot"/>{short(wallet)}</div>
              : <button className="btn-connect" onClick={handleConnect}>Connect</button>
            }
          </div>
        </header>
        <main className="main">
          {!wallet ? (
            <div className="gate-prompt">
              <div className="gp-icon">◎</div>
              <p>Connect your wallet to initialize this DAO.</p>
              <button className="btn-connect-lg" onClick={handleConnect}>Connect Freighter</button>
            </div>
          ) : (
            <SetupDaoForm
              wallet={wallet}
              onInitialized={(hash) => {
                showToast(true, 'DAO initialized!', hash)
                loadData()
              }}
            />
          )}
        </main>
        {toast && (
          <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
            <span>{toast.msg}</span>
            {toast.hash && (
              <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
                target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="brand">
          <div className="brand-icon">◎</div>
          <div>
            <div className="brand-name">{config?.name || 'PactDAO'}</div>
            <div className="brand-tag">on-chain governance · stellar</div>
          </div>
        </div>

        <div className="header-stats">
          <div className="hs"><span className="hs-n">{memberCount}</span><span className="hs-l">MEMBERS</span></div>
          <div className="hs-div"/>
          <div className="hs"><span className="hs-n">{liveCount}</span><span className="hs-l">LIVE VOTES</span></div>
          <div className="hs-div"/>
          <div className="hs"><span className="hs-n">{xlm(treasury)}</span><span className="hs-l">TREASURY</span></div>
        </div>

        <div className="header-right">
          {wallet && !isMember && (
            <button className="btn-join" onClick={handleJoin} disabled={joiningBusy}>
              {joiningBusy ? 'Joining…' : `Join · ${xlm(config?.dues || 0)} XLM`}
            </button>
          )}
          {wallet
            ? <div className="wallet-pill">
                <span className="wdot"/>
                {short(wallet)}
                {isMember && <span className="member-badge">MEMBER</span>}
              </div>
            : <button className="btn-connect" onClick={handleConnect}>Connect</button>
          }
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        {[
          { id:'proposals', label:'Proposals'     },
          { id:'propose',   label:'+ New Proposal' },
          { id:'about',     label:'About DAO'      },
        ].map(t => (
          <button key={t.id}
            className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <button className="tab-refresh" onClick={loadData}>↻</button>
        <a className="tab-contract"
          href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">Contract ↗</a>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && (
            <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
              target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>
          )}
        </div>
      )}

      <main className="main">
        {/* ── Proposals ── */}
        {tab === 'proposals' && (
          loading ? (
            <div className="skeleton-list">
              {[1,2,3].map(i => <div key={i} className="proposal-skeleton"/>)}
            </div>
          ) : proposals.length === 0 ? (
            <div className="empty-state">
              <div className="es-icon">◎</div>
              <div className="es-title">No proposals yet.</div>
              {isMember && (
                <button className="btn-first-prop" onClick={() => setTab('propose')}>
                  Create First Proposal
                </button>
              )}
            </div>
          ) : (
            <div className="proposals-list">
              {proposals.map(p => (
                <ProposalCard key={p.id?.toString()} proposal={p}
                  currentLedger={currentLedger} wallet={wallet}
                  isMember={isMember} onAction={handleAction} />
              ))}
            </div>
          )
        )}

        {/* ── Propose ── */}
        {tab === 'propose' && (
          <div className="form-wrap">
            {!wallet ? (
              <div className="gate-prompt">
                <div className="gp-icon">◎</div>
                <p>Connect your wallet to submit a proposal.</p>
                <button className="btn-connect-lg" onClick={handleConnect}>Connect Freighter</button>
              </div>
            ) : !isMember ? (
              <div className="gate-prompt">
                <div className="gp-icon">◎</div>
                <p>Only DAO members can submit proposals.</p>
                <button className="btn-join-lg" onClick={handleJoin} disabled={joiningBusy}>
                  {joiningBusy ? 'Joining…' : `Join for ${xlm(config?.dues || 0)} XLM`}
                </button>
              </div>
            ) : (
              <ProposeForm wallet={wallet} onProposed={handleProposed} />
            )}
          </div>
        )}

        {/* ── About ── */}
        {tab === 'about' && (
          <div className="about-page">
            <div className="about-card">
              <div className="ac-icon">◎</div>
              <h2 className="ac-name">{config?.name}</h2>
              <p className="ac-desc">{config?.description}</p>
              <div className="ac-stats">
                <div className="acs-item">
                  <span className="acs-val">{memberCount}</span>
                  <span className="acs-label">Members</span>
                </div>
                <div className="acs-div"/>
                <div className="acs-item">
                  <span className="acs-val">{xlm(config?.dues || 0)} XLM</span>
                  <span className="acs-label">Membership Dues</span>
                </div>
                <div className="acs-div"/>
                <div className="acs-item">
                  <span className="acs-val">{xlm(treasury)} XLM</span>
                  <span className="acs-label">Treasury</span>
                </div>
              </div>
              <div className="ac-rules">
                <div className="ar-title">HOW IT WORKS</div>
                <div className="ar-rule">1. Pay {xlm(config?.dues || 0)} XLM dues to join</div>
                <div className="ar-rule">2. Any member can submit a text proposal</div>
                <div className="ar-rule">3. Members vote YES or NO before the deadline</div>
                <div className="ar-rule">4. Majority wins — anyone finalizes post-deadline</div>
                <div className="ar-rule">5. One vote per member per proposal</div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>PactDAO · Stellar Testnet · Soroban</span>
        <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
          target="_blank" rel="noreferrer">Contract ↗</a>
      </footer>
    </div>
  )
}
