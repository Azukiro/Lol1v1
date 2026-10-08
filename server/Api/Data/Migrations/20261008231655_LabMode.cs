using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class LabMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "lab_config",
                table: "series",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "lab_state",
                table: "round",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "lab_config",
                table: "series");

            migrationBuilder.DropColumn(
                name: "lab_state",
                table: "round");
        }
    }
}
