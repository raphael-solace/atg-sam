'use strict';

const $ = id => document.getElementById(id);
const standingsTopic = 'atg/derby/leaderboard';
const series = [
  ['gpt6_luna', 'GPT-6 Luna', '#6ff7ba', []],
  ['o3', 'O3 · Claude panel', '#78bcf4', []],
  ['claude_haiku', 'Claude Haiku', '#c8a1e0', []],
  ['gemini_pro', 'Gemini Pro', '#b9ac94', []],
  ['o4', 'O4 · Astra council', '#ffc269', []],
  ['astra_market', 'Astra · market only', '#fff0d1', [3, 6]],
];
const selected = new Set(series.map(line => line[0]));
const sek = new Intl.NumberFormat('en-GB', {maximumFractionDigits: 0, signDisplay: 'exceptZero'});
const pct = new Intl.NumberFormat('en-GB', {style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero'});
const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
let replay = [], settlements = [], playing = false, elapsed = 0, cursor = 0, lastFrame = null;
let roundKey, roundNo, legNo, cards, winners, board, panel, phase, imported = false;

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
  panel = null;
  clearRound();
  phase = 'Ready to replay';
  $('feed').replaceChildren(element('div', 'Press Play to receive the first race card.', 'placeholder'));
  paint();
}

function install(events, personal) {
  if (!Array.isArray(events) || events.length === 0 ||
      !events.every(e => Number.isFinite(e.at) && e.at >= 0 &&
                       (e.topic === standingsTopic || /^atg\/derby\/v85\/[^/]+\/(leg\/[1-8]\/(snapshot|result)|bet\/[^/]+|payout)$/.test(e.topic)) &&
                        e.payload && typeof e.payload === 'object')) throw Error('Unsupported replay file.');
  const ordered = events.slice().sort((a,b) => a.at - b.at);
  const rounds = ordered.filter(e => e.topic === standingsTopic);
  if (!rounds.length || rounds.length > 10 || rounds.some((r,i) =>
      r.payload.after_round !== i + 1 || !Array.isArray(r.payload.standings))) throw Error('Missing or out-of-order leaderboard settlements.');
  playing = false;
  imported = personal;
  replay = ordered;
  settlements = rounds;
  $('source').textContent = personal ? 'Local event log' : 'Recorded MQTT stream';
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
  line.append(element('time', fmtTime(evt.at), 'stamp'), element('span', type, 'tag'), element('span', title, 'event-text'));
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
  if (evt.topic === standingsTopic) {
    board = p.standings.filter(r => r.strategy !== 'builder' && typeof r.roi === 'number');
    roundNo = p.after_round;
    panel = p.council;
    phase = 'Round settled';
    pushEvent(evt, 'settled', `Week ${roundNo} · ${board[0]?.label || 'Standings updated'}`);
    return;
  }
  const [, , , key, kind, n, action] = evt.topic.split('/');
  if (roundKey !== key) {
    roundKey = key;
    roundNo = Math.min(settlements.length, Math.max(1, settlements.findIndex(r => r.payload.round_id === key) + 1));
    clearRound();
  }
  if (kind === 'leg' && action === 'snapshot') {
    cards[n] = p.options || (p.starters || []).filter(h => !h.scratched).map(h => ({
      id: h.start_number, text: `${h.start_number} ${h.horse}${h.win_odds ? ' · ' + h.win_odds : ''}`
    }));
    pushEvent(evt, 'card', `Leg ${n} · ${cards[n].length} runners`);
  } else if (kind === 'bet') {
    phase = 'Tickets locked';
    pushEvent(evt, 'bet', p.invalid ? `${p.forecaster} · Invalid` :
      `${p.forecaster}${n.endsWith('-builder') ? ' · Builder' : ''} · ${p.cost_sek} SEK`, p.ticket);
  } else if (kind === 'leg' && action === 'result') {
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
  const settled = board[0] ? board[0].bankroll.length - 1 : 0;
  const done = cursor === replay.length;
  $('play').textContent = playing ? 'Pause' : done ? 'Replay' : cursor ? 'Resume' : 'Play replay';
  paintClock();
  $('event-count').textContent = `${cursor} / ${replay.length} events`;
  $('round').textContent = 'Round ' + String(roundNo).padStart(2, '0');
  $('phase').textContent = done ? 'Replay complete' : phase;
  $('settled').textContent = `${settled} OF ${settlements.length} SETTLED`;
  $('lead-caption').textContent = done ? 'FINAL WINNER BY ROI' : 'LEADER AFTER SETTLEMENT';
  $('leader').textContent = board[0]?.label || 'Awaiting results';
  $('leader-roi').textContent = board[0] ? pct.format(board[0].roi) : '—';
  $('leader-net').textContent = board[0] ? `${sek.format(board[0].net_sek)} SEK` : '';
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
  const rows = board.map(r => {
    const row = element('tr', null, r.group === 'Orchestrator' ? 'orch' : '');
    row.append(element('td', r.label), element('td', sek.format(r.net_sek), r.net_sek > 0 ? 'gain' : 'loss'),
               element('td', pct.format(r.roi), r.roi > 0 ? 'gain' : 'loss'));
    return row;
  });
  if (rows.length) $('scores').replaceChildren(...rows);
  else {
    const cell = element('td', 'Standings arrive with each settlement.');
    cell.colSpan = 3;
    const row = element('tr'); row.append(cell); $('scores').replaceChildren(row);
  }
  $('council').hidden = !panel;
  if (panel) {
    const names = panel.experts.map(r => r.label).join(' · ');
    const marketWeight = panel.weights && Object.values(panel.weights).reduce((s,r) => s + (r.crowd || 0) + (r.win_odds || 0), 0) / 8;
    $('experts').replaceChildren(element('p', names), element('p', marketWeight == null ? '' :
      `${pct.format(marketWeight).replace('+','')} average market weight for this round`));
  }
  plot();
}

function plot() {
  const cn = $('chart'), w = cn.clientWidth, h = cn.clientHeight, px = devicePixelRatio || 1;
  if (!w || !h) return;
  cn.width = w * px; cn.height = h * px;
  const c = cn.getContext('2d'); c.scale(px,px);
  const tracks = series.map(line => [line, board?.find(r => r.name === line[0])?.bankroll])
                       .filter(([[id],points]) => points && selected.has(id));
  const points = tracks.flatMap(([,p]) => p);
  const min = Math.floor(Math.min(-1000,...points)/1000)*1000, max = Math.ceil(Math.max(1000,...points)/1000)*1000;
  const total = settlements.length || 10, start = 61, end = w - 18, base = h - 31, top = 16;
  const x = i => start + i / total * (end - start), y = v => base - (v-min)/(max-min)*(base-top);
  c.font = '11px system-ui'; c.textAlign = 'right';
  for (let v=min; v<=max; v+=1000) {
    c.strokeStyle = v === 0 ? '#607a69' : '#2b3d34'; c.beginPath(); c.moveTo(start,y(v));c.lineTo(end,y(v));c.stroke();
    c.fillStyle = '#99b1a3'; c.fillText(sek.format(v),start-8,y(v)+4);
  }
  c.textAlign = 'center';
  for (let i=0; i<=total; i++) if (w>510 || i%2===0) c.fillText(i===0?'Start':i,x(i),h-10);
  if (!points.length) c.fillText('The curves start at the first settlement.',(start+end)/2,(top+base)/2-13);
  for (const [[key,,color,dash],bank] of tracks) {
    c.strokeStyle=color;c.fillStyle=color;c.lineWidth=key==='o4'?3.5:2;c.setLineDash(dash);c.beginPath();
    bank.forEach((v,i) => i ? c.lineTo(x(i),y(v)) : c.moveTo(x(i),y(v))); c.stroke(); c.setLineDash([]);
    if (!dash.length) { const i=bank.length-1;c.beginPath();c.arc(x(i),y(bank[i]),3,0,Math.PI*2);c.fill(); }
  }
}

for (let i=1; i<=8; i++) {
  const btn = element('button', i);
  btn.setAttribute('aria-label', `Show leg ${i} options`);btn.onclick=()=>{legNo=i;paint();};
  $('legs').append(btn);
}
for (const [key,label,color,dash] of series) {
  const btn=element('button',null);
  btn.setAttribute('aria-pressed','true');
  const swatch=element('i',null,'swatch');swatch.style.color=color;swatch.style.borderTopStyle=dash.length?'dashed':'solid';
  btn.append(swatch,label);btn.onclick=()=>{
    selected.has(key)?selected.delete(key):selected.add(key);btn.setAttribute('aria-pressed',String(selected.has(key)));plot();
  };$('legend').append(btn);
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
