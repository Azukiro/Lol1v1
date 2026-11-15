using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class BossRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "boss_run",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    week_id = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    seed = table.Column<int>(type: "integer", nullable: false),
                    team_a = table.Column<string>(type: "jsonb", nullable: false),
                    team_b = table.Column<string>(type: "jsonb", nullable: false),
                    choices = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    done = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_boss_run", x => x.id);
                    table.ForeignKey(
                        name: "fk_boss_run_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_boss_run_user_id_done",
                table: "boss_run",
                columns: new[] { "user_id", "done" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "boss_run");
        }
    }
}
