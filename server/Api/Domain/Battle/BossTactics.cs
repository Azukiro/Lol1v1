namespace Api.Domain.Battle;

public enum TacticStage { PLAN, OBJECTIVES, FIGHT }

public sealed record TacticOption(int Id, string Label, string Text);

/// <summary>Intention possible du boss et sa probabilité (en %), annoncée au joueur avant son choix.</summary>
public sealed record TacticHint(int Id, string Label, int Percent);

/// <summary>Décision à prendre pendant le combat contre le boss : le combat est en pause à la minute <see cref="Minute"/>.</summary>
public sealed record TacticDecision(int Index, TacticStage Stage, int Minute, string Title, string Text, List<TacticOption> Options, List<TacticHint> Hints);

/// <summary>Décision résolue : Outcome 1 = intention du boss contrée, 0 = statu quo, −1 = contré par le boss.</summary>
public sealed record TacticResult(int Index, TacticStage Stage, int Choice, int Intent, int Outcome, string Text);

/// <summary>
/// Décisions du joueur contre le boss, en pierre-feuille-ciseaux : à chaque étape, le boss a une intention (tirée selon les
/// probabilités annoncées), chaque option en contre une, est neutre face à une autre et se fait contrer par la dernière.
/// L'option i contre l'intention (i + 1) % 3. Bien lire le boss donne un bonus de puissance sur l'étape et des points de dégâts.
/// Étapes : 0 = plan de jeu (lanes), 1 = objectifs (dragons), 2 et plus = chaque teamfight.
/// </summary>
public static class BossTactics
{
    public const double ReadMult = 1.20, MissMult = 0.85;
    public const int ReadPoints = 300;

    private sealed record Stage(TacticStage Kind, string Title, string Text, (string Label, string Text)[] Options, string[] Intents);

    private static readonly Stage Plan = new(TacticStage.PLAN, "Plan de jeu", "Comment tu abordes la phase de lanes ?",
    [
        ("Lanes agressives", "Pression dès la première minute. Punit un boss qui farme, s'expose aux roams."),
        ("Vision et wards", "Couvre la carte. Annule les roams, mais subit une invasion."),
        ("Jouer safe sous tour", "Laisse-le venir. Punit une invasion, se fait distancer si le boss farme."),
    ],
    ["envahit tes lanes", "farme tranquillement", "roam avec sa jungle"]);

    private static readonly Stage Objectives = new(TacticStage.OBJECTIVES, "Les objectifs", "Les dragons arrivent. Où mets-tu ton équipe ?",
    [
        ("Prendre le dragon", "S'il part sur les tours, le dragon est gratuit. S'il envahit, tu te fais prendre à revers."),
        ("Défendre ta jungle", "Contre-piège une invasion. S'il se masse au dragon, tu le lui laisses."),
        ("Split-push les tours", "S'il se masse au dragon, prends ses tours. S'il pousse aussi, l'échange tourne mal."),
    ],
    ["se masse au dragon", "pousse les tours", "envahit ta jungle"]);

    private static readonly Stage Fight = new(TacticStage.FIGHT, "Teamfight", "Les deux équipes se regroupent. Ton call ?",
    [
        ("Engager à fond", "Colle-lui au corps avant qu'il te grignote. Fragile face à un dive sur tes carrys."),
        ("Protéger les carrys", "Peel autour de tes dégâts. Annule un dive, subit un gros engage."),
        ("Reculer et contre-engager", "Laisse-le se jeter, punis la retombée. Perd du terrain face au poke."),
    ],
    ["engage à fond", "poke à distance", "plonge sur tes carrys"]);

    private static Stage StageOf(int index) => index switch { 0 => Plan, 1 => Objectives, _ => Fight };

    /// <summary>1 si l'option contre l'intention, 0 si identique, −1 si elle se fait contrer.</summary>
    public static int Duel(int option, int intent) => intent == (option + 1) % 3 ? 1 : intent == option ? 0 : -1;

    public static double Mult(int outcome) => outcome switch { 1 => ReadMult, -1 => MissMult, _ => 1 };

    /// <summary>Annonce et intention réelle d'une étape, tirées d'un générateur à part (n'altère pas la partie).</summary>
    public static (List<TacticHint> Hints, int Intent) Roll(int seed, int index)
    {
        var rng = new Random(unchecked(seed * 31 + index * 7919));
        var stage = StageOf(index);
        var main = rng.Next(3);
        var others = new[] { (main + 1) % 3, (main + 2) % 3 }.OrderBy(_ => rng.Next()).ToArray();
        var odds = new[] { (main, 60), (others[0], 25), (others[1], 15) };
        var roll = rng.Next(100);
        var intent = roll < 60 ? main : roll < 85 ? others[0] : others[1];
        return (odds.OrderBy(o => o.Item1).Select(o => new TacticHint(o.Item1, $"Le boss {stage.Intents[o.Item1]}", o.Item2)).ToList(), intent);
    }

    public static TacticDecision Decision(int seed, int index, int minute)
    {
        var stage = StageOf(index);
        var title = stage.Kind == TacticStage.FIGHT ? $"{stage.Title} {index - 1}" : stage.Title;
        return new TacticDecision(index, stage.Kind, minute, title, stage.Text,
            stage.Options.Select((o, i) => new TacticOption(i, o.Label, o.Text)).ToList(), Roll(seed, index).Hints);
    }

    public static TacticResult Resolve(int seed, int index, int choice)
    {
        var stage = StageOf(index);
        var intent = Roll(seed, index).Intent;
        var outcome = Duel(choice, intent);
        var text = outcome switch
        {
            1 => $"Bien lu ! Le boss {stage.Intents[intent]} : +{(ReadMult - 1) * 100:0} % pour toi sur cette phase.",
            -1 => $"Raté : le boss {stage.Intents[intent]}. {(MissMult - 1) * 100:0} % sur cette phase.",
            _ => $"Le boss {stage.Intents[intent]} : ni avantage ni malus.",
        };
        return new TacticResult(index, stage.Kind, choice, intent, outcome, text);
    }
}

/// <summary>Choix du joueur pendant une partie contre le boss : pause à la première décision sans réponse.</summary>
public sealed class TacticPlan(int seed, IReadOnlyList<int> choices)
{
    public List<TacticResult> Results { get; } = [];

    /// <summary>Multiplicateur de puissance du joueur (camp A) pour l'étape ; met la partie en pause si le choix manque.</summary>
    public double Apply(int index, int minute)
    {
        if (index >= choices.Count) throw new TacticPause(BossTactics.Decision(seed, index, minute));
        var result = BossTactics.Resolve(seed, index, choices[index]);
        Results.Add(result);
        return BossTactics.Mult(result.Outcome);
    }
}

public sealed class TacticPause(TacticDecision decision) : Exception("Décision attendue")
{
    public TacticDecision Decision { get; } = decision;
}

/// <summary>Partie contre le boss jusqu'à la prochaine décision (Outcome null) ou jusqu'au bout.</summary>
public sealed record BossProgress(List<BattleEvent> Events, TacticDecision? Decision, List<TacticResult> Results, BattleOutcome? Outcome);
