'use client';
import { useEffect, useRef, useState } from 'react';
import { GameRequestError, requestGame, isNewerSnapshot } from '../lib/client';
import { presenceLabel, startReadiness } from '../lib/presence';
import { Shield, Radio, Users, ArrowRight, Copy, Check, Clock, Target, Trophy, LogOut, Lock, Activity, Terminal } from 'lucide-react';
type State = {
    code: string;
    phase: string;
    round: number;
    deadline: number;
    match: string;
    now: number;
    version: number;
    you: string;
    host: string;
    answer: number | null;
    players: {
        id: string;
        name: string;
        online: boolean;
        lastSeenAt: number;
        score: number;
        submitted: boolean;
    }[];
    incident: null | {
        category: string;
        title: string;
        evidence: string;
        question: string;
        options: string[];
        correct?: number;
        explanation?: string;
    };
};
export default function Game() {
    const [room, setRoom] = useState<State | null>(null), [name, setName] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pendingOp, setPendingOp] = useState(''), [connection, setConnection] = useState(''), [time, setTime] = useState(Date.now()), [offset, setOffset] = useState(0), [copied, setCopied] = useState(false), [selected, setSelected] = useState<number | null>(null);
    const active = useRef(''), generation = useRef(0), latest = useRef<State | null>(null), commandPending = useRef(false), refreshRoom = useRef<() => void>(() => {});
    function accept(s: State, g: number) {
        if (g !== generation.current || s.code !== active.current || !isNewerSnapshot(latest.current, s)) return;
        latest.current = s;
        setRoom(s);
        setOffset(s.now - Date.now());
        setConnection('');
    }
    function clearRoom() {
        generation.current++;
        active.current = '';
        latest.current = null;
        localStorage.removeItem('cq_room');
        setRoom(null);
        setConnection('');
    }
    async function action(op: string, extra: Record<string, unknown> = {}) {
        if (commandPending.current) return;
        commandPending.current = true;
        setBusy(true); setPendingOp(op); setError('');
        if (op === 'create' || op === 'join') generation.current++;
        const g = generation.current;
        try {
            const s = await requestGame<State>({ op, code: active.current || code, name, ...extra, ...(op === 'start' ? {expectedMatch: latest.current?.match} : {}) });
            if (g !== generation.current) return;
            if (op === 'leave') clearRoom();
            else {
                if (op === 'create' || op === 'join') { latest.current = null; active.current = s.code; localStorage.setItem('cq_room', s.code); }
                accept(s, g);
            }
        } catch (e) {
            if (g !== generation.current) return;
            setError(e instanceof Error ? e.message : 'Network error. Please retry.');
            // A timed-out command may have committed. Read the room; never blindly
            // repeat a start or overwrite a newer snapshot with an old response.
            refreshRoom.current();
        } finally { commandPending.current = false; setBusy(false); setPendingOp(''); }
    }
    useEffect(() => {
        const invite = new URLSearchParams(location.search).get('room');
        if (invite) setCode(invite.toUpperCase());
        const saved = localStorage.getItem('cq_room');
        if (saved) { active.current = saved; setConnection('Reconnecting to your room…'); }
        let stopped = false, running = false, failures = 0, nextPoll = 0;
        async function refresh(force = false) {
            if (stopped || running || !active.current || (!force && Date.now() < nextPoll)) return;
            running = true;
            const g = generation.current, requestedRoom = active.current;
            try {
                const s = await requestGame<State>({op: 'state', code: requestedRoom});
                if (!stopped && g === generation.current && requestedRoom === active.current) {
                    failures = 0; nextPoll = 0; accept(s, g);
                }
            } catch (e) {
                if (stopped || g !== generation.current || requestedRoom !== active.current) return;
                const failure = e as GameRequestError;
                if (['SESSION_REQUIRED', 'MEMBERSHIP_REQUIRED', 'ROOM_NOT_FOUND'].includes(failure.code)) {
                    clearRoom(); setError(failure.message);
                } else {
                    // Keep the room and membership during transient network/5xx errors.
                    failures++;
                    nextPoll = Date.now() + (failure.retryAfterMs || Math.min(8000, 1000 * 2 ** Math.min(failures, 3)));
                    setConnection(failure.message || 'Network error. Reconnecting…');
                }
            } finally { running = false; }
        }
        const resume = () => { nextPoll = 0; void refresh(true); };
        const visible = () => { if (document.visibilityState === 'visible') resume(); };
        const offline = () => setConnection('You appear offline. Return to the network; your room will reconnect automatically.');
        refreshRoom.current = resume;
        void refresh(true);
        const timer = setInterval(() => void refresh(), 1000);
        const tick = setInterval(() => setTime(Date.now()), 200);
        window.addEventListener('focus', resume); window.addEventListener('online', resume); window.addEventListener('offline', offline);
        document.addEventListener('visibilitychange', visible);
        return () => { stopped = true; clearInterval(timer); clearInterval(tick); window.removeEventListener('focus', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
    }, []);
    useEffect(() => { setSelected(null); setError(''); }, [room?.match, room?.round, room?.phase]);
    const serverTime = time + offset;
    const remaining = room ? Math.max(0, Math.ceil((room.deadline - serverTime) / 1000)) : 0, host = !!room && room.host === room.you;
    const launch = room ? startReadiness({...room, players: room.players.map(p => ({...p, seen: p.lastSeenAt}))}, room.you, serverTime) : null;
    const startExplanation = pendingOp === 'start' ? 'Checking host permission and connected players with the server…' : connection ? 'Connection interrupted. Reconnecting automatically; use Recheck room to refresh now.' : launch?.reason;
    const ranks = room ? [...room.players].sort((a, b) => b.score - a.score) : [];
    async function copy() { try {
        await navigator.clipboard.writeText(`${location.origin}/?room=${room!.code}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
    catch {
        setError('Copy is unavailable. Share the room code displayed above.');
    } }
    const standings = <div className="standings">{ranks.map((p, i) => <div className={'player ' + (p.id === room?.you ? 'me' : '')} key={p.id}><span className="rank">{ranks.findIndex(x => x.score === p.score) + 1}</span><div className="avatar">{p.name.slice(0, 2).toUpperCase()}</div><div className="playername">{p.name} {p.id === room?.you && <small>YOU</small>}<span>{p.id === room?.host ? 'Host · ' : ''}{presenceLabel(p.lastSeenAt, serverTime)}</span></div><strong>{p.score}<small> PTS</small></strong></div>)}</div>;
    return <div className="shell"><header><a className="brand" href="/" onClick={e => { if (room)
        e.preventDefault(); }}><span className="brandicon"><Shield size={25}/></span>CyberQuest<span className="ai">AI</span></a><div className="headerlabel"><span className="dot"/> MULTIPLAYER INCIDENT CHALLENGE</div><span className="version">V1.0 / TRAINING SIMULATION</span></header><main>
 <div aria-live="polite">{connection && <div className="notice"><Radio size={18}/>{connection}</div>}{error && <div className="error" role="alert">{error}</div>}</div>
 {!room ? <><section className="hero"><div className="eyebrow"><span className="dot"/> THE INCIDENT IS FICTIONAL. THE CHALLENGE IS REAL.</div><h1>Think like an analyst.<br /><em>Respond like a team.</em></h1><p>Enter the operations center. Investigate the evidence, make the call, and compete with your crew in a live cyber incident challenge.</p><div className="hero-stats"><span><Users /> 2–6 analysts</span><span><Target /> 5 incidents</span><span><Clock /> 30 seconds each</span></div></section><div className="entrygrid"><section className="panel entry"><div className="sectionlabel">01 / CONNECT TO THE OPERATIONS CENTER</div><h2>Your shift starts here.</h2><label htmlFor="nickname">Analyst nickname</label><input id="nickname" placeholder="e.g. CipherFox" maxLength={20} value={name} onChange={e => setName(e.target.value)}/><button className="primary" disabled={busy || !name.trim()} onClick={() => action('create')}>{busy ? 'Connecting…' : 'Create a room'}<ArrowRight size={18}/></button><div className="divider">OR JOIN YOUR CREW</div><label htmlFor="room">Room code</label><div className="join"><input id="room" placeholder="ABC123" maxLength={6} value={code} onChange={e => setCode(e.target.value.toUpperCase())}/><button disabled={busy || !name.trim() || code.length !== 6} onClick={() => action('join')}>Join room <ArrowRight size={16}/></button></div><p className="fine"><Lock size={13}/> No account needed. Your session stays in this browser.</p></section><section className="briefing"><div className="radar"><Shield size={66}/><span className="radarlabel">CYBER DEFENSE / ONLINE</span></div><div className="sectionlabel">MISSION BRIEF</div><h2>Evidence. Decisions. Impact.</h2><ol><li><b>Assemble your crew</b><span>Create a room and share its code with 1–5 friends.</span></li><li><b>Make your call</b><span>Read each incident and lock one answer in 30 seconds.</span></li><li><b>Learn from the debrief</b><span>Earn 100 points per correct answer. Review the why.</span></li></ol></section></div><div className="categories">PHISHING <span>/</span> IDENTITY <span>/</span> ENDPOINTS <span>/</span> NETWORKS <span>/</span> RANSOMWARE</div></> : <>
 <div className="roomtop"><div><div className="sectionlabel">OPERATIONS ROOM</div><div className="code">{room.code}<button className="iconbutton" aria-label="Copy invitation link" onClick={copy}>{copied ? <Check size={20}/> : <Copy size={20}/>}</button></div></div><button className="quiet" disabled={busy} onClick={() => action('leave')}><LogOut size={16}/> Leave room</button></div>
 {room.phase === 'lobby' ? <div className="gamegrid"><section className="panel"><div className="eyebrow">LOBBY / STANDING BY</div><h1 className="screen-title">Assemble your<br /><em>response team.</em></h1><p>Share the room code or invitation link. The host can launch once at least two analysts are connected.</p><button className="primary" onClick={copy}>{copied ? 'Invitation copied' : 'Copy invitation link'}<Copy size={17}/></button><div className="rules"><span>5 rounds</span><span>30 sec / round</span><span>100 pts / correct</span></div>{host ? <button className="launch" disabled={busy} aria-describedby="start-explanation" onClick={() => action('start')}>{pendingOp === 'start' ? 'Launching…' : 'Launch challenge'} <ArrowRight size={18}/></button> : <div className="notice">{launch?.reason}</div>}<div className="start-status" id="start-explanation" role="status"><p>{startExplanation}</p><button className="quiet" onClick={() => refreshRoom.current()}>Recheck room</button></div><p className="fine">At least 2 players required · Maximum 6 · Ties share a rank</p></section><aside className="panel"><div className="sectionlabel">TEAM ROSTER / {room.players.length} OF 6</div>{standings}</aside></div> : room.phase === 'finished' ? <section className="panel final"><div className="trophy"><Trophy size={44}/></div><div className="eyebrow">MISSION COMPLETE / FIVE INCIDENTS RESOLVED</div><h1 className="screen-title">Final leaderboard</h1><p>{ranks.filter(p => p.score === ranks[0].score).map(p => p.name).join(' & ')} {ranks.filter(p => p.score === ranks[0].score).length > 1 ? 'share the lead' : 'leads the team'} with {ranks[0].score} points.</p>{standings}{host ? <button className="primary" disabled={busy} aria-describedby="start-explanation" onClick={() => action('start')}>{pendingOp === 'start' ? 'Starting replay…' : 'Play again in this room'} <ArrowRight size={18}/></button> : <p>{launch?.reason}</p>}<div className="start-status" id="start-explanation" role="status"><p>{startExplanation}</p><button className="quiet" onClick={() => refreshRoom.current()}>Recheck room</button></div><p className="fine">Scores reset on replay · 500 points possible · 14 fictional scenarios</p></section> : <div className="gamegrid"><section className="panel incident"><div className="roundbar"><span className="eyebrow">ROUND {room.round + 1} / 5</span><span className={'timer ' + (remaining <= 5 ? 'urgent' : '')}><Clock size={18}/>{remaining}s {room.phase === 'reveal' ? 'TO NEXT PHASE' : ''}</span></div><div className="progress"><i style={{ width: `${Math.min(100, remaining / (room.phase === 'question' ? 30 : 12) * 100)}%` }}/></div><span className="badge">{room.incident!.category}</span><h2 className="incidenttitle">{room.incident!.title}</h2><div className="evidence"><div><Terminal size={15}/> INCIDENT EVIDENCE <span>FICTIONAL</span></div><pre>{room.incident!.evidence}</pre></div><h3>{room.incident!.question}</h3><div className="answers">{room.incident!.options.map((option, i) => <button key={i} className={'answer ' + (selected === i ? 'selected ' : '') + (room.answer === i ? 'locked ' : '') + (room.phase === 'reveal' && room.incident!.correct === i ? 'correct ' : '') + (room.phase === 'reveal' && room.answer === i && room.incident!.correct !== i ? 'wrong' : '')} disabled={busy || room.phase !== 'question' || room.answer !== null || remaining === 0 || !!connection} onClick={() => setSelected(i)}><span>{'ABCD'[i]}</span>{option}{room.phase === 'reveal' && room.incident!.correct === i && <Check size={18}/>}</button>)}</div>{room.phase === 'question' ? <><button className="primary" disabled={busy || selected === null || room.answer !== null || remaining === 0 || !!connection} onClick={() => action('answer', { answer: selected, round: room.round, match: room.match })}>{room.answer !== null ? 'Answer locked' : busy ? 'Submitting…' : remaining === 0 ? 'Waiting for debrief…' : 'Lock answer'}<Lock size={16}/></button><p className="fine">One answer per round. Your selection is final after locking.</p></> : <div className="debrief"><div className="eyebrow">INCIDENT DEBRIEF / {room.answer === room.incident!.correct ? '+100 POINTS' : room.answer === null ? 'NO ANSWER' : '0 POINTS'}</div><p>{room.incident!.explanation}</p><small>Next phase starts automatically.</small></div>}</section><aside className="panel"><div className="sectionlabel"><Activity size={15}/> LIVE STANDINGS</div>{standings}<div className="side-note"><Shield size={22}/><p>{room.players.filter(p => p.submitted).length} / {room.players.length} answers locked</p><small>Same evidence. Same deadline.<br />Every decision counts.</small></div></aside></div>}
 </>}
 </main><footer><span><Shield size={14}/> CYBERQUEST AI</span><span>Fictional incidents. Real learning. <b>Predefined scenarios · No AI generation in v1.</b></span></footer></div>;
}
