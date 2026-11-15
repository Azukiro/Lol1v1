using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class SeasonFramesAndTeams : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "week_tier",
                table: "battle_profile",
                newName: "season_tier");

            migrationBuilder.AddColumn<int>(
                name: "active_team",
                table: "capsule_wallet",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "teams",
                table: "capsule_wallet",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "active_team",
                table: "capsule_wallet");

            migrationBuilder.DropColumn(
                name: "teams",
                table: "capsule_wallet");

            migrationBuilder.RenameColumn(
                name: "season_tier",
                table: "battle_profile",
                newName: "week_tier");
        }
    }
}
