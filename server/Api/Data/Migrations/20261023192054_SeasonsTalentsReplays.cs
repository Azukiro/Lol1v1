using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeasonsTalentsReplays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "share_code",
                table: "relic_battle",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "peak_rating",
                table: "battle_profile",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "season_id",
                table: "battle_profile",
                type: "character varying(7)",
                maxLength: 7,
                nullable: false,
                defaultValue: "");

            // Profils existants : saison 1 (octobre 2026), pic = cote actuelle.
            migrationBuilder.Sql("UPDATE battle_profile SET season_id = '2026-10', peak_rating = rating;");

            migrationBuilder.CreateTable(
                name: "season_result",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    season_id = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    rating = table.Column<int>(type: "integer", nullable: false),
                    peak_rating = table.Column<int>(type: "integer", nullable: false),
                    wins = table.Column<int>(type: "integer", nullable: false),
                    losses = table.Column<int>(type: "integer", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    tier = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    reward_standard = table.Column<int>(type: "integer", nullable: false),
                    reward_premium = table.Column<int>(type: "integer", nullable: false),
                    seen = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_season_result", x => new { x.user_id, x.season_id });
                    table.ForeignKey(
                        name: "fk_season_result_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_relic_battle_share_code",
                table: "relic_battle",
                column: "share_code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "season_result");

            migrationBuilder.DropIndex(
                name: "ix_relic_battle_share_code",
                table: "relic_battle");

            migrationBuilder.DropColumn(
                name: "share_code",
                table: "relic_battle");

            migrationBuilder.DropColumn(
                name: "peak_rating",
                table: "battle_profile");

            migrationBuilder.DropColumn(
                name: "season_id",
                table: "battle_profile");
        }
    }
}
