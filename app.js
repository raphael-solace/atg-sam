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
const series = new Map([
  ['o3', ['Orchestrator3', '#78bcf4']],
  ['gpt6_luna', ['GPT-6 Luna', '#6ff7ba']],
]);
const mutedColor = '#819b8a';
const sek = new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0, signDisplay: 'exceptZero'});
const pct = new Intl.NumberFormat('en-GB', {style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero'});
const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
let replay = [], settlements = [], playing = false, elapsed = 0, cursor = 0, lastFrame = null;
let roundKey, roundNo, legNo, cards, winners, board, headToHead, phase, imported = false;
let hasMatch = false;

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
  headToHead = null;
  clearRound();
  phase = 'Ready to replay';
  $('feed').replaceChildren(element('div', 'Press Play to receive the first race card.', 'placeholder'));
  paint();
}

function install(events, personal) {
  if (!Array.isArray(events) || events.length === 0 ||
      !events.every(e => Number.isFinite(e.at) && e.at >= 0 &&
                       parseTopic(e.topic) &&
                        e.payload && typeof e.payload === 'object')) throw Error('Unsupported replay file.');
  const ordered = events.map(e => ({...e, address: parseTopic(e.topic)})).sort((a,b) => a.at - b.at);
  const rounds = ordered.filter(e => e.address.kind === "leaderboard");
  if (!rounds.length || rounds.length > 10 || rounds.some((r,i) =>
      r.payload.after_round !== i + 1 || !Array.isArray(r.payload.standings))) throw Error('Missing or out-of-order leaderboard settlements.');
  playing = false;
  imported = personal;
  replay = ordered;
  settlements = rounds;
  hasMatch = Boolean(rounds.at(-1).payload.head_to_head?.matched_rounds);
  $('source').textContent = personal ? 'Local event log' : 'Recorded replay';
  $('basis').textContent = personal ? 'Local event log · Read in this browser only' : 'Archived backtest · Anonymized runners · No bets placed';
  $('play').disabled = $('restart').disabled = false;
  $('weeks').replaceChildren(...rounds.map((evt,i) => {
    const btn = element('button', String(i+1).padStart(2,'0'));
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
  entry.title = evt.topic;
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

function receive(evt) {
  const p = evt.payload;
  const {kind, key, detail: n} = evt.address;
  if (kind === 'leaderboard') {
    board = p.standings.filter(r => r.strategy !== 'builder' && typeof r.roi === 'number')
              .map(r => r.name === 'o3' ? {...r, label:'Orchestrator3'} : r);
    headToHead = p.head_to_head;
    roundNo = p.after_round;
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

function countSettled() {
  return board?.[0] ? board[0].bankroll.length - 1 : 0;
}

function benchmarked(pair) {
  return pair?.benchmarked ?? pair?.entries ?? [];
}

function scoredView(settled) {
  if (!hasMatch) return {entries: board || [], excluded: new Set()};
  const history = settlements.slice(0, settled).map(event => event.payload.head_to_head);
  const excluded = new Set();
  history.forEach((pair, i) => {
    if ((pair?.matched_rounds || 0) === (history[i-1]?.matched_rounds || 0)) excluded.add(i+1);
  });
  const entries = benchmarked(headToHead).map(entry => ({
    ...entry,
    bankroll: typeof entry.roi === 'number'
      ? [0, ...history.map(pair => benchmarked(pair).find(row => row.name === entry.name)?.net_sek ?? 0)]
      : [],
  })).sort((a,b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
  return {entries, excluded};
}

function paint() {
  if (!replay.length) return;
  const settled = countSettled();
  const done = cursor === replay.length;
  const {entries} = scoredView(settled);
  const lead = entries[0];
  $('score-scope').hidden = !hasMatch;
  $('score-scope').textContent = `${headToHead?.matched_rounds || 0} of ${settlements.length} rounds · Orchestrator3 and GPT-6 Luna both valid`;
  $('chart').setAttribute('aria-label', hasMatch ? 'All net return curves, counting weeks where Orchestrator3 and GPT-6 Luna both had valid tickets' : 'Net return by settled week, including invalid tickets');
  $('legend').querySelector('[data-entry="others"]').hidden = !entries.some(row => row.bankroll.length && !series.has(row.name));
  $('play').textContent = playing ? 'Pause' : done ? 'Replay' : cursor ? 'Resume' : 'Play replay';
  paintClock();
  $('event-count').textContent = `${cursor} / ${replay.length} events`;
  $('round').textContent = 'Round ' + String(roundNo).padStart(2, '0');
  $('phase').textContent = done ? 'Replay complete' : phase;
  $('settled').textContent = `${settled} OF ${settlements.length} SETTLED`;
  $('lead-caption').textContent = done ? 'WINNER BY ROI' : 'LEADER AFTER SETTLEMENT';
  $('leader').textContent = lead?.label || 'Awaiting results';
  $('leader-roi').textContent = lead ? pct.format(lead.roi) : '—';
  $('leader-net').textContent = lead ? `${sek.format(lead.net_sek)} SEK` : '';
  Array.from($('weeks').children).forEach((btn,i) => {
    btn.classList.toggle('done', i < settled); btn.classList.toggle('active', i + 1 === roundNo);
  });
  Array.from($('legs').children).forEach((btn,i) => {
    btn.classList.toggle('done', Boolean(winners[i+1]));
    btn.setAttribute('aria-pressed', String(legNo === i + 1));
  });
  const card = cards[legNo];
  $('options').replaceChildren(...(card ? [
    element('span', `Leg ${legNo}`),
    ...card.map(r => element('span', r.text || r, `runner${winners[legNo]?.includes(r.id || r) ? ' hit' : ''}`))
  ] : [element('span', 'Runner options appear with the race card.')]));
  const rows = entries.map(r => {
    const row = element('tr', null, r.name === 'o3' || r.group === 'Orchestrator' ? 'orch' : '');
    const staked = typeof r.roi === 'number';
    row.append(
      element('td', r.label),
      element('td', staked ? sek.format(r.net_sek) : '—', staked ? (r.net_sek > 0 ? 'gain' : 'loss') : ''),
      element('td', staked ? pct.format(r.roi) : '—', staked ? (r.roi > 0 ? 'gain' : 'loss') : ''),
      element('td', r.log_loss == null ? '—' : r.log_loss.toFixed(3)),
    );
    return row;
  });
  if (rows.length) $('scores').replaceChildren(...rows);
  else {
    const cell = element('td', 'Standings arrive with each settlement.');
    cell.colSpan = 4;
    const row = element('tr'); row.append(cell); $('scores').replaceChildren(row);
  }
  plot();
}

function plot() {
  const cn = $('chart'), w = cn.clientWidth, h = cn.clientHeight, px = devicePixelRatio || 1;
  if (!w || !h) return;
  cn.width = w * px; cn.height = h * px;
  const c = cn.getContext('2d'); c.scale(px,px);
  const {entries, excluded} = scoredView(countSettled());
  const tracks = entries.filter(entry => entry.bankroll.length > 1)
                        .sort((a,b) => Number(series.has(a.name)) - Number(series.has(b.name)));
  const points = tracks.flatMap(entry => entry.bankroll);
  const min = Math.floor(Math.min(-1000,...points)/1000)*1000, max = Math.ceil(Math.max(1000,...points)/1000)*1000;
  const total = settlements.length || 10, start = 61, end = w - 18, base = h - 31, top = 16;
  const x = i => start + i / total * (end - start), y = v => base - (v-min)/(max-min)*(base-top);
  c.font = '11px system-ui'; c.textAlign = 'right';
  for (let v=min; v<=max; v+=1000) {
    c.strokeStyle = v === 0 ? '#607a69' : '#2b3d34'; c.beginPath(); c.moveTo(start,y(v));c.lineTo(end,y(v));c.stroke();
    c.fillStyle = '#99b1a3'; c.fillText(sek.format(v),start-8,y(v)+4);
  }
  c.textAlign = 'center';
  for (let i=0; i<=total; i++) {
    if (w>510 || i%2===0 || excluded.has(i)) {
      c.fillStyle = excluded.has(i) ? '#f5c479' : '#99b1a3';
      c.fillText(i===0 ? 'Start' : excluded.has(i) ? `${i}*` : i,x(i),h-10);
    }
  }
  if (!points.length) c.fillText('The curves start at the first settlement.',(start+end)/2,(top+base)/2-13);
  for (const {name, bankroll: bank} of tracks) {
    const primary = series.get(name);
    const color = primary?.[1] || mutedColor;
    c.strokeStyle = color; c.fillStyle = color;
    c.globalAlpha = primary ? 1 : .48;
    c.lineWidth = primary ? 2.6 : 1.15;
    for (let i=1; i<bank.length; i++) {
      c.setLineDash(excluded.has(i) ? [3, 5] : []);
      c.beginPath();
      c.moveTo(x(i-1),y(bank[i-1]));
      c.lineTo(x(i),y(bank[i]));
      c.stroke();
    }
    c.setLineDash([]);
    if (primary) { const i=bank.length-1;c.beginPath();c.arc(x(i),y(bank[i]),3,0,Math.PI*2);c.fill(); }
  }
  c.globalAlpha = 1;
}

for (let i=1; i<=8; i++) {
  const btn = element('button', i);
  btn.setAttribute('aria-label', `Show leg ${i} options`);btn.onclick=()=>{legNo=i;paint();};
  $('legs').append(btn);
}
for (const [key,[label,color]] of [...series, ['others', ['Other ticket entries', mutedColor]]]) {
  const item = element('span', null, 'series-label');
  item.dataset.entry = key;
  item.hidden = key === 'others';
  const swatch = element('i', null, 'swatch');
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
fetch('replay.json').then(response=>{
  if (!response.ok) throw Error('The recorded replay could not load.');
  return response.json();
}).then(data=>{ if(!imported) install(data.events,false); }).catch(e=>{ $('notice').textContent=e.message; });
