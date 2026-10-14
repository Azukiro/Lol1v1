using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TwoVsTwo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_series_player_series_id_slot",
                table: "series_player");

            migrationBuilder.AddColumn<int>(
                name: "seat",
                table: "series_player",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "team_size",
                table: "series",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<Guid>(
                name: "group_id",
                table: "invitation",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "seat",
                table: "invitation",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "team",
                table: "invitation",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "B");

            migrationBuilder.CreateIndex(
                name: "ix_series_player_series_id_slot_seat",
                table: "series_player",
                columns: new[] { "series_id", "slot", "seat" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_series_team_size",
                table: "series",
                sql: "team_size IN (1,2)");

            migrationBuilder.CreateIndex(
                name: "ix_invitation_group_id",
                table: "invitation",
                column: "group_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_series_player_series_id_slot_seat",
                table: "series_player");

            migrationBuilder.DropCheckConstraint(
                name: "ck_series_team_size",
                table: "series");

            migrationBuilder.DropIndex(
                name: "ix_invitation_group_id",
                table: "invitation");

            migrationBuilder.DropColumn(
                name: "seat",
                table: "series_player");

            migrationBuilder.DropColumn(
                name: "team_size",
                table: "series");

            migrationBuilder.DropColumn(
                name: "group_id",
                table: "invitation");

            migrationBuilder.DropColumn(
                name: "seat",
                table: "invitation");

            migrationBuilder.DropColumn(
                name: "team",
                table: "invitation");

            migrationBuilder.CreateIndex(
                name: "ix_series_player_series_id_slot",
                table: "series_player",
                columns: new[] { "series_id", "slot" },
                unique: true);
        }
    }
}
