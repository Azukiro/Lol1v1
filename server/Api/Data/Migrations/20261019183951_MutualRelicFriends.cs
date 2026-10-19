using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <summary>Rattrapage de l'amitié réciproque : chaque ajout à sens unique reçoit son lien inverse.</summary>
    public partial class MutualRelicFriends : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                INSERT INTO relic_friend (user_id, friend_id, created_at)
                SELECT f.friend_id, f.user_id, f.created_at
                FROM relic_friend f
                WHERE NOT EXISTS (
                    SELECT 1 FROM relic_friend r WHERE r.user_id = f.friend_id AND r.friend_id = f.user_id);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
