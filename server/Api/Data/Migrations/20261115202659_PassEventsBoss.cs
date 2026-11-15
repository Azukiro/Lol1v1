using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PassEventsBoss : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "pass_level",
                table: "season_result",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "legend",
                table: "battle_profile",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "pass_level",
                table: "battle_profile",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "pass_xp",
                table: "battle_profile",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "boss_score",
                columns: table => new
                {
                    week_id = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    best = table.Column<int>(type: "integer", nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    day = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    day_attempts = table.Column<int>(type: "integer", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    paid = table.Column<bool>(type: "boolean", nullable: false),
                    rank = table.Column<int>(type: "integer", nullable: false),
                    reward_standard = table.Column<int>(type: "integer", nullable: false),
                    reward_premium = table.Column<int>(type: "integer", nullable: false),
                    seen = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_boss_score", x => new { x.week_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_boss_score_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "push_log",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_push_log", x => x.key);
                });

            migrationBuilder.CreateIndex(
                name: "ix_boss_score_paid",
                table: "boss_score",
                column: "paid");

            migrationBuilder.CreateIndex(
                name: "ix_boss_score_user_id",
                table: "boss_score",
                column: "user_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "boss_score");

            migrationBuilder.DropTable(
                name: "push_log");

            migrationBuilder.DropColumn(
                name: "pass_level",
                table: "season_result");

            migrationBuilder.DropColumn(
                name: "legend",
                table: "battle_profile");

            migrationBuilder.DropColumn(
                name: "pass_level",
                table: "battle_profile");

            migrationBuilder.DropColumn(
                name: "pass_xp",
                table: "battle_profile");
        }
    }
}
