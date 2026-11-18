'use strict';

const $ = id => document.getElementById(id);
const topicRoots = new Map([
  ['atg/racing/v85/raceCard/published/v1', 'snapshot'],
  ['atg/racing/v85/raceResult/confirmed/v1', 'result'],
  ['atg/betting/v85/pool/settled/v1', 'payout'],
  ['atg/analytics/v85/modelTicket/proposed/v1', 'bet'],
  ['atg/analytics/v85/leaderboard/updated/v1', 'leaderboard'],
]);
const validId = /^[A-Za-z0-9_-]+$/;
const validLeg = /^[1-8]$/;

function parseTopic(topic) {
  if (typeof topic !== 'string') return null;
  const parts = topic.split('/');
  const kind = topicRoots.get(parts.slice(0,6).join('/'));
  if (kind && validId.test(parts[6] || '')) {
    const detail = parts[7];
    if (['payout','leaderboard'].includes(kind)) return parts.length === 7 ? {kind, key: parts[6]} : null;
    if (parts.length === 8 && (kind === 'bet' ? validId : validLeg).test(detail)) return {kind, key: parts[6], detail};
  }
  // Keep older local JSONL logs importable.
  if (topic === 'atg/derby/leaderboard') return {kind:'leaderboard'};
  if (parts.slice(0,3).join('/') !== 'atg/derby/v85' || !validId.test(parts[3] || '')) return null;
  const [, , , key, name, detail, action] = parts;
  if (name === 'payout' && parts.length === 5) return {kind:'payout', key};
  if (name === 'bet' && parts.length === 6 && validId.test(detail)) return {kind:'bet', key, detail};
  if (name === 'leg' && parts.length === 7 && validLeg.test(detail) && ['snapshot','result'].includes(action)) {
    return {kind:action, key, detail};
  }
  return null;
}
const theme = getComputedStyle(document.documentElement);
const palette = Object.fromEntries(['blue', 'gold', 'axis', 'line', 'muted']
  .map(name => [name, theme.getPropertyValue(`--${name}`).trim()]));
const series = new Map([
  ['o3', ['Orchestrator3', palette.blue]],
  ['gpt6_luna', ['GPT-6 Luna', palette.gold]],
]);
const sek = new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0, signDisplay: 'exceptZero'});
const pct = new Intl.NumberFormat('en-GB', {style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero'});
const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const excludedParticipants = new Set(['harry_boy', 'crowd', 'win_odds']);
let replay = [], settlements = [], playing = false, elapsed = 0, cursor = 0, lastFrame = null;
let participants = [];
let roundKey, roundNo, legNo, cards, winners, board, settled, phase, imported = false;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function clearRound() {
  legNo = 1;
  cards = {};
  winners = {};
  phase = 'Race cards arriving';
}

function clear() {
  cursor = elapsed = 0;
  roundKey = null;
  roundNo = 1;
  board = [];
  settled = 0;
  clearRound();
  phase = 'Ready to replay';
  $('feed').replaceChildren(element('div', 'Press Play to see the first race card.', 'placeholder'));
  paint();
}

function install(events, personal) {
  if (!Array.isArray(events) || events.length === 0 ||
      !events.every(e => Number.isFinite(e.at) && e.at >= 0 &&
                       parseTopic(e.topic) &&
                        e.payload && typeof e.payload === 'object')) throw Error('Unsupported replay file.');
  const ordered = events.map(e => ({...e, address: parseTopic(e.topic)}))
    .filter(({address}) => address.kind !== 'bet' || !excludedParticipants.has(address.detail))
    .sort((a,b) => a.at - b.at);
  const rounds = ordered.filter(e => e.address.kind === "leaderboard");
  if (!rounds.length || rounds.length > 10 || rounds.some((r,i) =>
      r.payload.after_round !== i + 1 || !Array.isArray(r.payload.standings))) throw Error('Missing or out-of-order leaderboard settlements.');
  playing = false;
  imported = personal;
  replay = ordered;
  settlements = rounds;
  const roster = new Map();
  for (const {payload} of rounds) {
    for (const row of participantRows(payload.standings)) {
      roster.set(row.name, {name: row.name, label: row.label});
    }
  }
  participants = [...roster.values()].sort((a, b) => a.label.localeCompare(b.label));
  $('source').textContent = personal ? 'Local event log' : 'Recorded replay';
  $('basis').textContent = personal ? 'Local file · Read in this browser only' : 'Historical replay · No bets placed';
  $('play').disabled = $('restart').disabled = false;
  $('weeks').replaceChildren(...rounds.map((evt,i) => {
    const btn = element('button', i + 1);
    btn.setAttribute('aria-label', `Jump to settlement ${i+1}`);
    btn.onclick = () => { playing = false; clear(); seek(evt.at); };
    return btn;
  }));
  clear();
  const week = Number(new URLSearchParams(location.search).get('week'));
  if (Number.isInteger(week) && week >= 1 && week <= rounds.length) seek(rounds[week - 1].at);
}

function pushEvent(evt, type, title, details = null) {
  const entry = element(details ? 'details' : 'div', null, `event ${type}`);
  const line = element(details ? 'summary' : 'div', null, 'item');
  line.append(element('time', fmtTime(evt.at), 'stamp'), element('span', type, 'tag'),
              element('span', title, 'event-text'), element('code', evt.topic, 'event-topic'));
  entry.append(line);
  if (details) {
    const ticket = element('div', null, 'ticket');
    for (const [leg, picks] of Object.entries(details)) ticket.append(element('span', `L${leg} · ${picks.join(' / ')}`));
    entry.append(ticket);
  }
  $('feed').querySelector('.placeholder')?.remove();
  $('feed').prepend(entry);
  if ($('feed').children.length > 56) $('feed').lastChild.remove();
}

function participantRows(standings) {
  return standings.filter(row => row.strategy !== 'builder' && !excludedParticipants.has(row.name))
    .map(row => row.name === 'o3' ? {...row, label: 'Orchestrator3'} : row);
}

function scoreRows(standings) {
  const entries = participantRows(standings)
    .sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
  return entries.map(row => ({
    ...row,
    rank: row.roi == null ? null : entries.findIndex(entry => entry.roi === row.roi) + 1,
  }));
}

function receive(evt) {
  const p = evt.payload;
  const {kind, key, detail: n} = evt.address;
  if (kind === 'leaderboard') {
    board = scoreRows(p.standings);
    settled = roundNo = p.after_round;
    phase = 'Round settled';
    pushEvent(evt, 'settled', `Week ${roundNo} · Standings updated`);
    return;
  }
  if (roundKey !== key) {
    roundKey = key;
    roundNo = Math.min(settlements.length, Math.max(1, settlements.findIndex(r => r.payload.round_id === key) + 1));
    clearRound();
  }
  if (kind === 'snapshot') {
    cards[n] = p.options || (p.starters || []).filter(h => !h.scratched).map(h => ({
      id: h.start_number, text: `${h.start_number} ${h.horse}${h.win_odds ? ' · ' + h.win_odds : ''}`
    }));
    pushEvent(evt, 'card', `Leg ${n} · ${cards[n].length} runners`);
  } else if (kind === 'bet') {
    phase = 'Tickets locked';
    const name = /^(o3|orchestrator3)(-builder)?$/.test(n) ? 'Orchestrator3' : p.forecaster;
    pushEvent(evt, 'bet', p.invalid ? `${name} · Invalid` :
      `${name}${n.endsWith('-builder') ? ' · Builder' : ''} · ${p.cost_sek} SEK`, p.ticket);
  } else if (kind === 'result') {
    const deadHeat = (p.options || p.winner_numbers || []).length > 1;
    winners[n] = p.options || p.winner_numbers;
    legNo = Number(n);
    phase = 'Results arriving';
    pushEvent(evt, 'result', `Leg ${n} · ${deadHeat ? 'Dead heat' : 'Winner'} ${winners[n].join(' / ')}`);
  } else if (kind === 'payout') {
    phase = 'Payout settled';
    pushEvent(evt, 'payout', 'Official settlement recorded');
  }
}

function seek(time) {
  elapsed = time;
  const before = cursor;
  while (cursor < replay.length && replay[cursor].at <= elapsed) receive(replay[cursor++]);
  if (cursor === replay.length) playing = false;
  if (before !== cursor) paint();
  else paintClock();
}

function paintClock() {
  const duration = Math.ceil(replay.at(-1).at);
  const next = `${fmtTime(cursor === replay.length ? duration : elapsed)} / ${fmtTime(duration)}`;
  if ($('time').textContent !== next) $('time').textContent = next;
}

function paint() {
  if (!replay.length) return;
  const done = cursor === replay.length;
  const featured = board.find(row => row.name === 'o3');
  const focus = featured || board.find(row => row.rank === 1);
  for (const item of $('legend').children) {
    const entry = item.dataset.entry;
    item.hidden = !board.some(row => row.bankroll.length && (entry === 'others' ? !series.has(row.name) : row.name === entry));
  }
  $('play').textContent = playing ? 'Pause' : done ? 'Replay' : cursor ? 'Resume' : 'Play replay';
  paintClock();
  $('event-count').textContent = `${cursor} / ${replay.length} events`;
  $('round').textContent = `Week ${roundNo}`;
  $('phase').textContent = done ? 'Replay complete' : phase;
  $('settled').textContent = `${settled} of ${settlements.length} settled`;
  const hasReturn = focus?.rank != null;
  $('lead-caption').textContent = featured || !focus ? 'Featured agent' : 'Highest ROI';
  $('leader').textContent = focus?.label || 'Awaiting results';
  $('leader-roi').textContent = hasReturn ? pct.format(focus.roi) : '—';
  $('leader-net').textContent = hasReturn ? `#${focus.rank} by ROI · ${sek.format(focus.net_sek)} SEK` : '';
  Array.from($('weeks').children).forEach((btn,i) => {
    btn.classList.toggle('done', i < settled);
    btn.classList.toggle('active', i + 1 === roundNo);
    btn.setAttribute('aria-current', String(i + 1 === roundNo));
  });
  Array.from($('legs').children).forEach((btn,i) => {
    btn.classList.toggle('done', Boolean(winners[i+1]));
    btn.setAttribute('aria-pressed', String(legNo === i + 1));
  });
  const card = cards[legNo];
  $('options').hidden = !card;
  $('options').replaceChildren(...(card ? [
    element('span', `Leg ${legNo}`),
    ...card.map(r => element('span', r.text || r, `runner${winners[legNo]?.includes(r.id || r) ? ' hit' : ''}`))
  ] : []));
  const ranked = new Set(board.map(row => row.name));
  const entries = [...board, ...participants.filter(row => !ranked.has(row.name))];
  const pinned = entries.find(row => row.name === 'o3');
  const rows = (pinned ? [pinned, ...entries.filter(row => row !== pinned)] : entries).map(r => {
    const row = element('tr', null, r.name === 'o3' ? 'featured' : '');
    const staked = r.rank != null;
    row.append(
      element('td', r.label),
      element('td', staked ? `#${r.rank}` : '—'),
      element('td', staked ? sek.format(r.net_sek) : '—', staked ? (r.net_sek > 0 ? 'gain' : 'loss') : ''),
      element('td', staked ? pct.format(r.roi) : '—', staked ? (r.roi > 0 ? 'gain' : 'loss') : ''),
      element('td', r.log_loss == null ? '—' : r.log_loss.toFixed(3)),
    );
    return row;
  });
  $('scores').replaceChildren(...rows);
  plot();
}

function plot() {
  const cn = $('chart'), w = cn.clientWidth, h = cn.clientHeight, px = devicePixelRatio || 1;
  if (!w || !h) return;
  cn.width = w * px; cn.height = h * px;
  const c = cn.getContext('2d'); c.scale(px,px);
  const tickets = (board || []).filter(entry => entry.bankroll.length > 1);
  const tracks = [...tickets.filter(entry => !series.has(entry.name)),
                  ...[...series.keys()].reverse().map(name => tickets.find(entry => entry.name === name)).filter(Boolean)];
  const points = tracks.flatMap(entry => entry.bankroll);
  const min = Math.floor(Math.min(-1000,...points)/1000)*1000, max = Math.ceil(Math.max(1000,...points)/1000)*1000;
  const total = settlements.length || 10, start = 61, end = w - 18, base = h - 31, top = 16;
  const x = i => start + i / total * (end - start), y = v => base - (v-min)/(max-min)*(base-top);
  c.font = '11px system-ui'; c.textAlign = 'right';
  for (let v=min; v<=max; v+=1000) {
    c.strokeStyle = v === 0 ? palette.axis : palette.line;
    c.beginPath(); c.moveTo(start,y(v));c.lineTo(end,y(v));c.stroke();
    c.fillStyle = palette.muted; c.fillText(sek.format(v),start-8,y(v)+4);
  }
  c.textAlign = 'center';
  for (let i=0; i<=total; i++) {
    if (w>510 || i%2===0 || i===total) {
      c.fillStyle = palette.muted;
      c.fillText(i===0 ? 'Start' : i,x(i),h-10);
    }
  }
  if (!points.length) c.fillText('Returns appear as weeks settle.',(start+end)/2,(top+base)/2-13);
  for (const {name, bankroll: bank} of tracks) {
    const primary = series.get(name);
    const color = primary?.[1] || palette.axis;
    c.strokeStyle = color; c.fillStyle = color;
    c.globalAlpha = primary ? 1 : .75;
    c.lineWidth = primary ? 2.6 : 1.15;
    c.beginPath();
    c.moveTo(x(0),y(bank[0]));
    for (let i=1; i<bank.length; i++) c.lineTo(x(i),y(bank[i]));
    c.stroke();
    if (primary) { const i=bank.length-1;c.beginPath();c.arc(x(i),y(bank[i]),3,0,Math.PI*2);c.fill(); }
  }
  c.globalAlpha = 1;
}

for (let i=1; i<=8; i++) {
  const btn = element('button', i);
  btn.setAttribute('aria-label', `Show leg ${i} options`);btn.onclick=()=>{legNo=i;paint();};
  $('legs').append(btn);
}
for (const [key,[label,color]] of [...series, ['others', ['Other ticket entries', palette.axis]]]) {
  const item = element('span', null, 'series-label');
  item.dataset.entry = key;
  item.hidden = true;
  const swatch = element('i', null, 'swatch');
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.color = color;
  item.append(swatch, label);
  $('legend').append(item);
}

function frame(now) {
  if (!playing) { lastFrame=null; return; }
  const delta = lastFrame == null ? 0 : (now-lastFrame)/1000;
  lastFrame=now;
  seek(Math.min(replay.at(-1).at, elapsed+delta*Number($('speed').value)));
  if (playing) requestAnimationFrame(frame); else lastFrame=null;
}
$('play').onclick=()=>{
  if (playing) { playing=false;lastFrame=null;paint();return; }
  if (cursor===replay.length) clear();
  playing=true;lastFrame=null;paint();requestAnimationFrame(frame);
};
$('restart').onclick=()=>{playing=false;lastFrame=null;clear();};
$('show-topics').onchange = event => $('feed').classList.toggle('show-topics', event.target.checked);
$('open-file').onclick=()=>$('file').click();
$('file').onchange=async event=>{
  const file=event.target.files[0];
  if (!file) return;
  try {
    if (file.size>8_000_000) throw Error('Choose an event log smaller than 8 MB.');
    const raw=await file.text();
    let data;
    try { data=JSON.parse(raw); } catch { data=raw.trim().split(/\r?\n/).map(JSON.parse); }
    const input=Array.isArray(data)?data:data.events;
    if (!Array.isArray(input) || !input.length) throw Error('The file contains no replay events.');
    const start=Date.parse(input[0].ts);
    install(input.map(row=>({...row, at: row.at ?? (Date.parse(row.ts) - start) / 1000})), true);
    $('notice').textContent='';
  } catch (e) { $('notice').textContent=e.message; }
  event.target.value='';
};
new ResizeObserver(plot).observe($('chart'));
fetch('replay.json?v=3').then(response=>{
  if (!response.ok) throw Error('The recorded replay could not load.');
  return response.json();
}).then(data=>{ if(!imported) install(data.events,false); }).catch(e=>{ $('notice').textContent=e.message; });
