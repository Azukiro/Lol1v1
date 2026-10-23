using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RelicBattles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "battle_profile",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    rating = table.Column<int>(type: "integer", nullable: false),
                    wins = table.Column<int>(type: "integer", nullable: false),
                    losses = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_battle_profile", x => x.user_id);
                    table.CheckConstraint("ck_battle_profile_counts", "rating >= 0 AND wins >= 0 AND losses >= 0");
                    table.ForeignKey(
                        name: "fk_battle_profile_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "relic_battle",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    attacker_id = table.Column<Guid>(type: "uuid", nullable: false),
                    defender_id = table.Column<Guid>(type: "uuid", nullable: false),
                    seed = table.Column<int>(type: "integer", nullable: false),
                    attacker_won = table.Column<bool>(type: "boolean", nullable: false),
                    attacker_rating_before = table.Column<int>(type: "integer", nullable: false),
                    attacker_rating_after = table.Column<int>(type: "integer", nullable: false),
                    defender_rating_before = table.Column<int>(type: "integer", nullable: false),
                    defender_rating_after = table.Column<int>(type: "integer", nullable: false),
                    essence = table.Column<int>(type: "integer", nullable: false),
                    result = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_relic_battle", x => x.id);
                    table.CheckConstraint("ck_relic_battle_not_self", "attacker_id <> defender_id");
                    table.ForeignKey(
                        name: "fk_relic_battle_user_attacker_id",
                        column: x => x.attacker_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_relic_battle_user_defender_id",
                        column: x => x.defender_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_battle_profile_rating",
                table: "battle_profile",
                column: "rating");

            migrationBuilder.CreateIndex(
                name: "ix_relic_battle_attacker_id_created_at",
                table: "relic_battle",
                columns: new[] { "attacker_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_relic_battle_defender_id_created_at",
                table: "relic_battle",
                columns: new[] { "defender_id", "created_at" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "battle_profile");

            migrationBuilder.DropTable(
                name: "relic_battle");
        }
    }
}
