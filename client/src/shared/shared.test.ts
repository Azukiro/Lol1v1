import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { describe, evaluate, emptyFacts, validate, WinNode } from './rules-engine';
import { extractObservations, LiveGameData, localFacts, turretOwner } from './live-events';
import { banStats, championHighlights, championStats, headToHead, modeStats, opponentHighlights, opponents, overview, StatsSeries, winConditions, winRate } from './stats';

const expr: WinNode = { op: 'OR', children: [{ condition: 'KILLS', threshold: 2 }, { condition: 'FIRST_TOWER' }] };

test('rules engine: OR = earliest, AND = latest', () => {
  const f = emptyFacts();
  f.killTimes.push(100, 300);
  f.firstTowerTime = 250;
  assert.equal(evaluate(expr, f), 250);
  assert.equal(evaluate({ op: 'AND', children: expr.children }, f), 300);
  assert.equal(describe(expr), 'Kills ≥ 2 OU Première tour');
  assert.equal(validate({ condition: 'KILLS' }), 'Kills : seuil > 0 requis.');
  assert.equal(validate(expr), null);
});

const game = (events: LiveGameData['events'], selfCs = 0, oppCs = 0): LiveGameData => ({
  activePlayer: { riotId: 'Kaelis#EUW' },
  allPlayers: [
    { riotId: 'Kaelis#EUW', riotIdGameName: 'Kaelis', team: 'ORDER', scores: { creepScore: selfCs } },
    { riotId: 'Vorn#EUW', riotIdGameName: 'Vorn', team: 'CHAOS', scores: { creepScore: oppCs } },
  ],
  events,
  gameData: { gameTime: 400 },
});

test('live events: kills, first blood, turrets mapped to SELF / OPPONENT and deduplicated', () => {
  const data = game({
    Events: [
      { EventID: 0, EventName: 'GameStart', EventTime: 0 },
      { EventID: 1, EventName: 'FirstBlood', EventTime: 95, Recipient: 'Kaelis' },
      { EventID: 2, EventName: 'ChampionKill', EventTime: 95, KillerName: 'Kaelis', VictimName: 'Vorn' },
      { EventID: 3, EventName: 'ChampionKill', EventTime: 120, KillerName: 'Turret_T1_C_07_A', VictimName: 'Vorn' },
      { EventID: 4, EventName: 'TurretKilled', EventTime: 300, TurretKilled: 'Turret_T1_C_07_A', KillerName: 'Vorn' },
    ],
  });
  const seen = new Set<string>();
  const obs = extractObservations(data, expr, seen);
  assert.deepEqual(
    obs.map((o) => [o.type, o.eventId, o.payload.subject]),
    [
      ['FIRST_BLOOD', 't95000', 'SELF'],
      ['KILL', 't95000-SELF', 'SELF'],
      ['TURRET', 't300000', 'OPPONENT'],
    ],
  );
  assert.equal(extractObservations(data, expr, seen).length, 0);

  const facts = localFacts(data);
  assert.equal(facts.self.killTimes.length, 1);
  assert.equal(facts.opponent.firstTowerTime, 300);
  assert.equal(turretOwner('Turret_T2_L_03_A'), 'CHAOS');
  assert.equal(turretOwner('Turret_TOrder_L1_P3_2250400266_0'), 'ORDER');
  assert.equal(turretOwner('Turret_TChaos_L1_P3_1234_0'), 'CHAOS');
});

test('live events: current turret naming (Turret_TOrder_…) counts for the destroying team', () => {
  const data: LiveGameData = {
    activePlayer: { riotId: 'Azuki#EUW' },
    allPlayers: [
      { riotId: 'Azuki#EUW', riotIdGameName: 'Azuki', team: 'CHAOS', scores: { creepScore: 40 } },
      { riotId: 'Azran#EUW', riotIdGameName: 'Azran', team: 'ORDER', scores: { creepScore: 30 } },
    ],
    events: { Events: [{ EventID: 8, EventName: 'TurretKilled', EventTime: 183.3, KillerName: 'Azuki', TurretKilled: 'Turret_TOrder_L1_P3_2250400266_0' }] },
    gameData: { gameTime: 200 },
  };
  const obs = extractObservations(data, expr, new Set());
  assert.deepEqual(obs.map((o) => [o.type, o.payload.subject]), [['TURRET', 'SELF']]);
  assert.equal(localFacts(data).self.firstTowerTime, 183.3);
});

test('live events: renumbered EventIDs after a reconnection are not mistaken for duplicates', () => {
  const seen = new Set<string>();
  const kill = (id: number, t: number, killer: string) => ({ EventID: id, EventName: 'ChampionKill', EventTime: t, KillerName: killer, VictimName: 'x' });
  extractObservations(game({ Events: [kill(1, 35.5, 'Kaelis')] }), expr, seen);
  // Après reconnexion le client repart à EventID 1 : ce nouveau kill doit être remonté.
  const obs = extractObservations(game({ Events: [kill(1, 430.9, 'Kaelis')] }), expr, seen);
  assert.deepEqual(obs.map((o) => [o.type, o.eventTime]), [['KILL', 430.9]]);
});

test('live events: CS thresholds and opponent view', () => {
  const csExpr: WinNode = { condition: 'CS', threshold: 50 };
  const seen = new Set<string>();
  assert.deepEqual(extractObservations(game({ Events: [] }, 49, 38), csExpr, seen).map((o) => o.eventId), ['view-30']);
  assert.deepEqual(extractObservations(game({ Events: [] }, 52, 41), csExpr, seen).map((o) => [o.eventId, o.payload.value]), [
    ['self-50', 52],
    ['view-40', 41],
  ]);
});

const statsSeries = (id: string, opponent: string, results: boolean[], champs: number[], createdAt: string, mode = 'MIRROR'): StatsSeries => {
  const wins = results.filter(Boolean).length;
  const losses = results.length - wins;
  const needed = Math.max(wins, losses);
  return {
    series: {
      id, status: 'FINISHED', bestOf: needed * 2 - 1, championMode: mode, spellMode: 'FREE', mySlot: 'A',
      opponentName: opponent, opponentRiotId: `${opponent}#EUW`, opponentProfileIconId: null,
      myWins: wins, opponentWins: losses, winnerSlot: wins > losses ? 'A' : 'B', createdAt,
    },
    rounds: results.map((won, i) => ({
      number: i + 1, winnerSlot: won ? 'A' : 'B', winningCondition: won ? 'KILLS' : 'FIRST_TOWER', winningTime: 300 + i * 10,
      startedAt: null, endedAt: null,
      me: { championId: champs[i], kills: won ? 2 : 0, cs: 40, firstBlood: won, firstTower: false },
      opponent: { championId: 100 + champs[i], kills: won ? 0 : 1, cs: 50, firstBlood: !won, firstTower: !won },
    })),
    myBans: [], opponentBans: [7],
  };
};

test('stats: overview, champions, comebacks and head-to-head', () => {
  const entries = [
    statsSeries('1', 'Vorn', [false, true, true], [1, 1, 2], '2026-10-01T10:00:00Z'),
    statsSeries('2', 'Vorn', [true, true], [1, 1], '2026-10-02T10:00:00Z'),
    statsSeries('3', 'Mira', [false, false], [3, 3], '2026-10-03T10:00:00Z', 'DECK'),
  ];
  const o = overview(entries);
  assert.deepEqual(o.series, { played: 3, wins: 2 });
  assert.deepEqual(o.rounds, { played: 7, wins: 4 });
  assert.deepEqual(o.streak, { wins: false, count: 1 });
  assert.equal(o.comebacks, 1);

  const champs = championStats(entries);
  assert.equal(champs[0].championId, 1);
  assert.equal(champs[0].played, 4);
  assert.equal(winRate(champs[0]), 75);
  assert.equal(champs[0].fastestWin, 300);
  const h = championHighlights(champs);
  assert.equal(h.best?.championId, 1);
  assert.equal(h.worst, null); // champion 3 : 2 manches, sous l'échantillon minimal

  assert.deepEqual(banStats(entries).againstMe, [{ championId: 7, count: 3 }]);
  assert.deepEqual(winConditions(entries, true), [{ condition: 'KILLS', count: 4, percent: 100 }]);
  assert.equal(modeStats(entries, (e) => e.series.championMode)[0].key, 'MIRROR');

  const vorn = headToHead(entries, 'Vorn#EUW')!;
  assert.deepEqual(vorn.opponent.series, { played: 2, wins: 2 });
  assert.deepEqual(vorn.opponent.streak, { wins: true, count: 2 });
  assert.equal(vorn.me.avgKills, 8 / 5);
  assert.equal(vorn.theirChampions[0].championId, 101);
  const hl = opponentHighlights(opponents(entries));
  assert.equal(hl.favorite?.riotId, 'Vorn#EUW');
  assert.equal(hl.nemesis, null);
});
