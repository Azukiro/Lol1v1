import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { describe, evaluate, emptyFacts, validate, WinNode } from './rules-engine';
import { extractObservations, LiveGameData, localFacts, turretOwner } from './live-events';

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
