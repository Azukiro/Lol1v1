using Microsoft.EntityFrameworkCore;

namespace Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<RiotAccount> RiotAccounts => Set<RiotAccount>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<UserPreset> UserPresets => Set<UserPreset>();
    public DbSet<Series> Series => Set<Series>();
    public DbSet<SeriesPlayer> SeriesPlayers => Set<SeriesPlayer>();
    public DbSet<DeckChampion> DeckChampions => Set<DeckChampion>();
    public DbSet<Ban> Bans => Set<Ban>();
    public DbSet<SpellToken> SpellTokens => Set<SpellToken>();
    public DbSet<Round> Rounds => Set<Round>();
    public DbSet<RoundAssignment> RoundAssignments => Set<RoundAssignment>();
    public DbSet<Observation> Observations => Set<Observation>();

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<Enum>().HaveConversion<string>().HaveMaxLength(32);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.ToTable("user");
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.DisplayName).HasMaxLength(64);
        });

        b.Entity<RiotAccount>(e =>
        {
            e.ToTable("riot_account");
            e.HasIndex(x => x.UserId).IsUnique();
            e.HasIndex(x => x.Puuid).IsUnique();
            e.HasIndex(x => x.RiotIdNormalized);
            e.HasOne(x => x.User).WithOne(u => u.RiotAccount).HasForeignKey<RiotAccount>(x => x.UserId);
            e.Ignore(x => x.RiotId);
        });

        b.Entity<UserPreset>(e =>
        {
            e.ToTable("user_preset");
            e.Property(x => x.Name).HasMaxLength(40);
            e.Property(x => x.Config).HasColumnType("jsonb");
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Invitation>(e =>
        {
            e.ToTable("invitation");
            e.Property(x => x.Config).HasColumnType("jsonb");
            e.HasOne(x => x.FromUser).WithMany().HasForeignKey(x => x.FromUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.ToUser).WithMany().HasForeignKey(x => x.ToUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.ToUserId, x.Status });
        });

        b.Entity<Series>(e =>
        {
            e.ToTable("series", t => t.HasCheckConstraint("ck_series_best_of", "best_of IN (1,3,5,7,9,11)"));
            e.Property(x => x.WinExpression).HasColumnType("jsonb");
            e.HasMany(x => x.Players).WithOne(p => p.Series).HasForeignKey(p => p.SeriesId);
            e.HasMany(x => x.Rounds).WithOne(r => r.Series).HasForeignKey(r => r.SeriesId);
            e.HasMany(x => x.Bans).WithOne().HasForeignKey(x => x.SeriesId);
        });

        b.Entity<SeriesPlayer>(e =>
        {
            e.ToTable("series_player");
            e.Property(x => x.PoolSnapshot).HasColumnType("jsonb");
            e.HasIndex(x => new { x.SeriesId, x.Slot }).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.RiotAccount).WithMany().HasForeignKey(x => x.RiotAccountId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Deck).WithOne().HasForeignKey(x => x.SeriesPlayerId);
            e.HasMany(x => x.SpellTokens).WithOne().HasForeignKey(x => x.SeriesPlayerId);
        });

        b.Entity<DeckChampion>(e =>
        {
            e.ToTable("deck_champion");
            e.HasKey(x => new { x.SeriesPlayerId, x.ChampionId });
        });

        b.Entity<Ban>(e =>
        {
            e.ToTable("ban");
            e.HasIndex(x => new { x.SeriesId, x.ByPlayerId, x.ChampionId }).IsUnique();
        });

        b.Entity<SpellToken>(e =>
        {
            e.ToTable("spell_token");
            e.HasKey(x => new { x.SeriesPlayerId, x.SpellId });
        });

        b.Entity<Round>(e =>
        {
            e.ToTable("round");
            e.Property(x => x.WinningCondition).HasColumnType("jsonb");
            e.HasIndex(x => new { x.SeriesId, x.Number, x.Attempt }).IsUnique();
            e.HasIndex(x => x.Status);
            e.HasMany(x => x.Assignments).WithOne().HasForeignKey(x => x.RoundId);
            e.HasMany(x => x.Observations).WithOne().HasForeignKey(x => x.RoundId);
        });

        b.Entity<RoundAssignment>(e =>
        {
            e.ToTable("round_assignment");
            e.HasKey(x => new { x.RoundId, x.PlayerId });
        });

        b.Entity<Observation>(e =>
        {
            e.ToTable("observation");
            e.Property(x => x.Payload).HasColumnType("jsonb");
            e.HasIndex(x => new { x.RoundId, x.ReportedByPlayerId, x.Type, x.EventId }).IsUnique();
        });
    }
}
