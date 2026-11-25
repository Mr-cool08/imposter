import { readFileSync } from "node:fs";
import { createRound, EngineError, profileIssues } from "../../app/static/js/engine.mjs";

const { content, rules, cases, configurations } = JSON.parse(readFileSync(0, "utf8"));

function snapshot(round, players, outcome = null) {
  return {
    outcome,
    public: round.publicState(),
    private: Object.fromEntries(players.map(({ id }) => [id, round.privateState(id)])),
  };
}

function replay({ players, settings, rolls, used, now, events, flow }) {
  let index = 0;
  const rng = () => rolls[index++] ?? 0;
  const round = createRound(players, settings, content.words, content.pairs, rules, { rng, used, now, flow });
  const frames = [snapshot(round, players)];
  const localGuessNominees = [round.localGuessNominee()];
  for (const [method, ...args] of events) {
    let outcome;
    try {
      outcome = round[method](...args);
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
      outcome = { code: error.code, issues: error.issues };
    }
    frames.push(snapshot(round, players, outcome));
    localGuessNominees.push(round.localGuessNominee());
  }
  return { frames, localGuessNominees, used };
}

const issues = configurations.map(({ settings, count }) =>
  profileIssues(settings, count, content.words, content.pairs, rules));
const rounds = cases.map(replay);
process.stdout.write(JSON.stringify({ issues, rounds }));
