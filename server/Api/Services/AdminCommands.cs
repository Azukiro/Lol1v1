using System.Text;
using Api.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Api.Services;

/// <summary>
/// Commandes d'administration lancées en ligne de commande, hors serveur web.
/// <c>dotnet run -- reset-password &lt;email&gt;</c> : nouveau mot de passe saisi au clavier (masqué),
/// haché comme à l'inscription. Base visée : <c>ConnectionStrings__Default</c> (sinon appsettings).
/// </summary>
public static class AdminCommands
{
    public static async Task<int> ResetPassword(string rawEmail)
    {
        var config = WebApplication.CreateBuilder().Configuration;
        var connection = config.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connection))
        {
            Console.Error.WriteLine("Aucune chaîne de connexion (ConnectionStrings__Default).");
            return 1;
        }

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connection).UseSnakeCaseNamingConvention().Options;
        await using var db = new AppDbContext(options);

        var email = rawEmail.Trim().ToLowerInvariant();
        var host = new Npgsql.NpgsqlConnectionStringBuilder(connection).Host;
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is null)
        {
            Console.Error.WriteLine($"Aucun compte « {email} » sur {host}.");
            return 1;
        }

        Console.WriteLine($"Compte : {user.DisplayName} <{user.Email}> sur {host}");
        var password = ReadHidden("Nouveau mot de passe : ");
        if (password.Length < 8)
        {
            Console.Error.WriteLine("Mot de passe : 8 caractères minimum.");
            return 1;
        }
        if (ReadHidden("Confirmation : ") != password)
        {
            Console.Error.WriteLine("Les deux saisies diffèrent, rien n'a changé.");
            return 1;
        }

        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, password);
        await db.SaveChangesAsync();
        Console.WriteLine("Mot de passe mis à jour.");
        return 0;
    }

    /// <summary>
    /// <c>dotnet run -- delete-account &lt;email&gt;</c> : supprime un compte (compte de test, par exemple) après avoir retapé son email.
    /// Ses reliques, son profil d'arène, ses combats, amis et abonnements push partent avec lui (cascade) ; ses invitations aussi.
    /// Refusé si le compte a joué une série (historique partagé avec d'autres joueurs).
    /// </summary>
    public static async Task<int> DeleteAccount(string rawEmail)
    {
        var config = WebApplication.CreateBuilder().Configuration;
        var connection = config.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connection))
        {
            Console.Error.WriteLine("Aucune chaîne de connexion (ConnectionStrings__Default).");
            return 1;
        }

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connection).UseSnakeCaseNamingConvention().Options;
        await using var db = new AppDbContext(options);

        var email = rawEmail.Trim().ToLowerInvariant();
        var host = new Npgsql.NpgsqlConnectionStringBuilder(connection).Host;
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email);
        if (user is null)
        {
            Console.Error.WriteLine($"Aucun compte « {email} » sur {host}.");
            return 1;
        }
        if (await db.SeriesPlayers.AnyAsync(p => p.UserId == user.Id))
        {
            Console.Error.WriteLine($"{user.DisplayName} a joué des séries : suppression refusée (historique partagé).");
            return 1;
        }

        var relics = await db.CollectionItems.CountAsync(c => c.UserId == user.Id);
        var battles = await db.RelicBattles.CountAsync(b => b.AttackerId == user.Id || b.DefenderId == user.Id);
        var friends = await db.RelicFriends.CountAsync(f => f.UserId == user.Id);
        Console.WriteLine($"Compte : {user.DisplayName} <{user.Email}> sur {host}, créé le {user.CreatedAt:yyyy-MM-dd HH:mm} UTC");
        Console.WriteLine($"  {relics} reliques, {battles} combats d'arène, {friends} amis");
        Console.WriteLine("Suppression définitive. Les cotes gagnées ou perdues par ses adversaires restent telles quelles.");
        Console.Write("Retape l'email pour confirmer : ");
        if ((Console.ReadLine() ?? "").Trim().ToLowerInvariant() != email)
        {
            Console.Error.WriteLine("Email différent, rien n'a été supprimé.");
            return 1;
        }

        await using var tx = await db.Database.BeginTransactionAsync();
        db.Invitations.RemoveRange(await db.Invitations.Where(i => i.FromUserId == user.Id || i.ToUserId == user.Id).ToListAsync());
        db.Users.Remove(user);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        Console.WriteLine("Compte supprimé.");
        return 0;
    }

    private static string ReadHidden(string prompt)
    {
        Console.Write(prompt);
        var sb = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (sb.Length > 0) sb.Length--; continue; }
            if (!char.IsControl(key.KeyChar)) sb.Append(key.KeyChar);
        }
        Console.WriteLine();
        return sb.ToString();
    }
}
